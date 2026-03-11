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
      ucmWsClient.on('event', (event) => this.handleUcmEvent(event));
      ucmWsClient.on('connected', () => logger.info('CallHandler: UCM WebSocket connecté, prêt'));
      ucmWsClient.on('disconnected', () => logger.warn('CallHandler: UCM WebSocket déconnecté'));
    }

    // Webhook manager (fallback pour ancien UCM)
    if (webhookManager) this._bindSource(webhookManager, 'Webhook');
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
    
    // Mettre à jour l'historique
    if (this._callHistory) {
      try {
        await this._callHistory.updateCallAnswered(uniqueId);
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
    
    logger.info('Appel raccroché', { uniqueId, target, duration });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _isInternalNumber(number) {
    // Numéros internes : 1 à 5 chiffres
    return /^\d{1,5}$/.test(number.replace(/\D/g, ''));
  }

  // ── Monitoring ─────────────────────────────────────────────────────────────

  get activeCallsCount() { return this._activeCalls.size; }

  getActiveCalls() {
    return [...this._activeCalls.values()];
  }
}

module.exports = CallHandler;
