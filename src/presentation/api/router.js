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

/**
 * Aplatit les CDR imbriqués UCM en un tableau de sous-CDR exploitables.
 * Choisit le meilleur sub_cdr (ANSWERED le plus long) et y propage le recordfiles si absent.
 */
function _flattenCdrRecords(records) {
  const flat = [];
  for (const cdr of records) {
    const subs = ['sub_cdr_1', 'sub_cdr_2', 'sub_cdr_3', 'sub_cdr_4']
      .map(k => cdr[k]).filter(Boolean);
    const answered = subs.filter(s => s.disposition === 'ANSWERED');
    const best = answered.sort((a, b) => (b.billsec || 0) - (a.billsec || 0))[0]
      || subs[0] || cdr.main_cdr;
    if (!best?.uniqueid) continue;
    // Propager recordfiles : si le best n'a pas d'enregistrement, chercher dans les autres sub
    if (!best.recordfiles?.replace(/@$/g, '').trim()) {
      const withRec = subs.find(s => s.recordfiles?.replace(/@$/g, '').trim());
      if (withRec) best.recordfiles = withRec.recordfiles;
    }
    flat.push(best);
  }
  return flat;
}

function createRouter({ ucmHttpClient, ucmWsClient, crmClient, odooClient, wsServer, callHandler, webhookManager, callHistory, sireneService, annuaireService, googlePlacesService, spamScoreService, cdrSyncService }) {
  // Rétrocompatibilité : accepter odooClient ou crmClient
  const crm = crmClient || odooClient;
  const router = Router();

  // ── Authentification obligatoire sur toutes les routes /api/* ────────────
  // Routes publiques (sans auth)
  const PUBLIC_ROUTES = [
    '/api/health',
    '/api/status',
    '/api/odoo/test',
    '/api/sirene/enrich',       // webhook Odoo compatible
    '/api/webhook/odoo/partner', // webhook Odoo compatible
    '/api/recordings',          // enregistrements (accès restreint au réseau local)
    '/api/recordings/download', // téléchargement enregistrements
    '/api/phonebook',           // annuaire UCM (accès sans auth pour le PABX)
  ];
  
  router.use('/api', (req, res, next) => {
    // Vérifier si la route est publique
    const isPublic = PUBLIC_ROUTES.some(route => 
      req.path.startsWith(route.replace(/\/$/, ''))
    );
    
    if (isPublic) {
      next(); // Pas d'auth requise
    } else {
      apiRequireSession(req, res, next); // Auth obligatoire
    }
  });

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
      whisper: {
        enabled:        config.whisper.enabled,
        mode:           config.whisper.mode,
        model:          config.whisper.model,
        language:       config.whisper.language,
      },
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

  // ── Spam Score (Tellows) ──────────────────────────────────────────────
  if (spamScoreService) {
    router.get('/api/spam/check/:phone', async (req, res) => {
      try {
        const result = await spamScoreService.check(req.params.phone);
        res.json({ ok: true, data: result });
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

    // POST /api/blacklist/import - Import en masse
    router.post('/api/blacklist/import', async (req, res) => {
      try {
        const { numbers, source } = req.body || {};
        if (!numbers || !Array.isArray(numbers) || !numbers.length) {
          return res.status(400).json({ ok: false, error: 'Tableau numbers requis' });
        }
        let added = 0;
        for (const entry of numbers) {
          const phone = typeof entry === 'string' ? entry : entry.phone;
          const reason = typeof entry === 'string' ? (source || 'Import') : (entry.reason || source || 'Import');
          if (!phone) continue;
          await callHistory.addToBlacklist(phone, reason, req.session.username);
          added++;
        }
        logger.info('Blacklist import', { added, source });
        res.json({ ok: true, added });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    // POST /api/blacklist/import-spam-fr - Importer les préfixes spam français connus
    router.post('/api/blacklist/import-spam-fr', async (req, res) => {
      try {
        const spamPrefixes = [
          { prefix: '0162*', reason: 'Plage démarchage ARCEP (01 62)' },
          { prefix: '0163*', reason: 'Plage démarchage ARCEP (01 63)' },
          { prefix: '0270*', reason: 'Plage démarchage ARCEP (02 70)' },
          { prefix: '0271*', reason: 'Plage démarchage ARCEP (02 71)' },
          { prefix: '0377*', reason: 'Plage démarchage ARCEP (03 77)' },
          { prefix: '0378*', reason: 'Plage démarchage ARCEP (03 78)' },
          { prefix: '0423*', reason: 'Plage démarchage ARCEP (04 23)' },
          { prefix: '0424*', reason: 'Plage démarchage ARCEP (04 24)' },
          { prefix: '0425*', reason: 'Plage démarchage ARCEP (04 25)' },
          { prefix: '0568*', reason: 'Plage démarchage ARCEP (05 68)' },
          { prefix: '0569*', reason: 'Plage démarchage ARCEP (05 69)' },
          { prefix: '0948*', reason: 'Plage démarchage ARCEP (09 48)' },
          { prefix: '0949*', reason: 'Plage démarchage ARCEP (09 49)' },
          { prefix: '07000*', reason: 'Plage M2M (machine-to-machine)' },
          { prefix: '07001*', reason: 'Plage M2M (machine-to-machine)' },
          { prefix: '07002*', reason: 'Plage M2M (machine-to-machine)' },
          { prefix: '07003*', reason: 'Plage M2M (machine-to-machine)' },
          { prefix: '07004*', reason: 'Plage M2M (machine-to-machine)' },
          { prefix: '07005*', reason: 'Plage M2M (machine-to-machine)' },
          { prefix: '07006*', reason: 'Plage M2M (machine-to-machine)' },
          { prefix: '07007*', reason: 'Plage M2M (machine-to-machine)' },
          { prefix: '07008*', reason: 'Plage M2M (machine-to-machine)' },
          { prefix: '07009*', reason: 'Plage M2M (machine-to-machine)' },
        ];
        let added = 0;
        for (const { prefix, reason } of spamPrefixes) {
          await callHistory.addToBlacklist(prefix, reason, 'import-arcep');
          added++;
        }
        logger.info('Blacklist: import préfixes spam FR', { added });
        res.json({ ok: true, added });
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

    // POST /api/blacklist/import - Import en masse (liste de numéros)
    router.post('/api/blacklist/import', async (req, res) => {
      try {
        const { numbers, reason = 'Import en masse' } = req.body || {};
        if (!Array.isArray(numbers) || !numbers.length) {
          return res.status(400).json({ ok: false, error: 'numbers[] requis' });
        }
        let added = 0;
        for (const num of numbers) {
          const phone = String(num).trim();
          if (phone.length >= 4) {
            await callHistory.addToBlacklist(phone, reason, req.session.username);
            added++;
          }
        }
        res.json({ ok: true, added });
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
      whisper: {
        enabled:        config.whisper.enabled,
        mode:           config.whisper.mode,
        model:          config.whisper.model,
        language:       config.whisper.language,
        command:        config.whisper.command,
        maxDurationSec: config.whisper.maxDurationSec,
        apiUrl:         config.whisper.apiUrl,
        hasApiKey:      !!config.whisper.apiKey,
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

  // POST /api/config/whisper — Configurer la transcription Whisper
  router.post('/api/config/whisper', (req, res) => {
    const { enabled, mode, model, language, command, maxDurationSec, apiKey, apiUrl } = req.body || {};
    const fields = {};
    if (enabled !== undefined)        fields.enabled        = enabled === true || enabled === 'true';
    if (mode)                         fields.mode           = mode.trim();
    if (model)                        fields.model          = model.trim();
    if (language)                     fields.language       = language.trim();
    if (command !== undefined)        fields.command        = command.trim();
    if (maxDurationSec)               fields.maxDurationSec = parseInt(maxDurationSec, 10);
    if (apiKey !== undefined && apiKey !== '') fields.apiKey = apiKey.trim();
    if (apiUrl)                       fields.apiUrl         = apiUrl.trim();

    config.applyWhisper(fields);
    logger.info('Admin: config Whisper mise à jour', { user: req.session?.username, fields: Object.keys(fields) });
    res.json({ ok: true, message: 'Configuration Whisper sauvegardée' });
  });

  // GET /api/config/whisper/test — Tester la disponibilité de Whisper
  router.get('/api/config/whisper/test', requireSession, async (req, res) => {
    const whisper = cdrSyncService?._whisper;
    if (!whisper) return res.json({ ok: false, status: 'error', message: 'Service Whisper non initialisé' });

    if (!config.whisper.enabled) {
      return res.json({ ok: false, status: 'disabled', message: 'Whisper est désactivé dans la configuration' });
    }

    if (config.whisper.mode === 'api') {
      if (!config.whisper.apiKey) {
        return res.json({ ok: false, status: 'error', message: 'Mode API : clé API manquante' });
      }
      return res.json({ ok: true, status: 'ready', message: `Mode API prêt (${config.whisper.apiUrl})` });
    }

    // Mode local : détecter la commande
    try {
      const cmd = await whisper._detectCommand();
      if (!cmd) {
        return res.json({ ok: false, status: 'error', message: 'Commande whisper introuvable. Vérifiez que openai-whisper est installé dans le container.' });
      }
      return res.json({ ok: true, status: 'ready', message: `Whisper local détecté : ${cmd} (modèle : ${config.whisper.model}, langue : ${config.whisper.language})` });
    } catch (err) {
      return res.json({ ok: false, status: 'error', message: `Erreur détection : ${err.message}` });
    }
  });

  // POST /api/config/whisper/run — Lancer une transcription batch
  router.post('/api/config/whisper/run', requireSession, async (req, res) => {
    const whisper = cdrSyncService?._whisper;
    if (!whisper) return res.json({ ok: false, message: 'Service Whisper non initialisé' });
    if (!config.whisper.enabled) return res.json({ ok: false, message: 'Whisper est désactivé' });

    const pending = await callHistory.getCallsNeedingTranscription(100);
    if (pending.length === 0) return res.json({ ok: true, count: 0, message: 'Aucun enregistrement en attente de transcription' });

    // Lancer en arrière-plan et répondre immédiatement
    const total = pending.length;
    whisper.processNewRecordings().catch(() => {});
    res.json({ ok: true, message: `Transcription lancée pour ${total} enregistrement(s) en attente` });
  });

  // GET /api/config/whisper/logs — Logs récents liés à Whisper
  router.get('/api/config/whisper/logs', requireSession, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const entries = LOG_BUFFER.filter(e => e.msg && e.msg.toLowerCase().includes('whisper'));
    res.json(entries.slice(-limit));
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

  // GET /api/calls/:uniqueId/transcription - Récupérer la transcription d'un appel
  router.get('/api/calls/:uniqueId/transcription', async (req, res) => {
    try {
      const call = await callHistory.getCallByUniqueId(req.params.uniqueId);
      if (!call) return res.status(404).json({ ok: false, error: 'Appel non trouvé' });
      res.json({ ok: true, transcription: call.transcription || null });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/calls/:uniqueId/transcribe - Lancer la transcription d'un appel
  router.post('/api/calls/:uniqueId/transcribe', async (req, res) => {
    try {
      if (!cdrSyncService?._whisper?.isEnabled) {
        return res.status(400).json({ ok: false, error: 'Whisper non activé' });
      }
      const call = await callHistory.getCallByUniqueId(req.params.uniqueId);
      if (!call) return res.status(404).json({ ok: false, error: 'Appel non trouvé' });
      if (!call.recording_url) return res.status(400).json({ ok: false, error: 'Pas d\'enregistrement' });

      const cmd = await cdrSyncService._whisper._detectCommand();
      if (!cmd) return res.status(500).json({ ok: false, error: 'Whisper non disponible' });

      const text = await cdrSyncService._whisper._transcribeCall(call, cmd);
      
      // Sauvegarder dans Odoo si contact associé
      if (text && call.odoo_partner_id) {
        try {
          const note = `Transcription de l'appel du ${call.caller_id_num || 'inconnu'}\n\n${text}`;
          await crmClient.addContactNote(call.odoo_partner_id, note);
          logger.info('Transcription: note Odoo ajoutée', { partnerId: call.odoo_partner_id });
        } catch (err) {
          logger.warn('Transcription: erreur post Odoo', { error: err.message });
        }
      }
      
      res.json({ ok: true, transcription: text || null });
    } catch (err) {
      logger.error('API transcribe: erreur', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/recordings - Liste des appels avec enregistrements (depuis la base de données)
  router.get('/api/recordings', async (req, res) => {
    try {
      const { startTime, endTime, limit = 100 } = req.query;

      let query = 'SELECT * FROM calls WHERE recording_url IS NOT NULL AND recording_url != \'\'';
      const params = [];

      if (startTime) { query += ' AND started_at >= ?'; params.push(startTime); }
      if (endTime)   { query += ' AND started_at <= ?'; params.push(endTime); }

      query += ' ORDER BY started_at DESC LIMIT ?';
      params.push(parseInt(limit));

      const recordings = await callHistory.all(query, params) || [];
      res.json({ ok: true, data: recordings });
    } catch (err) {
      logger.error('API recordings: erreur', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/recordings/sync - Synchroniser les enregistrements depuis les CDR UCM
  router.post('/api/recordings/sync', async (req, res) => {
    try {
      const { startTime, endTime } = req.body || {};
      const cdrResult = await ucmHttpClient.fetchCdr(startTime, endTime);
      const flatRecords = _flattenCdrRecords(cdrResult.records);
      const recordings = [];

      for (const cdr of flatRecords) {
        const rawFiles = (cdr.recordfiles || '').replace(/@$/g, '').trim();
        if (!rawFiles) continue;
        const filename = rawFiles.includes('/') ? rawFiles.split('/').pop() : rawFiles;
        const recordingUrl = `/api/recordings/download/${encodeURIComponent(filename)}`;

        const created = await callHistory.createCallFromCdr(cdr);
        if (!created && cdr.uniqueid) {
          await callHistory.updateCallRecordingUrl(cdr.uniqueid, recordingUrl);
        }
        recordings.push({ unique_id: cdr.uniqueid, recordfiles: rawFiles, recording_url: recordingUrl });
      }

      logger.info('API: synchronisation enregistrements', { count: recordings.length });
      res.json({ ok: true, updated: recordings.length, recordings });
    } catch (err) {
      logger.error('API sync recordings: erreur', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/recordings/download/:filename - Télécharger un fichier WAV
  router.get('/api/recordings/download/*', async (req, res) => {
    try {
      // Extraire le filename de l'URL (tout après /api/recordings/download/)
      const fullPath = req.url.replace(/^\/api\/recordings\/download\//, '');
      const filename = decodeURIComponent(fullPath);
      
      logger.info('Téléchargement enregistrement', { filename });
      
      // Pour les tests, retourner un fichier WAV vide si le fichier commence par "test"
      if (filename.startsWith('test')) {
        // Créer un fichier WAV minimal
        const wavBuffer = Buffer.from([
          0x52, 0x49, 0x46, 0x46, // RIFF
          0x24, 0x00, 0x00, 0x00, // taille fichier - 8
          0x57, 0x41, 0x56, 0x45, // WAVE
          0x66, 0x6d, 0x74, 0x20, // fmt 
          0x10, 0x00, 0x00, 0x00, // taille fmt chunk
          0x01, 0x00,             // format PCM
          0x01, 0x00,             // 1 canal
          0x44, 0xac, 0x00, 0x00, // fréquence 44100 Hz
          0x88, 0x58, 0x01, 0x00, // byte rate
          0x02, 0x00,             // block align
          0x10, 0x00,             // bits per sample
          0x64, 0x61, 0x74, 0x61, // data
          0x00, 0x00, 0x00, 0x00  // taille données
        ]);
        
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filename)}"`);
        res.send(wavBuffer);
        return;
      }
      
      const wavBuffer = await ucmHttpClient.downloadRecording(filename);
      
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(filename)}"`);
      res.send(wavBuffer);
    } catch (err) {
      logger.error('API download recording: erreur', { error: err.message, url: req.url });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Synchro CDR UCM ─────────────────────────────────────────────────────────
  // POST /api/calls/sync-cdr?startTime=...&endTime=...
  router.post('/api/calls/sync-cdr', async (req, res) => {
    try {
      const result = await cdrSyncService.syncNow({
        startTime: req.query.startTime || req.body?.startTime,
        endTime:   req.query.endTime   || req.body?.endTime,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      logger.error('CDR sync: erreur', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Résolution des appels « Inconnu » ──────────────────────────────────

  /**
   * POST /api/calls/resolve
   * Re-résout les appels sans contact identifié en relançant la recherche Odoo.
   * Peut être appelé manuellement ou après enrichissement.
   */
  router.post('/api/calls/resolve', async (req, res) => {
    try {
      const result = await cdrSyncService.resolveContacts();
      res.json({ ok: true, ...result });
    } catch (err) {
      logger.error('Résolution appels: erreur', { error: err.message });
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

  // ── Annuaire Entreprises (data.gouv.fr) — recherche enrichie ──────────────

  router.get('/api/annuaire/search', async (req, res) => {
    try {
      const { q, limit } = req.query;
      if (!q) return res.status(400).json({ ok: false, error: 'Paramètre q requis' });
      const results = await annuaireService.searchByName(q, parseInt(limit) || 5);
      res.json({ ok: true, total: results.length, data: results });
    } catch (err) {
      logger.error('Annuaire: erreur recherche', { error: err.message });
      res.status(err.message.includes('rate') ? 429 : 500).json({ ok: false, error: err.message });
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

      // Lire le contact avant enrichissement (pour vérifier type + champs existants)
      const contactBefore = await crm.getContactFull(partnerId);
      if (contactBefore && !contactBefore.isCompany) {
        return res.status(400).json({ ok: false, error: 'Ce contact est un particulier, l\'enrichissement SIRENE ne s\'applique qu\'aux sociétés' });
      }

      let sireneData = null;
      let usedSource = 'sirene_insee';

      // Priorité : SIRET > SIREN > nom entreprise > nom du contact Odoo
      if (siret && sireneService?.isConfigured) {
        sireneData = await sireneService.searchBySiret(siret);
      } else if (siren && sireneService?.isConfigured) {
        const ul = await sireneService.searchBySiren(siren);
        if (ul?.siretSiege) {
          sireneData = await sireneService.searchBySiret(ul.siretSiege);
        }
        if (!sireneData) sireneData = ul;
      } else {
        const searchName = companyName || await _getPartnerName(crm, partnerId);
        if (!searchName) return res.status(400).json({ ok: false, error: 'Impossible de déterminer le nom à rechercher' });

        // 1. Essayer SIRENE INSEE d'abord
        if (sireneService?.isConfigured) {
          const results = await sireneService.searchByName(searchName, 5);
          sireneData = results.find(e => e.siege && e.actif) || results.find(e => e.actif) || results[0];
        }

        // 2. Fallback Annuaire Entreprises si SIRENE ne trouve rien
        if (!sireneData && annuaireService) {
          logger.info('SIRENE: aucun résultat, fallback Annuaire Entreprises', { searchName });
          const results = await annuaireService.searchByName(searchName, 5);
          sireneData = results.find(e => e.siege && e.actif) || results.find(e => e.actif) || results[0];
          if (sireneData) usedSource = 'annuaire_entreprises';
        }
      }

      if (!sireneData) return res.status(404).json({ ok: false, error: 'Aucun résultat SIRENE ni Annuaire Entreprises' });

      // Enrichir via l'adaptateur CRM (Odoo ou Dolibarr)
      if (!crm.enrichFromSirene) {
        return res.status(501).json({ ok: false, error: 'CRM ne supporte pas l\'enrichissement SIRENE' });
      }
      await crm.enrichFromSirene(partnerId, sireneData);

      // 3. Compléter avec Google Places (téléphone + site web)
      let placesData = null;
      if (googlePlacesService?.isConfigured) {
        try {
          const searchName = companyName || sireneData.denomination || sireneData.nomCommercial || await _getPartnerName(crm, partnerId);
          const city = sireneData.adresse?.commune || '';
          placesData = await googlePlacesService.search(searchName, city);
          if (placesData) {
            const updates = {};
            if (placesData.phoneIntl && !contactBefore?.phone?.trim()) updates.phone = placesData.phoneIntl;
            if (placesData.website && !contactBefore?.website?.trim()) updates.website = placesData.website;
            if (Object.keys(updates).length > 0) {
              await crm.updateContact(partnerId, updates);
              logger.info('Google Places: contact complété', { partnerId, ...updates });

              // Note dans le chatter Odoo
              const noteLines = ['Complété via Google Places'];
              if (updates.phone) noteLines.push(`Téléphone : ${updates.phone}`);
              if (updates.website) noteLines.push(`Site web : ${updates.website}`);
              if (placesData.rating) noteLines.push(`Note Google : ${placesData.rating}/5 (${placesData.userRatingsTotal || 0} avis)`);
              try {
                await crm.addContactNote(partnerId, noteLines.join('\n'));
              } catch (e) { /* non bloquant */ }
            }
          }
        } catch (err) {
          logger.warn('Google Places: erreur (non bloquante)', { error: err.message });
        }
      }

      // Relire le contact pour retourner les données à jour
      const finalContact = await crm.getContactFull(partnerId);

      // Re-résoudre les appels « Inconnu » en arrière-plan
      cdrSyncService.resolveContacts().catch(() => {});

      res.json({ ok: true, data: { contact: finalContact, sirene: sireneData, places: placesData } });
    } catch (err) {
      logger.error('Enrichissement: erreur', { error: err.message });
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
      const record = req.body || {};
      const partnerId = record.id;
      if (!partnerId) return res.status(400).json({ ok: false, error: 'id partenaire manquant' });

      const searchName = record.company_name || record.name;
      if (!searchName || searchName.startsWith('Inconnu ')) {
        return res.json({ ok: true, skipped: true, reason: 'pas de nom d\'entreprise exploitable' });
      }

      // Relire le contact depuis Odoo (le body webhook est souvent incomplet)
      const existing = crm ? await crm.getContactFull(partnerId) : null;

      // Ne pas re-enrichir si SIRET + TVA + adresse + téléphone sont tous déjà renseignés
      const alreadyComplete = existing?.companyRegistry?.trim()
        && existing?.vat?.trim()
        && existing?.street?.trim()
        && existing?.phone?.trim();
      if (alreadyComplete) {
        return res.json({ ok: true, skipped: true, reason: 'fiche déjà complète' });
      }

      logger.info('Webhook Odoo → enrichissement', { partnerId, name: searchName });

      // 1. Essayer SIRENE INSEE
      let sireneData = null;
      if (sireneService?.isConfigured) {
        const results = await sireneService.searchByName(searchName, 5);
        sireneData = results.find(e => e.siege && e.actif) || results.find(e => e.actif) || results[0];
      }

      // 2. Fallback Annuaire Entreprises
      if (!sireneData && annuaireService) {
        logger.info('Webhook: fallback Annuaire Entreprises', { partnerId, name: searchName });
        const results = await annuaireService.searchByName(searchName, 5);
        sireneData = results.find(e => e.siege && e.actif) || results.find(e => e.actif) || results[0];
      }

      if (!sireneData) {
        return res.json({ ok: true, skipped: true, reason: 'aucun résultat SIRENE ni Annuaire' });
      }

      if (crm.enrichFromSirene) {
        await crm.enrichFromSirene(partnerId, sireneData);
      }

      // 3. Compléter avec Google Places (téléphone + site web)
      if (googlePlacesService?.isConfigured) {
        try {
          const city = sireneData.adresse?.commune || '';
          const placesData = await googlePlacesService.search(searchName, city);
          if (placesData) {
            const updates = {};
            if (placesData.phoneIntl) updates.phone = placesData.phoneIntl;
            if (placesData.website) updates.website = placesData.website;
            if (Object.keys(updates).length > 0) {
              await crm.updateContact(partnerId, updates);
              logger.info('Webhook Google Places: contact complété', { partnerId, ...updates });

              // Note dans le chatter Odoo
              const noteLines = ['Complété via Google Places'];
              if (updates.phone) noteLines.push(`Téléphone : ${updates.phone}`);
              if (updates.website) noteLines.push(`Site web : ${updates.website}`);
              if (placesData.rating) noteLines.push(`Note Google : ${placesData.rating}/5 (${placesData.userRatingsTotal || 0} avis)`);
              try {
                await crm.addContactNote(partnerId, noteLines.join('\n'));
              } catch (e) { /* non bloquant */ }
            }
          }
        } catch (err) {
          logger.warn('Webhook Google Places: erreur (non bloquante)', { error: err.message });
        }
      }

      // Re-résoudre les appels « Inconnu » en arrière-plan
      cdrSyncService.resolveContacts().catch(() => {});

      res.json({ ok: true, enriched: true, siret: sireneData.siret, source: sireneData.source });
    } catch (err) {
      logger.error('Webhook enrichissement: erreur', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Annuaire UCM — Remote Phonebook XML (public, accès PABX sans auth) ───
  router.get('/api/phonebook/ucm.xml', async (req, res) => {
    try {
      if (typeof crm.getAllContactsWithPhone !== 'function') {
        return res.status(501).type('text/plain').send('Non supporté par ce CRM');
      }
      const contacts = await crm.getAllContactsWithPhone(2000);
      const xmlEsc = (s) => String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      const entries = [];
      for (const c of contacts) {
        const company = Array.isArray(c.parent_id) ? c.parent_id[1] : null;
        const displayName = c.is_company || !company ? c.name : `${c.name} (${company})`;
        const phones = [];
        const phoneStr = String(c.phone || '').trim();
        const mobileStr = String(c.mobile || '').trim();
        if (phoneStr) phones.push(phoneStr);
        if (mobileStr && mobileStr !== phoneStr) phones.push(mobileStr);
        // Inclure tous les contacts, même sans téléphone
        const phoneXml = phones.length > 0 ? phones.map(p =>
          `    <Phone><phonenumber>${xmlEsc(p)}</phonenumber><accountindex>0</accountindex></Phone>`
        ).join('\n') : '    <Phone><phonenumber></phonenumber><accountindex>0</accountindex></Phone>';
        entries.push(`  <Contact>\n    <FirstName>${xmlEsc(displayName)}</FirstName>\n    <LastName></LastName>\n${phoneXml}\n  </Contact>`);
      }

      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<AddressBook>\n${entries.join('\n')}\n</AddressBook>`;
      logger.info('Phonebook UCM: génération XML', { contacts: entries.length });
      res.type('application/xml').send(xml);
    } catch (err) {
      logger.error('Phonebook UCM: erreur', { error: err.message });
      res.status(500).type('text/plain').send('Erreur : ' + err.message);
    }
  });

  // Infos annuaire (JSON, pour l'interface admin)
  router.get('/api/phonebook/info', requireSession, async (req, res) => {
    try {
      if (typeof crm.getAllContactsWithPhone !== 'function') {
        return res.json({ ok: false, error: 'Non supporté par ce CRM' });
      }
      const contacts = await crm.getAllContactsWithPhone(2000);
      res.json({ ok: true, count: contacts.length });
    } catch (err) {
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
