'use strict';

const WebSocket = require('ws');
const EventEmitter = require('events');
const config = require('../../config');
const logger = require('../../logger');

/**
 * Client WebSocket pour les événements Grandstream UCM6300
 * Reçoit les événements d'appel en temps réel
 * @class UcmWebSocketClient
 * @extends EventEmitter
 */
class UcmWebSocketClient extends EventEmitter {
  constructor() {
    super();
    this._ws = null;
    this._connected = false;
    this._reconnectDelay = config.ucm.reconnectDelay || 3000;
    this._reconnectMaxDelay = config.ucm.reconnectMaxDelay || 60000;
    this._currentDelay = this._reconnectDelay;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 10;
    this._heartbeatInterval = null;
    this._heartbeatTimeout = null;
    this._pendingEvents = [];
  }

  /**
   * Établit la connexion WebSocket à l'UCM
   * @returns {Promise<void>}
   */
  async connect() {
    const { host, webPort, username, password } = config.ucm;
    
    // Essayer plusieurs endpoints UCM6300
    const endpoints = ['/websockify', '/ws', '/api/ws'];
    let wsUrl = '';
    let connected = false;

    for (const endpoint of endpoints) {
      wsUrl = `wss://${host}:${webPort}${endpoint}`;
      logger.info('UCM WS: tentative connexion', { url: wsUrl });

      try {
        // Fermer l'ancienne connexion si elle existe encore
        if (this._ws) {
          this._ws.close(1000, 'Reconnection');
          this._ws = null;
        }
        this._ws = new WebSocket(wsUrl, {
          rejectUnauthorized: config.ucm.tls.rejectUnauthorized !== false,
          headers: {
            'Origin': `https://${host}:${webPort}`,
          },
        });

        await new Promise((resolveConn, rejectConn) => {
          this._ws.on('open', () => {
            logger.info('UCM WS: connecté', { endpoint });
            this._connected = true;
            this._reconnectAttempts = 0;
            this._currentDelay = this._reconnectDelay;
            this._startHeartbeat();
            this.emit('connected');
            this._flushPendingEvents();
            resolveConn();
          });

          this._ws.on('message', (data) => {
            this._handleMessage(data);
          });

          this._ws.on('pong', () => {
            this._handlePong();
          });

          this._ws.on('close', (code, reason) => {
            logger.warn('UCM WS: déconnecté', { code, reason: reason?.toString() });
            this._connected = false;
            this._stopHeartbeat();
            this.emit('disconnected', { code, reason });
            this._scheduleReconnect();
          });

          this._ws.on('error', (err) => {
            logger.debug('UCM WS: erreur endpoint', { endpoint, error: err.message });
            rejectConn(err);
          });

          setTimeout(() => rejectConn(new Error('Timeout')), 5000);
        });

        connected = true;
        break; // Sortir de la boucle si connecté

      } catch (err) {
        logger.debug('UCM WS: endpoint échoué', { endpoint });
        this._ws = null;
      }
    }

    if (!connected) {
      const err = new Error('Aucun endpoint WebSocket valide');
      logger.error('UCM WS: échec connexion', { error: err.message });
      this.emit('error', err);
      throw err;
    }

    return Promise.resolve();
  }

  /**
   * Traite les messages reçus du WebSocket
   * @param {Buffer} data
   * @private
   */
  _handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      logger.debug('UCM WS: message reçu', { type: message.event || message.action });

      // Mapper les événements UCM vers notre format
      const event = this._mapEvent(message);
      
