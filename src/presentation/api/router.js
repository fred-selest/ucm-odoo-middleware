'use strict';

const path       = require('path');
const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const config     = require('../../config');
const logger     = require('../../logger');

// ── Tampon de logs en mémoire ─────────────────────────────────────────────
const LOG_BUFFER     = [];
const LOG_BUFFER_MAX = 300;
logger.on('data', (info) => {
  LOG_BUFFER.push({ ts: new Date().toISOString(), level: info.level, msg: info.message });
  if (LOG_BUFFER.length > LOG_BUFFER_MAX) LOG_BUFFER.shift();
});

// ── Sessions Odoo en mémoire ──────────────────────────────────────────────
// token → { uid, username, expiresAt }
const SESSIONS      = new Map();
const SESSION_TTL   = 8 * 60 * 60 * 1000;   // 8 heures

function createSession(uid, username) {
  const token = uuidv4();
  SESSIONS.set(token, { uid, username, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

function checkSession(token) {
  if (!token) return null;
  const s = SESSIONS.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) { SESSIONS.delete(token); return null; }
  return s;
}

// ── Middleware auth session ───────────────────────────────────────────────
function requireSession(req, res, next) {
  const token = (req.headers['x-session-token'] || '').trim();
  const session = checkSession(token);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });
  req.session = session;
  next();
}

