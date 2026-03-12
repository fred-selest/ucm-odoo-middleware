'use strict';

const logger = require('../logger');

/**
 * Orchestre le traitement d'un appel entrant :
 *   1. Reçoit l'événement UCM (call:incoming)
 *   2. Recherche le contact dans Odoo
 *   3. Notifie l'agent via WebSocket
 *   4. Gère call:answered et call:hangup de la même façon
 *   5. Persiste l'historique des appels en base de données
 */
class CallHandler {
  /**
   * @param {UcmHttpClient}       ucmHttpClient   Client HTTP API UCM6300
   * @param {UcmWebSocketClient}  ucmWsClient     Client WebSocket UCM6300
   * @param {OdooClient}          odooClient
   * @param {WsServer}            wsServer
   * @param {WebhookManager|null} webhookManager  Webhook manager (optionnel)
   * @param {CallHistory|null}    callHistory     Service d'historique (optionnel)
   */
  constructor(ucmHttpClient, ucmWsClient, odooClient, wsServer, webhookManager = null, callHistory = null) {
    this._http = ucmHttpClient;
    this._wsClient = ucmWsClient;
    this._odoo = odooClient;
    this._ws   = wsServer;
    this._callHistory = callHistory;

    // Registre des appels actifs : uniqueId → callInfo enrichi
    this._activeCalls = new Map();

    // Binder les événements WebSocket UCM6300
    if (ucmWsClient) {
      this._bindSource(ucmWsClient, 'UCM');
    }

    // Webhook manager (fallback pour ancien UCM)
    if (webhookManager) this._bindSource(webhookManager, 'Webhook');

    // Polling HTTP actif : détecte les appels en cours via l'API UCM (toutes les 3s)
    this._pollInterval  = null;
    this._polledCalls   = new Map(); // uniqueId → dernière vue
    this._isPolling     = false;
    this._startPolling();
  }

  /**
   * Traite les événements de l'UCM6300
   * @param {object} event
   */
  handleUcmEvent(event) {
    const { type, data } = event;
    
    switch (type) {
      case 'call:incoming':
        this._onIncoming({
          uniqueId: data.uniqueId,
          callerIdNum: data.callerIdNum,
          callerIdName: data.callerIdName,
          exten: data.exten,
          channel: data.channel,
          direction: data.direction,
          timestamp: data.timestamp,
        });
        break;

      case 'call:answered':
        this._onAnswered({
          uniqueId: data.uniqueId,
          exten: data.exten,
          channel: data.channel,
          answerTime: data.answerTime,
        });
        break;

      case 'call:hangup':
        this._onHangup({
          uniqueId: data.uniqueId,
          channel: data.channel,
          duration: data.duration,
          disposition: data.disposition,
          hangupTime: data.hangupTime,
        });
        break;

      default:
        logger.debug('CallHandler: événement non géré', { type, data });
    }
  }

  // ── Binding ────────────────────────────────────────────────────────────────

