'use strict';

const path       = require('path');
const fs         = require('fs');
const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const config     = require('../../config');
const logger     = require('../../logger');

const BUILD_VERSION = Date.now();

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

// Middleware pour protéger les routes /api/* (sauf auth, test et santé)
function apiRequireSession(req, res, next) {
  const p = req.path;
  const isPublic =
    !p.startsWith('/api/') ||
    p.startsWith('/api/auth/') ||
    p.startsWith('/api/sirene/') ||
    p.startsWith('/api/webhook/') ||
    p === '/api/odoo/test';
  if (isPublic) return next();
  return requireSession(req, res, next);
}

function createRouter({ ucmHttpClient, ucmWsClient, crmClient, odooClient, wsServer, callHandler, webhookManager, callHistory, sireneService }) {
  // Rétrocompatibilité : accepter odooClient ou crmClient
  const crm = crmClient || odooClient;
  const router = Router();

  // ── Authentification obligatoire sur toutes les routes /api/* ────────────
  router.use(apiRequireSession);

  // ── Fichiers JS/CSS pour admin (avant autres routes) ─────────────────────
  router.get('/admin/js/:file', (req, res) => {
    res.sendFile(path.join(__dirname, '../admin/js/', req.params.file));
  });
  router.get('/admin/css/:file', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, '../admin/css/', req.params.file));
  });

  // ── Interface admin (sans auth) ─────────────────────────────────────────
  router.get(['/admin', '/admin/'], (req, res) => {
    const htmlPath = path.join(__dirname, '../admin/index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/(src="\/admin\/js\/[^"]+\.js)"/g, `$1?v=${BUILD_VERSION}"`);
    html = html.replace(/(href="\/admin\/css\/[^"]+\.css)"/g, `$1?v=${BUILD_VERSION}"`);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
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

  // ── Test Odoo (sans auth) ────────────────────────────────────────────────
  router.post('/api/odoo/test', async (req, res) => {
    try {
      const { phone } = req.body || {};
      if (phone) {
        const contact = await crm.findContactByPhone(phone);
        return res.json({ ok: true, contact });
      }
      await crm.ensureAuthenticated();
      res.json({ ok: true, message: 'Connexion Odoo OK' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Authentification requise pour /api/* ────────────────────────────────
  // ── Statut global (sans auth) ──────────────────────────────────────────
  router.get('/status', (req, res) => {
    res.json({
      ucm: {
        httpConnected: ucmHttpClient?.authenticated || false,
        wsConnected: ucmWsClient?.connected || false,
        mode:      config.ucm.mode,
        host:      config.ucm.host,
        port:      config.ucm.webPort,
        watchExtensions: config.ucm.watchExtensions,
      },
      crm: {
        type:          crm.crmType || config.crm?.type || 'odoo',
        authenticated: crm.isAuthenticated() || false,
        cacheSize:     crm.cacheSize,
      },
      odoo: {
        url:           config.odoo.url,
        db:            config.odoo.db,
        authenticated: config.crm?.type !== 'dolibarr' ? (crm.isAuthenticated() || false) : null,
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

  // ── Healthcheck public ──────────────────────────────────────────────────
  router.get('/health', (req, res) => {
    const { healthAgent } = req.app.locals;
    if (healthAgent) {
      const status = healthAgent.getStatus();
      const isHealthy = healthAgent.isHealthy();
      res.status(isHealthy ? 200 : 503).json(status);
    } else {
      const ucmHttpOk = ucmHttpClient?.authenticated || false;
      const ucmWsOk = ucmWsClient?.connected || false;
      const ucmOk = ucmHttpOk && ucmWsOk;
      res.status(ucmOk ? 200 : 503).json({
        status: ucmOk ? 'ok' : 'degraded',
        ucm: ucmOk,
        ucmHttp: ucmHttpOk,
        ucmWs: ucmWsOk,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── Supervision détaillée ───────────────────────────────────────────────
  router.get('/api/health/status', requireSession, (req, res) => {
    const { healthAgent } = req.app.locals;
    if (!healthAgent) {
      return res.status(503).json({ error: 'Agent de supervision non initialisé' });
    }
    res.json(healthAgent.getStatus());
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


  // ── Routes protégées (session requise, sauf auth) ────────────────────────

  router.get('/api/calls/active', (req, res) => {
    res.json({ count: callHandler.activeCallsCount, calls: callHandler.getActiveCalls() });
  });

  router.get('/api/ws/clients', (req, res) => {
    res.json({ count: wsServer.connectedCount, subscriptions: wsServer.subscriptions });
  });

  router.post('/api/cache/clear', (req, res) => {
    const { phone } = req.body || {};
    crm.invalidateCache(phone || null);
    logger.info('Cache contacts vidé', { phone: phone || 'all' });
    res.json({ ok: true, message: phone ? `Cache vidé pour ${phone}` : 'Cache entier vidé' });
  });


  // GET /api/odoo/search - Recherche de contacts par nom ou société
  router.get('/api/odoo/search', async (req, res) => {
    try {
      const { q, limit } = req.query;
      
      if (!q || q.trim().length < 2) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Le paramètre q (recherche) doit contenir au moins 2 caractères' 
        });
      }

      const contacts = await crm.searchContacts(
        q.trim(), 
        parseInt(limit) || 20
      );
      
      res.json({ 
        ok: true, 
        query: q.trim(),
        count: contacts.length,
        data: contacts 
      });
    } catch (err) {
      logger.error('Erreur recherche Odoo', { error: err.message, query: req.query.q });
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

  // ── Historique des appels ────────────────────────────────────────────────
  if (callHistory) {
    // GET /api/calls/history - Liste paginée des appels
    router.get('/api/calls/history', async (req, res) => {
      try {
        const options = {
          limit: parseInt(req.query.limit) || 50,
          offset: parseInt(req.query.offset) || 0,
          status: req.query.status,
          direction: req.query.direction,
          exten: req.query.exten,
          callerIdNum: req.query.caller,
          startDate: req.query.startDate,
          endDate: req.query.endDate,
          search: req.query.search
        };

        const [calls, total] = await Promise.all([
          callHistory.getCalls(options),
          callHistory.getCallsCount(options)
        ]);

        res.json({
          ok: true,
          data: calls,
          pagination: {
            total,
            limit: options.limit,
            offset: options.offset,
            hasMore: total > options.offset + options.limit
          }
        });
      } catch (err) {
        logger.error('Erreur récupération historique', { error: err.message });
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // GET /api/calls/history/:id - Détail d'un appel
    router.get('/api/calls/history/:id', async (req, res) => {
      try {
        const call = await callHistory.getCallById(req.params.id);
        if (!call) {
          return res.status(404).json({ ok: false, error: 'Appel non trouvé' });
        }
        res.json({ ok: true, data: call });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // GET /api/calls/missed - Appels manqués
    router.get('/api/calls/missed', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const calls = await callHistory.getCalls({ status: 'missed', limit });
        res.json({ ok: true, data: calls });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // POST /api/calls/:id/notes - Ajouter une note
    router.post('/api/calls/:id/notes', async (req, res) => {
      try {
        const { notes } = req.body || {};
        await callHistory.db.run(
          'UPDATE calls SET notes = ? WHERE id = ?',
          [notes, req.params.id]
        );
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });
  }

  // ── Statistiques ─────────────────────────────────────────────────────────
  if (callHistory) {
    // GET /api/stats - Statistiques globales
    router.get('/api/stats', async (req, res) => {
      try {
        const period = req.query.period || 'today';
        const stats = await callHistory.getStats(period);
        res.json({ ok: true, data: stats });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // GET /api/stats/extensions - Stats par extension
    router.get('/api/stats/extensions', async (req, res) => {
      try {
        const days = parseInt(req.query.days) || 30;
        const stats = await callHistory.getStatsByExtension(days);
        res.json({ ok: true, data: stats });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // GET /api/stats/hourly - Distribution horaire
    router.get('/api/stats/hourly', async (req, res) => {
      try {
        const distribution = await callHistory.getHourlyDistribution(req.query.date);
        res.json({ ok: true, data: distribution });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // GET /api/stats/top-callers - Top appelants
    router.get('/api/stats/top-callers', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 10;
        const days = parseInt(req.query.days) || 30;
        const callers = await callHistory.getTopCallers(limit, days);
        res.json({ ok: true, data: callers });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });
  }

  // ── Blacklist ────────────────────────────────────────────────────────────
  if (callHistory) {
    // GET /api/blacklist - Liste des numéros bloqués
    router.get('/api/blacklist', async (req, res) => {
      try {
        const options = {
          limit: parseInt(req.query.limit) || 50,
          offset: parseInt(req.query.offset) || 0,
          active: req.query.active !== 'false'
        };
        const blacklist = await callHistory.getBlacklist(options);
        res.json({ ok: true, data: blacklist });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // POST /api/blacklist - Ajouter un numéro
    router.post('/api/blacklist', async (req, res) => {
      try {
        const { phoneNumber, reason } = req.body || {};
        if (!phoneNumber) {
          return res.status(400).json({ ok: false, error: 'phoneNumber requis' });
        }
        await callHistory.addToBlacklist(phoneNumber, reason, req.session.username);
        res.json({ ok: true, message: 'Numéro ajouté à la blacklist' });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // DELETE /api/blacklist/:phone - Retirer un numéro
    router.delete('/api/blacklist/:phone', async (req, res) => {
      try {
        await callHistory.removeFromBlacklist(req.params.phone);
        res.json({ ok: true, message: 'Numéro retiré de la blacklist' });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // GET /api/blacklist/check/:phone - Vérifier si bloqué
    router.get('/api/blacklist/check/:phone', async (req, res) => {
      try {
        const isBlocked = await callHistory.isBlacklisted(req.params.phone);
        res.json({ ok: true, isBlocked });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });
  }

  // ── Configuration UCM / Odoo ────────────────────────────────────────────
  router.get('/api/config', (req, res) => {
    res.json({
      crm: {
        type: config.crm?.type || 'odoo',
      },
      ucm: {
        mode:            config.ucm.mode,
        host:            config.ucm.host,
        webPort:         config.ucm.webPort,
        username:        config.ucm.username,
        watchExtensions: config.ucm.watchExtensions,
        httpConnected:   ucmHttpClient?.authenticated || false,
        wsConnected:     ucmWsClient?.connected || false,
      },
      odoo: {
        url:      config.odoo.url,
        db:       config.odoo.db,
        username: config.odoo.username,
        // apiKey non exposée
      },
      dolibarr: {
        url:      config.dolibarr?.url      || '',
        userId:   config.dolibarr?.userId   || 1,
        entityId: config.dolibarr?.entityId || null,
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
    if (fields.webPort)  fields.webPort         = parseInt(fields.webPort, 10);
    if (watchExtensions !== undefined)
      fields.watchExtensions = Array.isArray(watchExtensions)
        ? watchExtensions : watchExtensions.split(',').map(s => s.trim()).filter(Boolean);

    config.applyUcm(fields);
    logger.info('Admin: config UCM mise à jour', { user: req.session.username, fields: Object.keys(fields) });

    // Reconnexion UCM
    await ucmHttpClient.disconnect();
    ucmWsClient.disconnect();
    setTimeout(async () => {
      try {
        await ucmHttpClient.connect();
        ucmWsClient.connect();
      } catch (err) {
        logger.error('UCM: échec reconnexion', { error: err.message });
      }
    }, 500);

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

    // Ré-authentification
    crm.invalidateCache();
    try {
      await crm.authenticate();
      res.json({ ok: true, message: 'Configuration Odoo sauvegardée — authentification OK' });
    } catch (err) {
      res.json({ ok: false, message: `Sauvegardé mais auth échouée : ${err.message}` });
    }
  });

  // POST /api/config/dolibarr — Configurer l'adaptateur Dolibarr
  router.post('/api/config/dolibarr', async (req, res) => {
    const { url, apiKey, userId, entityId } = req.body || {};
    const fields = {};
    if (url)      fields.url      = url.trim();
    if (apiKey)   fields.apiKey   = apiKey.trim();
    if (userId)   fields.userId   = parseInt(userId, 10);
    if (entityId) fields.entityId = entityId;

    config.applyDolibarr(fields);
    logger.info('Admin: config Dolibarr mise à jour', { user: req.session.username, fields: Object.keys(fields) });

    crm.invalidateCache();
    try {
      await crm.authenticate();
      res.json({ ok: true, message: 'Configuration Dolibarr sauvegardée — authentification OK' });
    } catch (err) {
      res.json({ ok: false, message: `Sauvegardé mais auth échouée : ${err.message}` });
    }
  });

  // ── Gestion des tokens webhook ───────────────────────────────────────────
  router.get('/api/webhooks', (req, res) => {
    const tokens = webhookManager ? webhookManager.listTokens() : [];
    res.json({ ok: true, data: tokens });
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

  // ═══════════════════════════════════════════════════════════════════════════
  // ══ CLICK-TO-CALL (Ringover style) ═════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /api/calls/dial - Initier un appel click-to-call
  router.post('/api/calls/dial', async (req, res) => {
    try {
      const { phone, exten, contactId } = req.body;
      
      if (!phone || !exten) {
        return res.status(400).json({ ok: false, error: 'Numéro et extension requis' });
      }

      // Créer un uniqueId pour cet appel
      const uniqueId = `dial-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Enregistrer l'appel sortant dans l'historique
      if (callHistory) {
        await callHistory.createCall({
          uniqueId,
          callerIdNum: phone,
          exten,
          direction: 'outbound',
          agentExten: exten
        });
      }

      // APPEL RÉEL VIA UCM HTTP API
      logger.info('Click-to-call: appel UCM en cours...', { phone, exten, uniqueId });
      
      // Déterminer si c'est un appel interne ou externe
      const isInternal = /^[0-9]{3,4}$/.test(phone); // Extension interne (3-4 chiffres)
      
      if (isInternal) {
        await ucmHttpClient.dialExtension(exten, phone);
        logger.info('Click-to-call: extension dialed', { exten, callee: phone, uniqueId });
      } else {
        await ucmHttpClient.dialOutbound(exten, phone);
        logger.info('Click-to-call: outbound dialed', { exten, outbound: phone, uniqueId });
      }
      
      // Diffuser l'événement aux agents
      const callInfo = {
        uniqueId,
        callerIdNum: phone,
        exten,
        direction: 'outbound',
        timestamp: new Date().toISOString(),
        contactId
      };

      wsServer.broadcast('call:outbound', callInfo);
      
      logger.info('Click-to-call initié', { phone, exten, uniqueId, user: req.session.username });
      
      res.json({ 
        ok: true, 
        uniqueId,
        message: `Appel en cours vers ${phone}`,
        call: callInfo
      });
    } catch (err) {
      logger.error('Erreur click-to-call', { error: err.message, stack: err.stack });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ══ GESTION DES NOTES ET TAGS ══════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /api/calls/:uniqueId/notes - Ajouter une note à un appel
  router.post('/api/calls/:uniqueId/notes', async (req, res) => {
    try {
      const { note } = req.body;
      if (!note || !note.trim()) {
        return res.status(400).json({ ok: false, error: 'Note requise' });
      }

      await callHistory.addCallNote(req.params.uniqueId, note.trim(), req.session.username);
      res.json({ ok: true, message: 'Note ajoutée' });
    } catch (err) {
      logger.error('Erreur ajout note', { error: err.message, uniqueId: req.params.uniqueId });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/calls/:uniqueId/tags - Mettre à jour les tags d'un appel
  router.put('/api/calls/:uniqueId/tags', async (req, res) => {
    try {
      const { tags } = req.body;
      if (!Array.isArray(tags)) {
        return res.status(400).json({ ok: false, error: 'Tags doit être un tableau' });
      }

      await callHistory.updateCallTags(req.params.uniqueId, tags);
      res.json({ ok: true, message: 'Tags mis à jour', tags });
    } catch (err) {
      logger.error('Erreur mise à jour tags', { error: err.message, uniqueId: req.params.uniqueId });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/calls/:uniqueId/rate - Noter un appel
  router.post('/api/calls/:uniqueId/rate', async (req, res) => {
    try {
      const { rating, notes } = req.body;
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ ok: false, error: 'Rating entre 1 et 5 requis' });
      }

      await callHistory.rateCall(req.params.uniqueId, rating, notes);
      res.json({ ok: true, message: 'Appel noté', rating });
    } catch (err) {
      logger.error('Erreur notation appel', { error: err.message, uniqueId: req.params.uniqueId });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/calls/:uniqueId - Détails d'un appel
  router.get('/api/calls/:uniqueId', async (req, res) => {
    try {
      const call = await callHistory.getCallByUniqueId(req.params.uniqueId);
      if (!call) {
        return res.status(404).json({ ok: false, error: 'Appel non trouvé' });
      }
      res.json({ ok: true, data: call });
    } catch (err) {
      logger.error('Erreur récupération appel', { error: err.message, uniqueId: req.params.uniqueId });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ══ STATUTS AGENTS (Ringover style) ════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/agents/status - Liste des statuts de tous les agents
  router.get('/api/agents/status', async (req, res) => {
    try {
      const agents = await callHistory.getAllAgentsStatus();
      res.json({ ok: true, data: agents });
    } catch (err) {
      logger.error('Erreur récupération statuts agents', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/agents/:exten/status - Statut d'un agent spécifique
  router.get('/api/agents/:exten/status', async (req, res) => {
    try {
      const status = await callHistory.getAgentStatus(req.params.exten);
      if (!status) {
        return res.json({ ok: true, data: { exten: req.params.exten, status: 'offline' } });
      }
      res.json({ ok: true, data: status });
    } catch (err) {
      logger.error('Erreur récupération statut agent', { error: err.message, exten: req.params.exten });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/agents/:exten/status - Mettre à jour le statut d'un agent
  router.put('/api/agents/:exten/status', async (req, res) => {
    try {
      const { status } = req.body;
      const validStatuses = ['available', 'busy', 'on_call', 'pause', 'offline'];
      
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ 
          ok: false, 
          error: `Statut invalide. Valeurs: ${validStatuses.join(', ')}` 
        });
      }

      await callHistory.updateAgentStatus(req.params.exten, status);
      
      // Diffuser le changement de statut à tous les clients WebSocket
      wsServer.broadcast('agent:status_changed', {
        exten: req.params.exten,
        status,
        timestamp: new Date().toISOString()
      });
      
      logger.info('Statut agent mis à jour', { exten: req.params.exten, status, user: req.session.username });
      res.json({ ok: true, message: 'Statut mis à jour', status });
    } catch (err) {
      logger.error('Erreur mise à jour statut agent', { error: err.message, exten: req.params.exten });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/agents/:exten/active-calls - Appels actifs d'un agent
  router.get('/api/agents/:exten/active-calls', async (req, res) => {
    try {
      const calls = await callHistory.getActiveCalls(req.params.exten);
      res.json({ ok: true, data: calls });
    } catch (err) {
      logger.error('Erreur récupération appels actifs', { error: err.message, exten: req.params.exten });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/agents/:exten/dnd - Activer/désactiver DND
  router.post('/api/agents/:exten/dnd', async (req, res) => {
    try {
      const enable = !!req.body?.enable;
      await ucmHttpClient.doNotDisturb(req.params.exten, enable);
      wsServer.broadcast('agent:dnd_changed', { exten: req.params.exten, dnd: enable });
      logger.info('DND mis à jour', { exten: req.params.exten, dnd: enable, user: req.session.username });
      res.json({ ok: true, dnd: enable });
    } catch (err) {
      logger.error('Erreur DND', { error: err.message, exten: req.params.exten });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/extensions - Liste des extensions UCM
  router.get('/api/extensions', async (req, res) => {
    try {
      const result = await ucmHttpClient.listExtensions();
      res.json({ ok: true, data: result || [] });
    } catch (err) {
      logger.error('Erreur liste extensions', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/calls/:uniqueId/transfer - Transférer un appel
  router.post('/api/calls/:uniqueId/transfer', async (req, res) => {
    try {
      const { extension } = req.body || {};
      if (!extension) return res.status(400).json({ ok: false, error: 'extension requise' });

      // Chercher le channel dans les appels actifs
      const activeCall = callHandler.getActiveCalls().find(c => c.uniqueId === req.params.uniqueId);

      let channel = activeCall?.channel;

      // Fallback : chercher le channel en live dans l'UCM
      if (!channel) {
        const [bridged, unbridged] = await Promise.all([
          ucmHttpClient.listBridgedChannels().catch(() => []),
          ucmHttpClient.listUnBridgedChannels().catch(() => []),
        ]);
        const all = [...bridged, ...unbridged];
        const match = all.find(ch =>
          (ch.uniqueid || ch.UniqueID || ch.callid || ch.id) === req.params.uniqueId
        );
        channel = match?.channel || match?.Channel;
      }

      if (!channel) return res.status(404).json({ ok: false, error: 'Channel introuvable pour cet appel' });

      await ucmHttpClient.callTransfer(channel, extension);
      logger.info('Appel transféré', { uniqueId: req.params.uniqueId, extension, user: req.session.username });
      res.json({ ok: true, message: `Appel transféré vers ${extension}` });
    } catch (err) {
      logger.error('Erreur transfert', { error: err.message, uniqueId: req.params.uniqueId });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ══ GESTION DES CONTACTS ODOO (Ringover style) ═════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/odoo/contacts/:id - Détails complets d'un contact
  router.get('/api/odoo/contacts/:id', async (req, res) => {
    try {
      const contact = await crm.getContactFull(parseInt(req.params.id));
      if (!contact) {
        return res.status(404).json({ ok: false, error: 'Contact non trouvé' });
      }
      res.json({ ok: true, data: contact });
    } catch (err) {
      logger.error('Erreur récupération contact', { error: err.message, id: req.params.id });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/odoo/contacts/:id/history - Historique des appels d'un contact
  router.get('/api/odoo/contacts/:id/history', async (req, res) => {
    try {
      const contactId = parseInt(req.params.id);
      const contact = await crm.getContactById(contactId);
      if (!contact) {
        return res.status(404).json({ ok: false, error: 'Contact non trouvé' });
      }

      // Récupérer les appels depuis l'historique par numéro de téléphone
      const phone = contact.phone || contact.mobile;
      let calls = [];
      if (phone && callHistory) {
        calls = await callHistory.getCalls({ callerIdNum: phone, limit: 100 });
      }

      res.json({
        ok: true,
        data: {
          contact,
          calls,
          stats: {
            totalCalls: calls.length,
            answeredCalls: calls.filter(c => c.status === 'answered').length,
            missedCalls: calls.filter(c => c.status === 'missed').length,
            totalDuration: calls.reduce((sum, c) => sum + (c.duration || 0), 0),
          }
        }
      });
    } catch (err) {
      logger.error('Erreur historique contact', { error: err.message, id: req.params.id });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/odoo/contacts/:id/messages - Messages chatter Odoo
  router.get('/api/odoo/contacts/:id/messages', async (req, res) => {
    try {
      const messages = await crm.getContactMessages(parseInt(req.params.id), 20);
      res.json({ ok: true, data: messages });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/odoo/contacts/:id/notes - Ajouter une note dans le chatter
  router.post('/api/odoo/contacts/:id/notes', async (req, res) => {
    try {
      const { note } = req.body || {};
      if (!note?.trim()) return res.status(400).json({ ok: false, error: 'Note requise' });
      await crm.addContactNote(parseInt(req.params.id), note.trim());
      logger.info('Note ajoutée sur contact Odoo', { id: req.params.id, user: req.session?.username });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/odoo/contacts - Créer un nouveau contact
  router.post('/api/odoo/contacts', async (req, res) => {
    try {
      const contactData = req.body;
      
      if (!contactData.name) {
        return res.status(400).json({ ok: false, error: 'Nom requis' });
      }
      
      const contact = await crm.createContact(contactData);
      logger.info('Contact créé via API', { id: contact.id, name: contact.name, user: req.session.username });
      
      res.json({ ok: true, data: contact });
    } catch (err) {
      logger.error('Erreur création contact', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/odoo/contacts/:id - Modifier un contact
  router.put('/api/odoo/contacts/:id', async (req, res) => {
    try {
      const contactId = parseInt(req.params.id);
      const contactData = req.body;
      
      const contact = await crm.updateContact(contactId, contactData);
      logger.info('Contact modifié via API', { id: contactId, user: req.session?.username });
      
      res.json({ ok: true, data: contact });
    } catch (err) {
      logger.error('Erreur modification contact', { error: err.message, id: req.params.id });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/calls/:uniqueId/link-contact - Associer un contact à un appel
  router.post('/api/calls/:uniqueId/link-contact', async (req, res) => {
    try {
      const { contactId } = req.body;
      if (!contactId) {
        return res.status(400).json({ ok: false, error: 'contactId requis' });
      }

      const call = await callHistory.getCallByUniqueId(req.params.uniqueId);
      if (!call) {
        return res.status(404).json({ ok: false, error: 'Appel non trouvé' });
      }

      const contact = await crm.getContactById(parseInt(contactId));
      if (!contact) {
        return res.status(404).json({ ok: false, error: 'Contact non trouvé' });
      }

      await callHistory.updateCallContact(req.params.uniqueId, {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        odooUrl: contact.odooUrl,
      });

      logger.info('Contact associé à l\'appel', { uniqueId: req.params.uniqueId, contactId });
      res.json({ ok: true, message: 'Contact associé' });
    } catch (err) {
      logger.error('Erreur association contact', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ══ ENREGISTREMENTS D'APPELS ═══════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /api/calls/:uniqueId/recording - Sauvegarder un enregistrement
  router.post('/api/calls/:uniqueId/recording', async (req, res) => {
    try {
      const { recordingUrl, duration } = req.body;
      
      if (!recordingUrl) {
        return res.status(400).json({ ok: false, error: 'recordingUrl requis' });
      }

      const call = await callHistory.getCallByUniqueId(req.params.uniqueId);
      if (!call) {
        return res.status(404).json({ ok: false, error: 'Appel non trouvé' });
      }

      await callHistory.saveCallRecording(req.params.uniqueId, recordingUrl, duration);
      
      // Notifier les clients WebSocket
      wsServer.broadcast('call:recording_saved', {
        uniqueId: req.params.uniqueId,
        recordingUrl,
        duration
      });

      logger.info('Enregistrement sauvegardé', { uniqueId: req.params.uniqueId, url: recordingUrl });
      res.json({ ok: true, message: 'Enregistrement sauvegardé' });
    } catch (err) {
      logger.error('Erreur sauvegarde enregistrement', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/recordings - Liste des enregistrements
  router.get('/api/recordings', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const recordings = await callHistory.getCallsWithRecordings(limit);
      
      res.json({ 
        ok: true, 
        data: recordings.map(c => ({
          uniqueId: c.unique_id,
          callerIdNum: c.caller_id_num,
          contactName: c.contact_name,
          recordingUrl: c.recording_url,
          duration: c.recording_duration || c.duration,
          startedAt: c.started_at,
        }))
      });
    } catch (err) {
      logger.error('Erreur récupération enregistrements', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/calls/:uniqueId/recording - Récupérer un enregistrement
  router.get('/api/calls/:uniqueId/recording', async (req, res) => {
    try {
      const call = await callHistory.getCallByUniqueId(req.params.uniqueId);
      if (!call) {
        return res.status(404).json({ ok: false, error: 'Appel non trouvé' });
      }
      if (!call.recording_url) {
        return res.status(404).json({ ok: false, error: 'Aucun enregistrement' });
      }
      
      res.json({
        ok: true,
        data: {
          uniqueId: call.unique_id,
          recordingUrl: call.recording_url,
          duration: call.recording_duration || call.duration,
        }
      });
    } catch (err) {
      logger.error('Erreur récupération enregistrement', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Synchro CDR UCM ─────────────────────────────────────────────────────────
  // POST /api/calls/sync-cdr?startTime=...&endTime=...
  router.post('/api/calls/sync-cdr', async (req, res) => {
    try {
      // Par défaut : aujourd'hui de 00:00 à maintenant
      const now   = new Date();
      const pad   = n => String(n).padStart(2, '0');
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const startTime = req.query.startTime || req.body?.startTime || `${today} 00:00:00`;
      const endTime   = req.query.endTime   || req.body?.endTime
        || `${today} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      logger.info('CDR sync: démarrage', { startTime, endTime });
      const { records, total } = await ucmHttpClient.fetchCdr(startTime, endTime);
      logger.info('CDR sync: enregistrements récupérés', { total, fetched: records.length });

      let inserted = 0;
      for (const cdr of records) {
        if (!cdr.uniqueid) continue;
        const ok = await callHistory.createCallFromCdr(cdr);
        if (ok) inserted++;
      }

      logger.info('CDR sync: terminée', { inserted, skipped: records.length - inserted });
      res.json({ ok: true, fetched: records.length, inserted, skipped: records.length - inserted, startTime, endTime });
    } catch (err) {
      logger.error('CDR sync: erreur', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── SIRENE INSEE — Enrichissement fiches clients ────────────────────────

  // GET /api/sirene/search?q=nom entreprise
  router.get('/api/sirene/search', async (req, res) => {
    try {
      if (!sireneService?.isConfigured) {
        return res.status(501).json({ ok: false, error: 'Service SIRENE non configuré (INSEE_SIRENE_API_KEY manquante)' });
      }
      const { q, limit } = req.query;
      if (!q) return res.status(400).json({ ok: false, error: 'Paramètre q requis' });

      const results = await sireneService.searchByName(q, parseInt(limit) || 5);
      res.json({ ok: true, total: results.length, data: results });
    } catch (err) {
      logger.error('SIRENE: erreur recherche', { error: err.message });
      res.status(err.message.includes('quota') ? 429 : 500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/sirene/siren/:siren
  router.get('/api/sirene/siren/:siren', async (req, res) => {
    try {
      if (!sireneService?.isConfigured) {
        return res.status(501).json({ ok: false, error: 'Service SIRENE non configuré' });
      }
      const result = await sireneService.searchBySiren(req.params.siren);
      if (!result) return res.status(404).json({ ok: false, error: 'SIREN non trouvé' });
      res.json({ ok: true, data: result });
    } catch (err) {
      logger.error('SIRENE: erreur SIREN', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/sirene/siret/:siret
  router.get('/api/sirene/siret/:siret', async (req, res) => {
    try {
      if (!sireneService?.isConfigured) {
        return res.status(501).json({ ok: false, error: 'Service SIRENE non configuré' });
      }
      const result = await sireneService.searchBySiret(req.params.siret);
      if (!result) return res.status(404).json({ ok: false, error: 'SIRET non trouvé' });
      res.json({ ok: true, data: result });
    } catch (err) {
      logger.error('SIRENE: erreur SIRET', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── SIRENE — Enrichissement automatique d'un contact CRM ─────────────────

  /**
   * POST /api/sirene/enrich
   * Body : { partnerId, siren?, siret?, companyName? }
   *
   * 1. Si siren/siret fourni → recherche SIRENE directe
   * 2. Sinon si companyName fourni → recherche par nom
   * 3. Sinon → lit le contact dans Odoo et cherche par son nom
   * 4. Met à jour le contact CRM avec les données SIRENE
   */
  router.post('/api/sirene/enrich', async (req, res) => {
    try {
      if (!sireneService?.isConfigured) {
        return res.status(501).json({ ok: false, error: 'Service SIRENE non configuré (INSEE_SIRENE_API_KEY manquante)' });
      }

      const { partnerId, siren, siret, companyName } = req.body || {};
      if (!partnerId) return res.status(400).json({ ok: false, error: 'partnerId requis' });

      let sireneData = null;

      // Priorité : SIRET > SIREN > nom entreprise > nom du contact Odoo
      if (siret) {
        sireneData = await sireneService.searchBySiret(siret);
      } else if (siren) {
        const ul = await sireneService.searchBySiren(siren);
        if (ul?.siretSiege) {
          sireneData = await sireneService.searchBySiret(ul.siretSiege);
        }
        if (!sireneData) sireneData = ul;
      } else {
        const searchName = companyName || await _getPartnerName(crm, partnerId);
        if (!searchName) return res.status(400).json({ ok: false, error: 'Impossible de déterminer le nom à rechercher' });

        const results = await sireneService.searchByName(searchName, 5);
        // Prendre le siège actif en priorité
        sireneData = results.find(e => e.siege && e.actif) || results.find(e => e.actif) || results[0];
      }

      if (!sireneData) return res.status(404).json({ ok: false, error: 'Aucun résultat SIRENE' });

      // Enrichir via l'adaptateur CRM (Odoo ou Dolibarr)
      if (!crm.enrichFromSirene) {
        return res.status(501).json({ ok: false, error: 'CRM ne supporte pas l\'enrichissement SIRENE' });
      }
      const enriched = await crm.enrichFromSirene(partnerId, sireneData);

      res.json({ ok: true, data: { contact: enriched, sirene: sireneData } });
    } catch (err) {
      logger.error('SIRENE enrich: erreur', { error: err.message });
      res.status(err.message.includes('quota') ? 429 : 500).json({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/webhook/odoo/partner
   * Webhook appelé par une action automatisée Odoo lors de la création/modification d'un contact.
   * Body Odoo : { id, name, company_name, company_registry, ... }
   */
  router.post('/api/webhook/odoo/partner', async (req, res) => {
    try {
      if (!sireneService?.isConfigured) {
        return res.status(501).json({ ok: false, error: 'Service SIRENE non configuré' });
      }

      const record = req.body || {};
      const partnerId = record.id;
      if (!partnerId) return res.status(400).json({ ok: false, error: 'id partenaire manquant' });

      // Ne pas re-enrichir si déjà un SIRET
      if (record.company_registry) {
        return res.json({ ok: true, skipped: true, reason: 'company_registry déjà renseigné' });
      }

      const searchName = record.company_name || record.name;
      if (!searchName || searchName.startsWith('Inconnu ')) {
        return res.json({ ok: true, skipped: true, reason: 'pas de nom d\'entreprise exploitable' });
      }

      logger.info('Webhook Odoo → enrichissement SIRENE', { partnerId, name: searchName });

      const results = await sireneService.searchByName(searchName, 5);
      const sireneData = results.find(e => e.siege && e.actif) || results.find(e => e.actif) || results[0];

      if (!sireneData) {
        return res.json({ ok: true, skipped: true, reason: 'aucun résultat SIRENE' });
      }

      if (crm.enrichFromSirene) {
        await crm.enrichFromSirene(partnerId, sireneData);
      }

      res.json({ ok: true, enriched: true, siret: sireneData.siret });
    } catch (err) {
      logger.error('Webhook SIRENE: erreur', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

// Helpers hors router
async function _getPartnerName(crm, partnerId) {
  try {
    const contact = await crm.getContactFull(partnerId);
    return contact?.company || contact?.name || null;
  } catch { return null; }
}

module.exports = createRouter;