function createRouter({ ucmClient, odooClient, wsServer, callHandler, webhookManager }) {
  const router = Router();

  // ── Interface admin (sans auth) ─────────────────────────────────────────
  router.get(['/admin', '/admin/'], (req, res) => {
    res.sendFile(path.join(__dirname, '../admin/index.html'));
  });

  // ── Webhook UCM (public, protégé par token dans l'URL) ───────────────────
  router.get('/webhook/:token', (req, res) => {
    const { token } = req.params;
    if (!webhookManager?.hasToken(token)) {
      return res.status(401).json({ error: 'Token invalide' });
    }
    const ok = webhookManager.processEvent(token, req.query);
    if (!ok) return res.status(400).json({ error: 'Paramètre event manquant ou inconnu' });
    res.json({ ok: true });
  });

  // ── Healthcheck public ──────────────────────────────────────────────────
  router.get('/health', (req, res) => {
    const ucmOk = ucmClient.isConnected;
    res.status(ucmOk ? 200 : 503).json({
      status: ucmOk ? 'ok' : 'degraded', ucm: ucmOk,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Auth : login Odoo ───────────────────────────────────────────────────
  router.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: 'username et password requis' });
    try {
      const axios = require('axios');
      const r = await axios.post(`${config.odoo.url}/web/session/authenticate`, {
        jsonrpc: '2.0', method: 'call', id: 1,
        params: { db: config.odoo.db, login: username, password },
      }, { timeout: 8000 });
      const uid = r.data?.result?.uid;
      if (!uid) return res.status(401).json({ error: 'Identifiants incorrects' });
      const token = createSession(uid, username);
      logger.info('Admin: connexion', { username, uid });
      res.json({ ok: true, token, username, uid });
    } catch (err) {
      logger.error('Admin: échec login', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Auth : logout ───────────────────────────────────────────────────────
  router.post('/api/auth/logout', (req, res) => {
    const token = req.headers['x-session-token'] || '';
    SESSIONS.delete(token);
    res.json({ ok: true });
  });

  // ── Auth : vérifier session ─────────────────────────────────────────────
  router.get('/api/auth/me', (req, res) => {
    const token = req.headers['x-session-token'] || '';
    const s = checkSession(token);
    if (!s) return res.status(401).json({ error: 'Non authentifié' });
    res.json({ ok: true, username: s.username, uid: s.uid });
  });

  // ── Routes protégées (session requise) ──────────────────────────────────
  router.use('/api', requireSession);

  // ── Statut global ───────────────────────────────────────────────────────
  router.get('/api/status', (req, res) => {
    res.json({
      ucm: {
        connected: ucmClient.isConnected,
        mode:      config.ucm.mode,
        host:      config.ucm.host,
        port:      config.ucm.port,
        watchExtensions: config.ucm.watchExtensions,
      },
      odoo: {
        url:       config.odoo.url,
        db:        config.odoo.db,
        cacheSize: odooClient.cacheSize,
      },
      websocket: {
        clients:       wsServer.connectedCount,
        subscriptions: wsServer.subscriptions,
      },
      calls:     { active: callHandler.activeCallsCount },
      uptime:    process.uptime(),
      memory:    process.memoryUsage(),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/api/calls/active', (req, res) => {
    res.json({ count: callHandler.activeCallsCount, calls: callHandler.getActiveCalls() });
  });

  router.get('/api/ws/clients', (req, res) => {
    res.json({ count: wsServer.connectedCount, subscriptions: wsServer.subscriptions });
  });

  router.post('/api/cache/clear', (req, res) => {
    const { phone } = req.body || {};
    odooClient.invalidateCache(phone || null);
    logger.info('Cache contacts vidé', { phone: phone || 'all' });
    res.json({ ok: true, message: phone ? `Cache vidé pour ${phone}` : 'Cache entier vidé' });
  });

  router.post('/api/odoo/test', async (req, res) => {
    try {
      const { phone } = req.body || {};
      if (phone) {
        const contact = await odooClient.findContactByPhone(phone);
        return res.json({ ok: true, contact });
      }
      await odooClient.ensureAuthenticated();
      res.json({ ok: true, message: 'Connexion Odoo OK' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/api/logs', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '200', 10), LOG_BUFFER_MAX);
    res.json(LOG_BUFFER.slice(-limit));
  });

  router.post('/api/ws/broadcast', (req, res) => {
    const { type = 'test', data = {} } = req.body || {};
    res.json({ ok: true, sent: wsServer.broadcast(type, data) });
  });

  // ── Configuration UCM / Odoo ────────────────────────────────────────────
  router.get('/api/config', (req, res) => {
    res.json({
      ucm: {
        mode:            config.ucm.mode,
        host:            config.ucm.host,
        port:            config.ucm.port,
        username:        config.ucm.username,
        webPort:         config.ucm.webPort,
        webUser:         config.ucm.webUser,
        watchExtensions: config.ucm.watchExtensions,
        connected:       ucmClient.isConnected,
      },
      odoo: {
        url:      config.odoo.url,
        db:       config.odoo.db,
        username: config.odoo.username,
        // apiKey non exposée
      },
    });
  });

  router.post('/api/config/ucm', async (req, res) => {
    const { host, port, username, secret, watchExtensions, mode, webPort, webUser, webPassword } = req.body || {};
    const fields = {};
    if (mode)            fields.mode            = mode.trim();
    if (host)            fields.host            = host.trim();
    if (port)            fields.port            = parseInt(port, 10);
    if (username)        fields.username        = username.trim();
    if (secret !== undefined && secret !== '') fields.secret = secret;
    if (webPort)         fields.webPort         = parseInt(webPort, 10);
    if (webUser)         fields.webUser         = webUser.trim();
    if (webPassword !== undefined && webPassword !== '') fields.webPassword = webPassword;
    if (watchExtensions !== undefined)
      fields.watchExtensions = Array.isArray(watchExtensions)
        ? watchExtensions : watchExtensions.split(',').map(s => s.trim()).filter(Boolean);

    config.applyUcm(fields);
    logger.info('Admin: config UCM mise à jour', { user: req.session.username, fields: Object.keys(fields) });

    // Reconnexion UCM
    ucmClient.disconnect();
    setTimeout(() => ucmClient.connect(), 500);

    res.json({ ok: true, message: 'Configuration UCM sauvegardée — reconnexion en cours' });
  });

  router.post('/api/config/odoo', async (req, res) => {
    const { url, db, username, apiKey } = req.body || {};
    const fields = {};
    if (url)      fields.url      = url.trim();
    if (db)       fields.db       = db.trim();
    if (username) fields.username = username.trim();
    if (apiKey)   fields.apiKey   = apiKey.trim();

    config.applyOdoo(fields);
    logger.info('Admin: config Odoo mise à jour', { user: req.session.username, fields: Object.keys(fields) });

    // Ré-authentification Odoo
    odooClient._uid = null;
    try {
      await odooClient.authenticate();
      res.json({ ok: true, message: 'Configuration Odoo sauvegardée — authentification OK' });
    } catch (err) {
      res.json({ ok: false, message: `Sauvegardé mais auth échouée : ${err.message}` });
    }
  });

  // ── Gestion des tokens webhook ───────────────────────────────────────────
  router.get('/api/webhooks', (req, res) => {
    res.json(webhookManager ? webhookManager.listTokens() : []);
  });

  router.post('/api/webhooks', (req, res) => {
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name requis' });
    const entry = webhookManager.createToken(name.trim());
    logger.info('Admin: token webhook créé', { name, user: req.session.username });
    res.json(entry);
  });

  router.patch('/api/webhooks/:token', (req, res) => {
    const { name, ucmHost, ucmWebPort, ucmWebUser, ucmWebPassword, notes } = req.body || {};
    const updated = webhookManager?.updateToken(req.params.token, {
      ...(name           !== undefined && { name }),
      ...(ucmHost        !== undefined && { ucmHost }),
      ...(ucmWebPort     !== undefined && { ucmWebPort: parseInt(ucmWebPort, 10) || 8089 }),
      ...(ucmWebUser     !== undefined && { ucmWebUser }),
      ...(ucmWebPassword !== undefined && ucmWebPassword !== '' && { ucmWebPassword }),
      ...(notes          !== undefined && { notes }),
    });
    if (!updated) return res.status(404).json({ error: 'Token introuvable' });
    logger.info('Admin: webhook mis à jour', { user: req.session.username, token: req.params.token.slice(0,8) });
    res.json(updated);
  });

  router.post('/api/webhooks/:token/test-ucm', async (req, res) => {
    const info = webhookManager?.listTokens().find(t => t.token === req.params.token);
    if (!info) return res.status(404).json({ error: 'Token introuvable' });
    if (!info.ucmHost) return res.status(400).json({ error: 'Hôte UCM non configuré' });

    const axios = require('axios');
    const port  = info.ucmWebPort || 8089;
    const url   = `https://${info.ucmHost}:${port}/api`;
    try {
      await axios.get(url, { timeout: 4000, httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) });
      res.json({ ok: true, message: `UCM joignable sur ${info.ucmHost}:${port}` });
    } catch (err) {
      if (err.response) {
        res.json({ ok: true, message: `UCM joignable sur ${info.ucmHost}:${port} (HTTP ${err.response.status})` });
      } else {
        res.json({ ok: false, message: `Impossible de joindre ${info.ucmHost}:${port} — ${err.message}` });
      }
    }
  });

  router.delete('/api/webhooks/:token', (req, res) => {
    const deleted = webhookManager?.deleteToken(req.params.token);
    if (!deleted) return res.status(404).json({ error: 'Token introuvable' });
    logger.info('Admin: token webhook supprimé', { user: req.session.username });
    res.json({ ok: true });
  });

  return router;
}

module.exports = createRouter;