  _bindSource(source, label) {
    source.on('call:incoming', call => this._onIncoming(call));
    source.on('call:answered', call => this._onAnswered(call));
    source.on('call:hangup',   call => this._onHangup(call));
    if (source.on && label === 'UCM') {
      source.on('connected',    () => logger.info('CallHandler: UCM connecté, prêt'));
      source.on('disconnected', () => logger.warn('CallHandler: UCM déconnecté'));
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  async _onIncoming(call) {
    const { uniqueId, callerIdNum, callerIdName, exten, agentExten } = call;
    logger.info('Appel entrant', { from: callerIdNum, to: exten || agentExten, uniqueId });

    // Vérifier si le numéro est blacklisté
    if (this._callHistory && callerIdNum) {
      const isBlacklisted = await this._callHistory.isBlacklisted(callerIdNum);
      if (isBlacklisted) {
        logger.info('Appel bloqué (blacklist)', { callerIdNum, uniqueId });
        return;
      }
    }

    let contact = null;

    // Recherche Odoo uniquement si numéro externe (non interne)
    if (callerIdNum && !this._isInternalNumber(callerIdNum)) {
      try {
        contact = await this._odoo.findContactByPhone(callerIdNum);
      } catch (err) {
        logger.error('Odoo: échec recherche contact', { phone: callerIdNum, error: err.message });
      }
    }

    const enriched = { ...call, contact };
    this._activeCalls.set(uniqueId, enriched);

    const target = exten || agentExten;

    // Créer l'appel dans l'historique
    if (this._callHistory) {
      try {
        await this._callHistory.createCall({
          uniqueId,
          callerIdNum,
          callerIdName,
          exten,
          agentExten,
          direction: 'inbound'
        });
        
        // Mettre à jour avec le contact si trouvé
        if (contact) {
          await this._callHistory.updateCallContact(uniqueId, contact);
        }
      } catch (err) {
        logger.error('Erreur persistance appel entrant', { error: err.message, uniqueId });
      }
    }

    // Notifier l'extension cible
    if (target) {
      this._ws.notifyExtension(target, 'call:incoming', enriched);
    }

    // Notifier le contact Odoo séparément si trouvé
    if (contact && target) {
      this._ws.notifyExtension(target, 'contact', { uniqueId, contact });
    }
  }

  async _onAnswered(call) {
    const { uniqueId, exten, agentExten } = call;
    const existing = this._activeCalls.get(uniqueId) || call;
    const enriched = { ...existing, ...call, answeredAt: new Date().toISOString() };
    this._activeCalls.set(uniqueId, enriched);

    const target = exten || agentExten || existing.exten || existing.agentExten;
    if (target) {
      this._ws.notifyExtension(target, 'call:answered', enriched);
      
      // Mettre à jour le statut de l'agent en 'on_call'
      if (this._callHistory) {
        try {
          await this._callHistory.setAgentOnCall(target, uniqueId);
        } catch (err) {
          logger.warn('Erreur mise à jour statut agent', { error: err.message, target });
        }
      }
    }
    
    // Mettre à jour l'historique IMMÉDIATEMENT avec answered_at
    if (this._callHistory) {
      try {
        await this._callHistory.updateCallAnswered(uniqueId);
        logger.info('Appel marqué comme décroché en BDD', { uniqueId });
      } catch (err) {
        logger.error('Erreur mise à jour appel décroché', { error: err.message, uniqueId });
      }
    }
    
    logger.info('Appel décroché', { uniqueId, target });
  }

  async _onHangup(call) {
    const { uniqueId } = call;
    const existing = this._activeCalls.get(uniqueId) || call;

    // Calculer la durée
    let duration = null;
    if (existing.timestamp) {
      duration = Math.round((Date.now() - new Date(existing.timestamp).getTime()) / 1000);
    }
    if (existing.answeredAt) {
      duration = Math.round((Date.now() - new Date(existing.answeredAt).getTime()) / 1000);
    }

    const enriched = { ...existing, ...call, hungUpAt: new Date().toISOString(), duration };
    this._activeCalls.delete(uniqueId);

    const target = existing.exten || existing.agentExten || call.exten;
    if (target) {
      this._ws.notifyExtension(target, 'call:hangup', enriched);
      
      // Mettre à jour le statut de l'agent en 'available' et ajouter les stats
      if (this._callHistory) {
        try {
          await this._callHistory.setAgentAvailable(target, duration || 0);
          await this._callHistory.removeActiveCall(uniqueId);
        } catch (err) {
          logger.warn('Erreur mise à jour statut agent', { error: err.message, target });
        }
      }
    }
    
    // Mettre à jour l'historique
    if (this._callHistory) {
      try {
        await this._callHistory.updateCallHangup(uniqueId, duration);
      } catch (err) {
        logger.error('Erreur mise à jour appel raccroché', { error: err.message, uniqueId });
      }
    }
    
    // Log automatique dans Odoo si un contact est associé
    const contact = enriched.contact;
    if (contact?.id && this._odoo) {
      const callStatus = enriched.answeredAt ? 'answered' : 'missed';
      this._odoo.logCallActivity(contact.id, {
        direction: enriched.direction || 'inbound',
        status:    callStatus,
        duration:  duration || 0,
        callerIdNum: enriched.callerIdNum,
        exten:     enriched.exten || enriched.agentExten,
        timestamp: enriched.timestamp,
      }).catch(() => {});
    }

    logger.info('Appel raccroché', { uniqueId, target, duration });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _isInternalNumber(number) {
    // Numéros internes : 1 à 5 chiffres
    return /^\d{1,5}$/.test(number.replace(/\D/g, ''));
  }

  // ── Polling HTTP ───────────────────────────────────────────────────────────

  _startPolling() {
    this._pollInterval = setInterval(() => this._poll().catch(() => {}), 3000);
  }

  async _poll() {
    if (this._isPolling || !this._http?.isAuthenticated()) return;
    this._isPolling = true;
    try { await this._doPoll(); } finally { this._isPolling = false; }
  }

  async _doPoll() {

    let bridgedChannels = [], unbridgedChannels = [];
    try {
      [bridgedChannels, unbridgedChannels] = await Promise.all([
        this._http.listBridgedChannels().catch(() => []),
        this._http.listUnBridgedChannels().catch(() => []),
      ]);
    } catch { return; }

    const seenIds = new Set();

    // ── 1. Traitement des canaux unbridged (sonnerie) ───────────────────────
    for (const ch of (unbridgedChannels || [])) {
      const uniqueId     = ch.uniqueid || ch.UniqueID || ch.callid || ch.id;
      if (!uniqueId) continue;
      seenIds.add(uniqueId);

      const callerIdNum  = ch.callernum  || ch.calleridnum  || ch.callerid  || '';
      const callerIdName = ch.callername || ch.calleridname || '';
      const exten        = ch.connectednum || ch.extension || ch.dst || '';

      // Ignorer les canaux internes Asterisk sans numéro réel
      if (exten === 's' || callerIdNum === 's') { seenIds.add(uniqueId); continue; }

      if (!this._activeCalls.has(uniqueId) && !this._polledCalls.has(uniqueId)) {
        const isCallerInternal = this._isInternalNumber(callerIdNum);
        const direction        = isCallerInternal ? 'outbound' : 'inbound';
        const agentExten       = isCallerInternal ? callerIdNum : exten;
        const actualCallerNum  = isCallerInternal ? exten : callerIdNum;
        const callData = { uniqueId, callerIdNum, callerIdName, exten, isBridged: false, direction, agentExten };
        this._polledCalls.set(uniqueId, callData);
        logger.info('Polling: appel détecté', { uniqueId, callerIdNum, exten, direction });
        this._onIncoming({ uniqueId, callerIdNum: actualCallerNum, callerIdName, exten, agentExten, direction, timestamp: new Date().toISOString() });
      }
    }

    // ── 2. Traitement des canaux bridged (décroché) ─────────────────────────
    // Format bridged : { uniqueid1, uniqueid2, callerid1, callerid2, name1, name2, ... }
    for (const b of (bridgedChannels || [])) {
      const uid1 = b.uniqueid1;
      const uid2 = b.uniqueid2;
      if (uid1) seenIds.add(uid1);
      if (uid2) seenIds.add(uid2);

      // Identifier l'uid du côté "appelant externe" (inbound trunk ou outbound)
      // On prend uid1 (trunk) comme uid principal de l'appel
      for (const [uid, callerid, name] of [[uid1, b.callerid1, b.name1], [uid2, b.callerid2, b.name2]]) {
        if (!uid) continue;

        if (this._polledCalls.has(uid)) {
          // Transition sonnerie → décroché
          const prev = this._polledCalls.get(uid);
          if (!prev.isBridged) {
            logger.info('Polling: appel décroché', { uniqueId: uid });
            this._polledCalls.set(uid, { ...prev, isBridged: true });
            const existing = this._activeCalls.get(uid) || prev;
            this._onAnswered({ uniqueId: uid, exten: existing.agentExten || existing.exten, agentExten: existing.agentExten || existing.exten });
          }
        } else if (!this._activeCalls.has(uid)) {
          // Appel déjà bridged dès la première détection (middleware redémarré pendant un appel)
          const partner = uid === uid1 ? b.callerid2 : b.callerid1;
          const isCallerInternal = this._isInternalNumber(callerid);
          const direction        = isCallerInternal ? 'outbound' : 'inbound';
          const agentExten       = isCallerInternal ? callerid : partner;
          const actualCaller     = isCallerInternal ? partner : callerid;
          const callData = { uniqueId: uid, callerIdNum: callerid, callerIdName: name, exten: partner, isBridged: true, direction, agentExten };
          this._polledCalls.set(uid, callData);
          logger.info('Polling: appel déjà décroché à la détection', { uniqueId: uid });
          this._onIncoming({ uniqueId: uid, callerIdNum: actualCaller, callerIdName: name, exten: partner, agentExten, direction, timestamp: new Date().toISOString() });
          this._onAnswered({ uniqueId: uid, exten: agentExten, agentExten });
        }
      }
    }

    // ── 3. Appels terminés : plus présents ni en bridged ni en unbridged ─────
    for (const [uid] of this._polledCalls) {
      if (!seenIds.has(uid)) {
        this._polledCalls.delete(uid);
        if (this._activeCalls.has(uid)) {
          logger.info('Polling: appel terminé', { uniqueId: uid });
          this._onHangup({ uniqueId: uid });
        }
      }
    }
  }

  // ── Monitoring ─────────────────────────────────────────────────────────────

  get activeCallsCount() { return this._activeCalls.size; }

  getActiveCalls() {
    return [...this._activeCalls.values()];
  }
}

module.exports = CallHandler;
