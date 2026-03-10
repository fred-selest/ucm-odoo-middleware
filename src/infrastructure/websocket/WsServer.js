'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 }                 = require('uuid');
const config                         = require('../../config');
const logger                         = require('../../logger');

/**
 * Serveur WebSocket pour notifier les agents CTI en temps réel.
 *
 * Protocole client → serveur (JSON) :
 *   { type: 'subscribe', extension: '1001' }   s'enregistrer pour une extension
 *   { type: 'ping' }                             keepalive
 *
 * Protocole serveur → client (JSON) :
 *   { type: 'pong' }
 *   { type: 'call:incoming',  data: CallInfo }
 *   { type: 'call:answered',  data: CallInfo }
 *   { type: 'call:hangup',    data: CallInfo }
 *   { type: 'contact',        data: ContactInfo }
 *   { type: 'error',          message: string }
 */
class WsServer {
  constructor(httpServer) {
    this._wss     = new WebSocketServer({ server: httpServer, path: config.server.wsPath });
    this._clients = new Map();   // clientId → { ws, extensions: Set }
    this._setupServer();
  }

  // ── API publique ───────────────────────────────────────────────────────────

  /** Notifie les clients abonnés à une extension donnée. */
  notifyExtension(extension, type, data) {
    let sent = 0;
    for (const [, client] of this._clients) {
      if (client.extensions.size === 0 || client.extensions.has(extension)) {
        this._send(client.ws, { type, data });
        sent++;
      }
    }
    logger.debug('WS: notification envoyée', { extension, type, sent });
    return sent;
  }

  /** Diffuse un message à tous les clients connectés. */
  broadcast(type, data) {
    let sent = 0;
    for (const [, client] of this._clients) {
      this._send(client.ws, { type, data });
      sent++;
    }
    return sent;
  }

  get connectedCount() { return this._clients.size; }

  get subscriptions() {
    const result = {};
    for (const [id, client] of this._clients) {
      result[id] = [...client.extensions];
    }
    return result;
  }

  // ── Privé ──────────────────────────────────────────────────────────────────

  _setupServer() {
    this._wss.on('connection', (ws, req) => {
      const clientId = uuidv4().slice(0, 8);
      const ip       = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      logger.info('WS: client connecté', { clientId, ip });

      this._clients.set(clientId, { ws, extensions: new Set() });

      ws.on('message', raw => this._handleMessage(clientId, raw));
      ws.on('close',   ()  => this._handleClose(clientId));
      ws.on('error',   err => logger.warn('WS: erreur client', { clientId, error: err.message }));
      ws.on('pong',    ()  => { /* keepalive reçu */ });

      // Heartbeat toutes les 30s
      const hb = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(hb);
        }
      }, 30000);

      ws.once('close', () => clearInterval(hb));

      // Message de bienvenue
      this._send(ws, { type: 'connected', clientId, timestamp: new Date().toISOString() });
    });

    this._wss.on('error', err => logger.error('WS: erreur serveur', { error: err.message }));
    logger.info('WS: serveur démarré', { path: config.server.wsPath });
  }

  _handleMessage(clientId, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      logger.warn('WS: message non-JSON reçu', { clientId });
      return;
    }

    const client = this._clients.get(clientId);
    if (!client) return;

    switch (msg.type) {
      case 'subscribe': {
        const exten = String(msg.extension || '').trim();
        if (exten) {
          client.extensions.add(exten);
          logger.info('WS: abonnement extension', { clientId, extension: exten });
          this._send(client.ws, { type: 'subscribed', extension: exten });
        }
        break;
      }

      case 'unsubscribe': {
        const exten = String(msg.extension || '').trim();
        client.extensions.delete(exten);
        logger.debug('WS: désabonnement', { clientId, extension: exten });
        break;
      }

      case 'ping':
        this._send(client.ws, { type: 'pong', ts: Date.now() });
        break;

      default:
        logger.debug('WS: type de message inconnu', { clientId, type: msg.type });
    }
  }

  _handleClose(clientId) {
    const client = this._clients.get(clientId);
    const extensions = client ? [...client.extensions] : [];
    this._clients.delete(clientId);
    logger.info('WS: client déconnecté', { clientId, extensions });
  }

  _send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}

module.exports = WsServer;
