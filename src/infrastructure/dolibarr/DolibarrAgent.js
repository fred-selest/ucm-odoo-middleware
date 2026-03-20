'use strict';

const { EventEmitter } = require('events');
const logger           = require('../../logger');
const config           = require('../../config');

/**
 * DolibarrAgent — gestion du cycle de vie de la connexion Dolibarr.
 *
 * Valide périodiquement la clé API Dolibarr via adapter.authenticate().
 * Émet les événements :
 *   'connected'    — connexion établie ou rétablie
 *   'disconnected' — perte de connexion détectée
 *   'error'        — erreur lors d'une vérification
 *
 * Propriétés publiques :
 *   isConnected  {boolean}
 *   lastError    {string|null}
 *   lastCheck    {Date|null}
 */
class DolibarrAgent extends EventEmitter {

  constructor() {
    super();
    this._adapter            = null;
    this._interval           = null;
    this._isConnected        = false;
    this.lastError           = null;
    this.lastCheck           = null;
    this._consecutiveFail    = 0;
    this._alertSent          = false;
    this._disconnectedAt     = null;
    this._checkPeriod        = parseInt(process.env.DOLIBARR_CHECK_INTERVAL || '60000', 10);
  }

  // ── Cycle de vie ──────────────────────────────────────────────────────────

  /**
   * @param {import('../crm/adapters/DolibarrAdapter')} adapter
   */
  start(adapter) {
    this._adapter = adapter;
    logger.info('DolibarrAgent: démarrage de la supervision Dolibarr');
    this._check();
    this._interval = setInterval(() => this._check(), this._checkPeriod);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    logger.info('DolibarrAgent: arrêt de la supervision Dolibarr');
  }

  // ── Propriété publique ────────────────────────────────────────────────────

  get isConnected() { return this._isConnected; }

  // ── Vérification périodique ───────────────────────────────────────────────

  async _check() {
    this.lastCheck = new Date();
    try {
      await this._adapter.authenticate();
      this.lastError        = null;
      this._consecutiveFail = 0;

      if (!this._isConnected) {
        this._isConnected    = true;
        this._disconnectedAt = null;
        logger.info('DolibarrAgent: connexion établie');
        this.emit('connected');
        if (this._alertSent) {
          this._alertSent = false;
          this._sendTelegramAlert('✅ Dolibarr rétabli').catch(() => {});
        }
      }
    } catch (err) {
      this.lastError = err.message;
      this._consecutiveFail++;

      if (this._isConnected) {
        this._isConnected    = false;
        this._disconnectedAt = Date.now();
        logger.warn('DolibarrAgent: connexion perdue', { error: err.message });
        this.emit('disconnected');
      }

      this.emit('error', err);
      logger.error('DolibarrAgent: échec vérification', {
        error: err.message,
        consecutiveFail: this._consecutiveFail,
      });

      // Alerte Telegram après 3 échecs consécutifs
      if (this._consecutiveFail >= 3 && !this._alertSent) {
        this._alertSent = true;
        const secsDown = this._disconnectedAt
          ? Math.round((Date.now() - this._disconnectedAt) / 1000)
          : 0;
        this._sendTelegramAlert(
          `⚠️ Dolibarr INACCESSIBLE depuis ${secsDown}s — ${err.message}`
        ).catch(() => {});
      }
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      connected:       this._isConnected,
      lastError:       this.lastError,
      lastCheck:       this.lastCheck ? this.lastCheck.toISOString() : null,
      consecutiveFail: this._consecutiveFail,
    };
  }

  // ── Telegram ──────────────────────────────────────────────────────────────

  async _sendTelegramAlert(message) {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    try {
      const axios = require('axios');
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id:    chatId,
        text:       `[UCM Middleware] ${message}`,
        parse_mode: 'HTML',
      });
      logger.info('DolibarrAgent: alerte Telegram envoyée', { message });
    } catch (err) {
      logger.error('DolibarrAgent: échec envoi Telegram', { error: err.message });
    }
  }
}

module.exports = DolibarrAgent;
