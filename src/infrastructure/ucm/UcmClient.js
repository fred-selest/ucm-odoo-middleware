'use strict';

const net          = require('net');
const tls          = require('tls');
const crypto       = require('crypto');
const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const config       = require('../../config');
const logger       = require('../../logger');
const UcmEventParser = require('./UcmEventParser');

/**
 * Client AMI pour Grandstream UCM.
 *
 * Flux d'authentification MD5 :
 *   1. TCP connect → bannière UCM
 *   2. → Action: Challenge / AuthType: MD5
 *   3. ← Response: Success / Challenge: <str>
 *   4. → Action: Login / AuthType: MD5 / Username / Key: MD5(challenge+secret)
 *   5. ← Response: Success / Message: Authentication accepted
 *   6. Écoute des events
 *
 * Événements émis :
 *   'connected'            connexion + auth réussies
 *   'disconnected'         socket fermé
 *   'event' (amiEvent)     tout événement AMI
 *   'call:incoming'        appel entrant (NewExten/Ring/AgentCalled)
 *   'call:answered'        décroché
 *   'call:hangup'          raccroché
 *   'error' (err)
 */
class UcmClient extends EventEmitter {
  constructor() {
    super();
    this._socket       = null;
    this._parser       = new UcmEventParser(msg => this._handleMessage(msg));
    this._reconnecting = false;
    this._reconnectAttempts = 0;
    this._connected    = false;
    this._authenticated = false;
    this._pendingActions = new Map();   // actionId → { resolve, reject, timer }
    this._challengeResolve = null;
    this._shuttingDown = false;
    this._pingTimer    = null;
  }

  // ── API publique ───────────────────────────────────────────────────────────

  connect() {
    if (this._socket) return;
    this._shuttingDown = false;
    this._doConnect();
  }

  disconnect() {
    this._shuttingDown = true;
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
  }

  get isConnected() { return this._authenticated; }

