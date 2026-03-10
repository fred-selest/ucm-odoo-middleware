'use strict';

const logger = require('../logger');

/**
 * Orchestre le traitement d'un appel entrant :
 *   1. Reçoit l'événement UCM (call:incoming)
 *   2. Recherche le contact dans Odoo
 *   3. Notifie l'agent via WebSocket
 *   4. Gère call:answered et call:hangup de la même façon
 */
class CallHandler {
  /**
   * @param {UcmClient|null}      ucmClient       Client AMI (optionnel)
   * @param {OdooClient}          odooClient
   * @param {WsServer}            wsServer
   * @param {WebhookManager|null} webhookManager  Webhook manager (optionnel)
   */
  constructor(ucmClient, odooClient, wsServer, webhookManager = null) {
    this._odoo = odooClient;
    this._ws   = wsServer;

    // Registre des appels actifs : uniqueId → callInfo enrichi
    this._activeCalls = new Map();

    if (ucmClient) this._bindSource(ucmClient, 'UCM');
    if (webhookManager) this._bindSource(webhookManager, 'Webhook');
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
    const { uniqueId, callerIdNum, exten, agentExten } = call;
    logger.info('Appel entrant', { from: callerIdNum, to: exten || agentExten, uniqueId });

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

    // Notifier l'extension cible
    if (target) {
      this._ws.notifyExtension(target, 'call:incoming', enriched);
    }

    // Notifier le contact Odoo séparément si trouvé
    if (contact && target) {
      this._ws.notifyExtension(target, 'contact', { uniqueId, contact });
    }
  }

  _onAnswered(call) {
    const { uniqueId, exten, agentExten } = call;
    const existing = this._activeCalls.get(uniqueId) || call;
    const enriched = { ...existing, ...call, answeredAt: new Date().toISOString() };
    this._activeCalls.set(uniqueId, enriched);

    const target = exten || agentExten || existing.exten || existing.agentExten;
    if (target) {
      this._ws.notifyExtension(target, 'call:answered', enriched);
    }
    logger.info('Appel décroché', { uniqueId, target });
  }

  _onHangup(call) {
    const { uniqueId } = call;
    const existing = this._activeCalls.get(uniqueId) || call;

    // Calculer la durée
    let duration = null;
    if (existing.timestamp) {
      duration = Math.round((Date.now() - new Date(existing.timestamp).getTime()) / 1000);
    }

    const enriched = { ...existing, ...call, hungUpAt: new Date().toISOString(), duration };
    this._activeCalls.delete(uniqueId);

    const target = existing.exten || existing.agentExten || call.exten;
    if (target) {
      this._ws.notifyExtension(target, 'call:hangup', enriched);
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