      if (event) {
        this.emit('event', event);
        this.emit(`event:${event.type}`, event.data);
      }

    } catch (err) {
      logger.warn('UCM WS: message non-JSON', { error: err.message, data: data.toString().substring(0, 100) });
    }
  }

  /**
   * Mappe les événements UCM vers notre format interne
   * @param {object} message
   * @returns {object|null}
   * @private
   */
  _mapEvent(message) {
    // Format UCM6300 attendu
    switch (message.event || message.action) {
    case 'new_call':
    case 'New Call':
      return {
        type: 'call:incoming',
        data: {
          uniqueId: message.unique_id || message.UniqueID,
          callerIdNum: message.caller_id_num || message.CallerIDNum || message.src,
          callerIdName: message.caller_id_name || message.CallerIDName || message.srcname,
          exten: message.destination || message.Destination || message.dst,
          channel: message.channel || message.Channel,
          direction: message.direction || 'inbound',
          timestamp: message.timestamp || new Date().toISOString(),
        }
      };

    case 'call_answered':
    case 'Call Answered':
      return {
        type: 'call:answered',
        data: {
          uniqueId: message.unique_id || message.UniqueID,
          exten: message.exten || message.Extension,
          channel: message.channel || message.Channel,
          answerTime: message.answer_time || new Date().toISOString(),
        }
      };

    case 'call_hangup':
    case 'Call Hangup':
      return {
        type: 'call:hangup',
        data: {
          uniqueId: message.unique_id || message.UniqueID,
          channel: message.channel || message.Channel,
          duration: message.duration || message.BillSec || 0,
          disposition: message.disposition || 'ANSWERED',
          hangupTime: message.hangup_time || new Date().toISOString(),
        }
      };

    case 'call_hold':
      return {
        type: 'call:hold',
        data: {
          uniqueId: message.unique_id,
          channel: message.channel,
        }
      };

    case 'call_unhold':
      return {
        type: 'call:unhold',
        data: {
          uniqueId: message.unique_id,
          channel: message.channel,
        }
      };

    case 'call_transfer':
      return {
        type: 'call:transfer',
        data: {
          uniqueId: message.unique_id,
          channel: message.channel,
          target: message.target,
        }
      };

    default:
      logger.debug('UCM WS: événement non géré', { event: message.event || message.action });
      return null;
    }
  }

  /**
   * Démarre le heartbeat (ping/pong)
   * @private
   */
  _startHeartbeat() {
    this._heartbeatInterval = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.ping();
        
        this._heartbeatTimeout = setTimeout(() => {
          logger.warn('UCM WS: heartbeat timeout, déconnexion');
          this._ws.terminate();
        }, 10000);
      }
    }, 8000);
  }

  /**
   * Arrête le heartbeat
   * @private
   */
  _stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
    if (this._heartbeatTimeout) {
      clearTimeout(this._heartbeatTimeout);
      this._heartbeatTimeout = null;
    }
  }

  /**
   * Gère le pong du serveur
   * @private
   */
  _handlePong() {
    if (this._heartbeatTimeout) {
      clearTimeout(this._heartbeatTimeout);
      this._heartbeatTimeout = null;
    }
  }

  /**
   * Planifie une reconnexion automatique
   * @private
   */
  _scheduleReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      logger.error('UCM WS: max tentatives atteintes', { attempts: this._reconnectAttempts });
      this.emit('max_reconnect_attempts_reached');
      return;
    }

    this._reconnectAttempts++;
    logger.info('UCM WS: reconnexion dans', { delay: this._currentDelay, attempt: this._reconnectAttempts });

    setTimeout(() => {
      this.connect().catch(err => {
        logger.error('UCM WS: échec reconnexion', { error: err.message });
      });
    }, this._currentDelay);

    // Backoff exponentiel
    this._currentDelay = Math.min(
      this._currentDelay * 2,
      this._reconnectMaxDelay
    );
  }

  /**
   * Envoie les événements en attente après reconnexion
   * @private
   */
  _flushPendingEvents() {
    // Noter: Les événements UCM sont temps réel, on ne rejoue pas les anciens
    this._pendingEvents = [];
  }

  /**
   * Vérifie si connecté
   * @returns {boolean}
   */
  isConnected() {
    return this._connected && this._ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Déconnexion propre
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._stopHeartbeat();
    
    return new Promise((resolve) => {
      if (this._ws) {
        this._ws.close(1000, 'Client disconnect');
        this._ws = null;
      }
      this._connected = false;
      logger.info('UCM WS: déconnecté');
      resolve();
    });
  }

  /**
   * Getter pour le nombre de tentatives
   */
  get reconnectAttempts() {
    return this._reconnectAttempts;
  }

  /**
   * Setter pour le nombre de tentatives
   * @param {number} value
   */
  set reconnectAttempts(value) {
    this._reconnectAttempts = value;
  }
}

module.exports = UcmWebSocketClient;