  /**
   * Envoie une action AMI et attend la réponse (Promise).
   * @param {object} action  Champs clé/valeur
   * @param {number} timeout ms
   */
  sendAction(action, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (!this._socket || !this._authenticated) {
        return reject(new Error('UCM non connecté'));
      }
      const actionId = uuidv4().slice(0, 8);
      const timer = setTimeout(() => {
        this._pendingActions.delete(actionId);
        reject(new Error(`Action ${action.Action} timeout`));
      }, timeout);

      this._pendingActions.set(actionId, { resolve, reject, timer });
      const lines = Object.entries({ ...action, ActionID: actionId })
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n');
      this._socket.write(lines + '\r\n\r\n');
    });
  }

  // ── Connexion ──────────────────────────────────────────────────────────────

  _doConnect() {
    const { host, port } = config.ucm;
    logger.info('UCM: connexion TCP', { host, port, attempt: this._reconnectAttempts + 1 });

    // Connexion TLS (UCM utilise TLS sur le port AMI)
    const socket = tls.connect({
      host,
      port,
      rejectUnauthorized: false,   // certificat UCM auto-signé
    });
    this._socket = socket;

    socket.setKeepAlive(true, 15000);
    socket.setTimeout(30000);

    socket.on('data',    chunk => {
      const raw = chunk.toString('utf8');
      logger.debug('UCM: données brutes reçues', { raw: raw.replace(/\r/g,'\\r').replace(/\n/g,'\\n') });
      // La bannière AMI est une ligne unique "Asterisk Call Manager/X.X\r\n"
      // sans double \r\n → on la détecte ici avant le parser
      if (!this._authenticated && /^(Asterisk|Grandstream) Call Manager/i.test(raw.trim())) {
        clearTimeout(this._bannerTimer);
        logger.info('UCM: bannière reçue', { banner: raw.trim() });
        this._sendChallenge();
        return;
      }
      this._parser.feed(chunk);
    });
    socket.on('error',   err   => this._onSocketError(err));
    socket.on('close',   ()    => this._onSocketClose());
    socket.on('timeout', ()    => {
      logger.warn('UCM: socket timeout');
      socket.destroy();
    });

    socket.on('secureConnect', () => {
      logger.debug('UCM: TLS établi, attente bannière...');
      // Fallback : si l'UCM n'envoie pas de bannière dans les 3s,
      // on tente un login en texte clair (supporté par Grandstream UCM).
      this._bannerTimer = setTimeout(() => {
        if (!this._authenticated) {
          logger.debug('UCM: pas de bannière reçue, tentative login plain-text');
          this._sendPlainLogin();
        }
      }, 3000);
    });
  }

  // ── Gestion des messages AMI ───────────────────────────────────────────────

  _handleMessage(msg) {
    logger.debug('UCM msg', msg);

    // Bannière initiale → déclencher le challenge
    if (msg._banner) {
      clearTimeout(this._bannerTimer);
      logger.info('UCM: bannière reçue', { banner: msg._banner });
      this._sendChallenge();
      return;
    }

    // Réponse challenge
    if (msg.Response === 'Success' && msg.Challenge && !this._authenticated) {
      this._handleChallenge(msg.Challenge);
      return;
    }

    // Réponse login (MD5 ou plain-text)
    if (msg.Response === 'Success' && !this._authenticated &&
        (msg.Message?.includes('Authentication accepted') || msg.Message?.includes('auth'))) {
      this._onAuthenticated();
      return;
    }
    // Certains UCM Grandstream répondent simplement Response: Success sans Message
    if (msg.Response === 'Success' && !this._authenticated && !msg.Challenge) {
      this._onAuthenticated();
      return;
    }

    // Erreur auth
    if (msg.Response === 'Error' && !this._authenticated) {
      logger.error('UCM: authentification refusée', { message: msg.Message });
      this.emit('error', new Error('UCM auth refusée : ' + msg.Message));
      this._socket?.destroy();
      return;
    }

    // Réponse à une action en attente (ActionID présent)
    if (msg.ActionID && this._pendingActions.has(msg.ActionID)) {
      const { resolve, reject, timer } = this._pendingActions.get(msg.ActionID);
      this._pendingActions.delete(msg.ActionID);
      clearTimeout(timer);
      if (msg.Response === 'Error') {
        reject(new Error(msg.Message || 'AMI error'));
      } else {
        resolve(msg);
      }
      return;
    }

    // Événements AMI
    if (msg.Event) {
      this.emit('event', msg);
      this._dispatchCallEvent(msg);
    }
  }

  _sendChallenge() {
    logger.debug('UCM: envoi Action Challenge');
    this._socket.write('Action: Challenge\r\nAuthType: MD5\r\n\r\n');
  }

  _sendPlainLogin() {
    const { username, secret } = config.ucm;
    logger.debug('UCM: envoi Action Login plain-text');
    this._socket.write(
      `Action: Login\r\nUsername: ${username}\r\nSecret: ${secret}\r\nEvents: system,call,log,verbose,cdr,agent\r\n\r\n`
    );
  }

  _handleChallenge(challenge) {
    const { username, secret } = config.ucm;
    const key = crypto.createHash('md5').update(challenge + secret).digest('hex');
    logger.debug('UCM: envoi Action Login');
    this._socket.write(
      `Action: Login\r\nAuthType: MD5\r\nUsername: ${username}\r\nKey: ${key}\r\n\r\n`
    );
  }

  _onAuthenticated() {
    this._authenticated = true;
    this._connected     = true;
    this._reconnectAttempts = 0;
    logger.info('UCM: authentifié avec succès');

    // Désactiver le timeout socket (remplacé par ping actif)
    this._socket.setTimeout(0);

    // Activer les événements souhaités
    this._socket.write(
      'Action: Events\r\nEventMask: call,cdr,agent\r\n\r\n'
    );

    // Ping AMI toutes les 20s pour maintenir la connexion
    this._pingTimer = setInterval(() => {
      if (this._socket && this._authenticated) {
        this._socket.write('Action: Ping\r\n\r\n');
      }
    }, 20000);

    this.emit('connected');
  }

  // ── Dispatch événements d'appel ───────────────────────────────────────────

  _dispatchCallEvent(msg) {
    const exten       = msg.Exten || msg.Extension || msg.DestExten || '';
    const watched     = config.ucm.watchExtensions;
    const isWatched   = !watched.length || watched.includes(exten);

    switch (msg.Event) {
      // Appel entrant — plusieurs événements AMI couvrent ce cas selon config UCM
      case 'Newchannel':
      case 'AgentCalled':
      case 'AgentRingNoAnswer': {
        if (!isWatched) break;
        const callInfo = this._extractCallInfo(msg);
        logger.info('UCM: appel entrant', callInfo);
        this.emit('call:incoming', callInfo);
        break;
      }

      case 'AgentConnect':
      case 'Bridge':
      case 'BridgeCreate': {
        if (!isWatched) break;
        const callInfo = this._extractCallInfo(msg);
        logger.info('UCM: appel décroché', callInfo);
        this.emit('call:answered', callInfo);
        break;
      }

      case 'Hangup':
      case 'AgentComplete':
      case 'AgentDump': {
        const callInfo = this._extractCallInfo(msg);
        logger.info('UCM: appel raccroché', callInfo);
        this.emit('call:hangup', callInfo);
        break;
      }
    }
  }

  _extractCallInfo(msg) {
    return {
      uniqueId:      msg.Uniqueid   || msg.UniqueID  || '',
      linkedId:      msg.Linkedid   || msg.LinkedID  || '',
      channel:       msg.Channel    || '',
      callerIdNum:   msg.CallerIDNum || msg.CallerIDNum || msg.ConnectedLineNum || '',
      callerIdName:  msg.CallerIDName || msg.ConnectedLineName || '',
      exten:         msg.Exten      || msg.Extension || msg.DestExten || '',
      destChannel:   msg.DestChannel || msg.AgentChannel || '',
      agentExten:    msg.Interface?.replace(/^(SIP|PJSIP)\//, '') || '',
      queue:         msg.Queue      || '',
      event:         msg.Event,
      timestamp:     new Date().toISOString(),
    };
  }

  // ── Reconnexion avec backoff exponentiel ──────────────────────────────────

  _onSocketError(err) {
    logger.error('UCM: erreur socket', { message: err.message });
    this.emit('error', err);
  }

  _onSocketClose() {
    clearTimeout(this._bannerTimer);
    clearInterval(this._pingTimer);
    this._pingTimer = null;
    const wasAuth = this._authenticated;
    this._authenticated = false;
    this._connected     = false;
    this._socket        = null;
    this._parser.reset();

    // Rejeter toutes les actions en attente
    for (const [, { reject, timer }] of this._pendingActions) {
      clearTimeout(timer);
      reject(new Error('UCM déconnecté'));
    }
    this._pendingActions.clear();

    if (wasAuth) {
      logger.warn('UCM: connexion perdue');
      this.emit('disconnected');
    }

    if (!this._shuttingDown) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    const { reconnectDelay, reconnectMaxDelay } = config.ucm;
    const delay = Math.min(
      reconnectDelay * Math.pow(2, this._reconnectAttempts),
      reconnectMaxDelay
    );
    this._reconnectAttempts++;
    logger.info(`UCM: reconnexion dans ${delay}ms (tentative #${this._reconnectAttempts})`);
    setTimeout(() => {
      if (!this._shuttingDown) this._doConnect();
    }, delay);
  }
}

module.exports = UcmClient;
