'use strict';

const crypto           = require('crypto');
const { EventEmitter } = require('events');
const WebSocket        = require('ws');
const config           = require('../../config');
const logger           = require('../../logger');

/**
 * Client WebSocket pour Grandstream UCM (API WebSocket).
 *
 * Flux d'authentification :
 *   1. WSS connect → wss://host:8089/websockify
 *   2. → { type:"request", message:{ action:"challenge", username, version:"1" } }
 *   3. ← { type:"response", message:{ challenge:"..." } }
 *   4. → { type:"request", message:{ action:"login", username, token:MD5(challenge+password) } }
 *   5. ← { type:"response", message:{ cookie:"sid..." } }
 *   6. → subscribe ExtensionStatus
 *   7. ← events en continu
 *
 * Émet les mêmes événements que UcmClient :
 *   connected, disconnected, error, call:incoming, call:answered, call:hangup
 */
class UcmWsClient extends EventEmitter {
  constructor() {
    super();
    this._ws             = null;
    this._cookie         = null;
    this._txId           = 0;
    this._pending        = new Map();   // txId → { resolve, reject, timer }
    this._authenticated  = false;
    this._shuttingDown   = false;
    this._reconnectAttempts = 0;
    this._heartbeatTimer = null;
    this._pingTimer      = null;
    // Registre des appels actifs : uniqueid → callInfo
    this._activeCalls    = new Map();
  }

  // ── API publique ───────────────────────────────────────────────────────────

  connect() {
    if (this._ws) return;
    this._shuttingDown = false;
    this._doConnect();
  }

  disconnect() {
    this._shuttingDown = true;
    this._clearTimers();
    if (this._ws) { this._ws.terminate(); this._ws = null; }
  }

  get isConnected() { return this._authenticated; }

  // ── Connexion ──────────────────────────────────────────────────────────────

  _doConnect() {
    const { host, webPort, webUser } = config.ucm;
    const url = `wss://${host}:${webPort}/websockify`;
    logger.info('UCM WS: connexion', { url, user: webUser, attempt: this._reconnectAttempts + 1 });

    const ws = new WebSocket(url, { rejectUnauthorized: false });
    this._ws = ws;

    ws.on('open',    ()      => this._onOpen());
    ws.on('message', data    => this._onMessage(data));
    ws.on('error',   err     => this._onError(err));
    ws.on('close',   ()      => this._onClose());
  }

  // ── Authentification ───────────────────────────────────────────────────────

  async _onOpen() {
    logger.debug('UCM WS: connexion établie, démarrage auth');
    try {
      // Step 1 : challenge
      const chalResp = await this._send({ action: 'challenge', username: config.ucm.webUser, version: '1' });
      const challenge = chalResp?.challenge || chalResp?.message?.challenge;
      if (!challenge) throw new Error('Challenge non reçu');

      // Step 2 : login
      const token = crypto.createHash('md5').update(challenge + config.ucm.webPassword).digest('hex');
      const loginResp = await this._send({ action: 'login', username: config.ucm.webUser, token, url: '' });
      const cookie = loginResp?.cookie || loginResp?.message?.cookie;
      if (!cookie) throw new Error('Cookie de session non reçu');

      this._cookie = cookie;
      this._authenticated = true;
      this._reconnectAttempts = 0;
      logger.info('UCM WS: authentifié', { cookie: cookie.slice(0, 16) + '…' });

      // Step 3 : subscribe
      await this._send({ action: 'subscribe', eventnames: ['ExtensionStatus'], cookie: this._cookie });
      logger.info('UCM WS: souscription ExtensionStatus OK');

      // Heartbeat toutes les 20s
      this._heartbeatTimer = setInterval(() => this._heartbeat(), 20000);

      this.emit('connected');
    } catch (err) {
      logger.error('UCM WS: authentification échouée', { error: err.message });
      this.emit('error', err);
      this._ws?.terminate();
    }
  }

  async _heartbeat() {
    try {
      await this._send({ action: 'heartbeat', cookie: this._cookie }, 5000);
    } catch {
      logger.warn('UCM WS: heartbeat timeout — reconnexion');
      this._ws?.terminate();
    }
  }

  // ── Envoi de messages ──────────────────────────────────────────────────────

