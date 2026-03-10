'use strict';

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const logger = require('../logger');

const DATA_FILE = path.join(process.cwd(), 'data', 'webhooks.json');

/**
 * Gère les tokens webhook et traite les événements entrants des UCM clients.
 *
 * Chaque client UCM dispose d'un token unique dans l'URL :
 *   GET /webhook/:token?event=ring&caller=0612345678&exten=1001&...
 *
 * Émet les mêmes événements que UcmClient :
 *   call:incoming, call:answered, call:hangup
 */
class WebhookManager extends EventEmitter {
  constructor() {
    super();
    this._tokens = new Map(); // token → { name, createdAt, lastUsed, callCount }
    this._load();
  }

  // ── Gestion des tokens ─────────────────────────────────────────────────────

  createToken(name) {
    const token = uuidv4();
    const info  = { name, createdAt: new Date().toISOString(), lastUsed: null, callCount: 0 };
    this._tokens.set(token, info);
    this._save();
    logger.info('Webhook: token créé', { name });
    return { token, ...info };
  }

  updateToken(token, fields) {
    const info = this._tokens.get(token);
    if (!info) return null;
    const allowed = ['name', 'ucmHost', 'ucmWebPort', 'ucmWebUser', 'ucmWebPassword', 'notes'];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) info[k] = v;
    }
    this._save();
    return { token, ...info };
  }

  deleteToken(token) {
    const existed = this._tokens.delete(token);
    if (existed) this._save();
    return existed;
  }

  listTokens() {
    return Array.from(this._tokens.entries()).map(([token, info]) => ({ token, ...info }));
  }

  hasToken(token) {
    return this._tokens.has(token);
  }

  // ── Traitement des événements entrants ─────────────────────────────────────

  /**
   * Traite une requête webhook entrante (query params de l'UCM).
   * @returns {boolean} true si l'événement a été traité
   */
  processEvent(token, params) {
    const info = this._tokens.get(token);
    if (!info) return false;

    info.lastUsed  = new Date().toISOString();
    info.callCount = (info.callCount || 0) + 1;
    this._save();

    const event    = (params.event || '').toLowerCase();
    const callInfo = this._normalize(params, info.name);

    logger.info('Webhook: événement reçu', { client: info.name, event, caller: callInfo.callerIdNum, exten: callInfo.exten });

    switch (event) {
      case 'ring':
      case 'ringing':
      case 'incoming':
        this.emit('call:incoming', callInfo);
        break;
      case 'answer':
      case 'answered':
        this.emit('call:answered', callInfo);
        break;
      case 'hangup':
      case 'end':
        this.emit('call:hangup', callInfo);
        break;
      default:
        logger.warn('Webhook: événement inconnu', { event });
        return false;
    }
    return true;
  }

  // ── Persistance ────────────────────────────────────────────────────────────

  _load() {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      if (fs.existsSync(DATA_FILE)) {
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        for (const [token, info] of Object.entries(raw)) {
          this._tokens.set(token, info);
        }
        logger.info(`Webhook: ${this._tokens.size} token(s) chargé(s)`);
      }
    } catch (err) {
      logger.warn('Webhook: chargement tokens échoué', { error: err.message });
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const out = {};
      for (const [token, info] of this._tokens) out[token] = info;
      fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2));
    } catch (err) {
      logger.warn('Webhook: sauvegarde tokens échouée', { error: err.message });
    }
  }

  // ── Normalisation des paramètres UCM → callInfo ───────────────────────────

  _normalize(p, clientName) {
    // Utiliser l'uniqueId de l'UCM si disponible, sinon générer un ID unique
    const uniqueId = p.uniqueid || p.uniqueId || p.unique_id || `wh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      uniqueId:     uniqueId,
      linkedId:     p.linkedid || p.linkedId || uniqueId,
      channel:      p.channel || '',
      callerIdNum:  p.caller || p.callerid || p.callerid_num || p.callernum || p.from || '',
      callerIdName: p.callerid_name || p.callername || p.from_name || '',
      exten:        p.exten || p.extension || p.dest || p.to || '',
      destChannel:  p.destchannel || p.dest_channel || '',
      agentExten:   p.agent || p.agent_exten || p.exten || '',
      queue:        p.queue || p.queue_name || '',
      direction:    p.direction || 'inbound',
      source:       'webhook',
      client:       clientName,
      timestamp:    new Date().toISOString(),
    };
  }
}

module.exports = WebhookManager;
