'use strict';

const logger = require('../../logger');
const config = require('../../config');

class HealthAgent {
  constructor() {
    this.status = {
      ucmHttp: 'unknown',
      ucmWebSocket: 'unknown',
      odoo: 'unknown',
      dolibarr: 'unknown',
      database: 'unknown',
      websocket: 'unknown',
      lastCallAt: null,
      callsToday: 0,
      uptime: 0,
    };
    this.checkInterval        = null;
    this.consecutiveFailures  = 0;
    this.maxFailures          = 3;
    this.alerted              = false;
    this._wsDisconnectedAt    = null;  // timestamp déconnexion WS UCM
    this._wsAlerted           = false; // alerte Telegram envoyée
  }

  start(ucmHttpClient, ucmWsClient, odooClient, wsServer, callHistory, dolibarrAgent = null) {
    logger.info('HealthAgent: démarrage de la supervision');

    this.ucmHttpClient = ucmHttpClient;
    this.ucmWsClient = ucmWsClient;
    this.odooClient = odooClient;
    this.wsServer = wsServer;
    this.callHistory = callHistory;
    this.dolibarrAgent = dolibarrAgent;

    if (this.dolibarrAgent) {
      this.dolibarrAgent.on('connected',    () => { this.status.dolibarr = 'connected'; });
      this.dolibarrAgent.on('disconnected', () => { this.status.dolibarr = 'disconnected'; });
    }

    if (this.ucmWsClient) {
      this.ucmWsClient.on('connected', () => {
        this.status.ucmWebSocket = 'connected';
        logger.debug('HealthAgent: UCM WebSocket → connected');
        if (this._wsAlerted) {
          this._sendTelegramAlert('✅ UCM WebSocket rétabli').catch(() => {});
        }
        this._wsDisconnectedAt = null;
        this._wsAlerted        = false;
      });
      this.ucmWsClient.on('disconnected', () => {
        this.status.ucmWebSocket = 'disconnected';
        logger.warn('HealthAgent: UCM WebSocket → disconnected');
        if (!this._wsDisconnectedAt) this._wsDisconnectedAt = Date.now();
      });
    }

    this.checkInterval = setInterval(() => this._checkAll(), 30000);
    this._checkAll();
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('HealthAgent: arrêt de la supervision');
  }

  async _checkAll() {
    const previousStatus = { ...this.status };
    let allHealthy = true;

    try {
      this.status.uptime = process.uptime();
      const memUsage = process.memoryUsage();
      this.status.memory = {
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
      };
      
      if (this.status.memory.heapUsed > 200) {
        logger.warn('HealthAgent: Augmentation mémoire élevée', {
          heapUsed: this.status.memory.heapUsed,
          heapTotal: this.status.memory.heapTotal,
        });
        if (!this.alerted && this.status.memory.heapUsed > 300) {
          logger.error('HealthAgent: ALERTE mémoire critique (>300MB)');
          this.alerted = true;
        }
      }
      
      this.status.websocket = this.wsServer?.getClientCount?.() > 0 ? 'connected' : 'disconnected';
      
      const dbStats = await this._checkDatabase();
      this.status.database = dbStats.healthy ? 'healthy' : 'error';
      this.status.lastCallAt = dbStats.lastCall;
      this.status.callsToday = dbStats.todayCount;

      if (dbStats.noRecentCalls) {
        logger.warn(`HealthAgent: Aucun appel depuis ${dbStats.lastCall || 'longtemps'}`);
      }

      this.status.ucmHttp = this.ucmHttpClient?.authenticated ? 'connected' : 'disconnected';
      if (this.status.ucmHttp === 'disconnected') {
        allHealthy = false;
      }

      this.status.ucmWebSocket = this.ucmWsClient?.isConnected ? 'connected' : 'disconnected';
      if (this.status.ucmWebSocket === 'disconnected') {
        allHealthy = false;
      }

      try {
        await this.odooClient.authenticate();
        this.status.odoo = 'connected';
      } catch (err) {
        this.status.odoo = 'error';
        allHealthy = false;
      }

      if (allHealthy) {
        this.consecutiveFailures = 0;
        if (this.alerted) {
          logger.info('HealthAgent: Tous les services sont rétablis ✅');
          this.alerted = false;
        }
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.maxFailures && !this.alerted) {
          logger.error('HealthAgent: ALERTE - Services dégradés', {
            ucmHttp: this.status.ucmHttp,
            ucmWebSocket: this.status.ucmWebSocket,
            odoo: this.status.odoo,
            database: this.status.database,
          });
          this.alerted = true;
        }
      }

      // Alerte Telegram si WS UCM déconnecté depuis > 30s
      if (this._wsDisconnectedAt && !this._wsAlerted) {
        const secsDown = Math.round((Date.now() - this._wsDisconnectedAt) / 1000);
        if (secsDown >= 30) {
          this._wsAlerted = true;
          this._sendTelegramAlert(
            `⚠️ UCM WebSocket DÉCONNECTÉ depuis ${secsDown}s (${config.ucm?.host || 'UCM'})`
          ).catch(() => {});
        }
      }

      if (this._hasStatusChanged(previousStatus, this.status)) {
        logger.info('HealthAgent: État mis à jour', this.status);
      }

    } catch (err) {
      logger.error('HealthAgent: erreur de vérification', { error: err.message });
      this.consecutiveFailures++;
    }
  }

  async _checkDatabase() {
    try {
      const todayCount = await this.callHistory?.getTodayCount?.() || 0;
      const lastCall = await this.callHistory?.getLastCallTime?.() || null;
      
      const noRecentCalls = lastCall && this._hoursSince(lastCall) > 2;
      
      return {
        healthy: true,
        todayCount,
        lastCall,
        noRecentCalls,
      };
    } catch (err) {
      return {
        healthy: false,
        error: err.message,
        todayCount: 0,
        lastCall: null,
        noRecentCalls: false,
      };
    }
  }

  _hoursSince(dateString) {
    if (!dateString) return 999;
    const diff = Date.now() - new Date(dateString).getTime();
    return Math.floor(diff / (1000 * 60 * 60));
  }

  _hasStatusChanged(prev, curr) {
    return JSON.stringify(prev) !== JSON.stringify(curr);
  }

  getStatus() {
    return {
      ...this.status,
      timestamp: new Date().toISOString(),
      consecutiveFailures: this.consecutiveFailures,
      alerted: this.alerted,
    };
  }

  isHealthy() {
    return (
      this.status.ucmHttp === 'connected' &&
      this.status.ucmWebSocket === 'connected' &&
      this.status.odoo === 'connected' &&
      this.status.database === 'healthy'
    );
  }

  async _sendTelegramAlert(message) {
    const token  = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      logger.warn('HealthAgent: TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID non configuré');
      return;
    }
    try {
      const axios = require('axios');
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id:    chatId,
        text:       `[UCM Middleware] ${message}`,
        parse_mode: 'HTML',
      });
      logger.info('HealthAgent: alerte Telegram envoyée', { message });
    } catch (err) {
      logger.error('HealthAgent: échec envoi Telegram', { error: err.message });
    }
  }
}

module.exports = HealthAgent;