  _send(message, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const txId = String(++this._txId);
      const payload = JSON.stringify({ type: 'request', message: { transactionid: txId, ...message } });

      const timer = setTimeout(() => {
        this._pending.delete(txId);
        reject(new Error(`UCM WS timeout: ${message.action}`));
      }, timeout);

      this._pending.set(txId, { resolve, reject, timer });

      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(payload);
      } else {
        clearTimeout(timer);
        this._pending.delete(txId);
        reject(new Error('WebSocket non connecté'));
      }
    });
  }

  // ── Réception des messages ─────────────────────────────────────────────────

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    logger.debug('UCM WS msg', msg);

    const inner = msg.message || msg;
    const txId  = inner.transactionid || inner.id;

    // Résoudre une promesse en attente
    if (txId && this._pending.has(txId)) {
      const { resolve, timer } = this._pending.get(txId);
      this._pending.delete(txId);
      clearTimeout(timer);
      resolve(inner);
      return;
    }

    // Événement asynchrone (notify)
    if (inner.action === 'notify' || msg.type === 'event') {
      this._dispatchEvent(inner);
    }
  }

  // ── Dispatch des événements UCM → call:* ───────────────────────────────────

  _dispatchEvent(msg) {
    const eventName = msg.eventnames || msg.event;
    const body      = msg.eventbody  || msg.body || {};

    if (!String(eventName).startsWith('ExtensionStatus')) return;

    const status   = (body.status || body.Status || '').toLowerCase();
    const exten    = String(body.extension || body.Extension || body.exten || '');
    const watched  = config.ucm.watchExtensions;
    if (watched.length && !watched.includes(exten)) return;

    const callInfo = {
      uniqueId:     body.uniqueid    || body.UniqueID   || body.callid || `ws-${Date.now()}`,
      linkedId:     body.linkedid    || '',
      channel:      body.channel     || body.Channel    || '',
      callerIdNum:  body.callerid    || body.CallerIDNum || body.from  || '',
      callerIdName: body.calleridname || body.CallerIDName || '',
      exten,
      destChannel:  '',
      agentExten:   exten,
      queue:        '',
      source:       'websocket-ucm',
      timestamp:    new Date().toISOString(),
    };

    logger.debug('UCM WS: événement extension', { exten, status, callInfo });

    switch (status) {
      case 'ringing':
      case 'ring':
        if (!this._activeCalls.has(callInfo.uniqueId)) {
          this._activeCalls.set(callInfo.uniqueId, callInfo);
          logger.info('UCM WS: appel entrant', { from: callInfo.callerIdNum, exten });
          this.emit('call:incoming', callInfo);
        }
        break;

      case 'inuse':
      case 'busy':
      case 'answered':
        if (this._activeCalls.has(callInfo.uniqueId)) {
          const enriched = { ...this._activeCalls.get(callInfo.uniqueId), ...callInfo, answeredAt: new Date().toISOString() };
          this._activeCalls.set(callInfo.uniqueId, enriched);
          logger.info('UCM WS: appel décroché', { exten });
          this.emit('call:answered', enriched);
        }
        break;

      case 'idle':
      case 'hungup':
      case 'unavailable':
        if (this._activeCalls.has(callInfo.uniqueId)) {
          const existing = this._activeCalls.get(callInfo.uniqueId);
          const duration = existing.timestamp
            ? Math.round((Date.now() - new Date(existing.timestamp).getTime()) / 1000)
            : null;
          const enriched = { ...existing, ...callInfo, hungUpAt: new Date().toISOString(), duration };
          this._activeCalls.delete(callInfo.uniqueId);
          logger.info('UCM WS: appel raccroché', { exten, duration });
          this.emit('call:hangup', enriched);
        }
        break;

      default:
        logger.debug('UCM WS: statut inconnu', { status, exten });
    }
  }

  // ── Gestion des erreurs / fermeture ───────────────────────────────────────

  _onError(err) {
    logger.error('UCM WS: erreur socket', { message: err.message });
    this.emit('error', err);
  }

  _onClose() {
    const wasAuth = this._authenticated;
    this._clearTimers();
    this._authenticated = false;
    this._cookie        = null;
    this._ws            = null;

    for (const [, { reject, timer }] of this._pending) {
      clearTimeout(timer);
      reject(new Error('UCM WS déconnecté'));
    }
    this._pending.clear();

    if (wasAuth) {
      logger.warn('UCM WS: connexion perdue');
      this.emit('disconnected');
    }

    if (!this._shuttingDown) this._scheduleReconnect();
  }

  _clearTimers() {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  }

  _scheduleReconnect() {
    const { reconnectDelay, reconnectMaxDelay } = config.ucm;
    const delay = Math.min(reconnectDelay * Math.pow(2, this._reconnectAttempts), reconnectMaxDelay);
    this._reconnectAttempts++;
    logger.info(`UCM WS: reconnexion dans ${delay}ms (tentative #${this._reconnectAttempts})`);
    setTimeout(() => { if (!this._shuttingDown) this._doConnect(); }, delay);
  }
}

module.exports = UcmWsClient;
