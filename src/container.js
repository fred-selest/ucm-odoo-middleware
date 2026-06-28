'use strict';

/**
 * Container DI : instancie et câble tous les services de l'application.
 *
 * Retourne un objet `c` avec :
 *   - c.app       : Express app (middleware + routes déjà montés)
 *   - c.httpServer: HTTP server (à écouter dans index.js)
 *   - c.*         : tous les services instanciés
 *
 * Les initialisations async (DB, Whisper) sont faites ici.
 * Le cycle de vie (listen, connect, shutdown) reste dans index.js.
 */

const http        = require('http');
const express     = require('express');
const swaggerUi   = require('swagger-ui-express');
const compression = require('compression');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');

const config = require('./config');
const logger = require('./logger');
const swaggerSpec = require('./config/swagger');

const UcmHttpClient      = require('./infrastructure/ucm/UcmHttpClient');
const UcmWsClient        = require('./infrastructure/ucm/UcmWsClient');
const CrmFactory         = require('./infrastructure/crm/CrmFactory');
const WsServer           = require('./infrastructure/websocket/WsServer');
const CallHistory        = require('./infrastructure/database/CallHistory');
const SireneService      = require('./infrastructure/lookup/SireneService');
const AnnuaireService    = require('./infrastructure/lookup/AnnuaireService');
const GooglePlacesService = require('./infrastructure/lookup/GooglePlacesService');
const SpamScoreService   = require('./infrastructure/lookup/SpamScoreService');
const WhisperService     = require('./infrastructure/transcription/WhisperService');

const CallHandler        = require('./application/CallHandler');
const WebhookManager     = require('./application/WebhookManager');
const NotificationService = require('./application/NotificationService');
const CdrSyncService     = require('./application/CdrSyncService');

const createRouter        = require('./presentation/api/router');
const createQueuesRouter  = require('./presentation/api/queues.routes');

async function buildContainer() {
  // ── Infrastructure ─────────────────────────────────────────────────────
  const ucmHttpClient  = new UcmHttpClient();
  const ucmWsClient    = new UcmWsClient();
  const crmClient      = CrmFactory.create();
  const webhookManager = new WebhookManager();

  // ── Base de données ─────────────────────────────────────────────────────
  const callHistory = new CallHistory();
  try {
    await callHistory.init();
    logger.info('Service d\'historique initialisé');
  } catch (err) {
    logger.error('Erreur initialisation historique', { error: err.message });
  }

  // ── HTTP + WebSocket ────────────────────────────────────────────────────
  const app = buildApp();
  const httpServer = http.createServer(app);
  const wsServer = new WsServer(httpServer);

  // ── Application ─────────────────────────────────────────────────────────
  const spamScoreService    = new SpamScoreService();
  const notificationService = new NotificationService(callHistory);
  const callHandler = new CallHandler(
    ucmHttpClient, ucmWsClient, crmClient, wsServer,
    webhookManager, callHistory, spamScoreService, notificationService
  );
  const sireneService      = new SireneService();
  const annuaireService    = new AnnuaireService();
  const googlePlacesService = new GooglePlacesService();
  const whisperService = new WhisperService({ ucmHttpClient, callHistory, crmClient });
  try {
    await whisperService.init();
  } catch (err) {
    logger.warn('WhisperService: initialisation échouée', { error: err.message });
  }
  const cdrSyncService = new CdrSyncService({
    ucmHttpClient, callHistory, crmClient, wsServer, whisperService,
  });

  // ── Routes ──────────────────────────────────────────────────────────────
  const apiRouter = createRouter({
    ucmHttpClient, ucmWsClient, crmClient, wsServer,
    callHandler, webhookManager, callHistory,
    sireneService, annuaireService, googlePlacesService,
    spamScoreService, cdrSyncService, notificationService,
  });
  app.use('/', apiRouter);

  const queuesRouter = createQueuesRouter({ ucmHttpClient, callHistory, wsServer });
  app.use('/api/queues', queuesRouter);

  return {
    app,
    httpServer,
    // Infrastructure
    ucmHttpClient,
    ucmWsClient,
    crmClient,
    webhookManager,
    callHistory,
    wsServer,
    // Application
    spamScoreService,
    notificationService,
    callHandler,
    sireneService,
    annuaireService,
    googlePlacesService,
    whisperService,
    cdrSyncService,
    // Routers
    apiRouter,
    queuesRouter,
  };
}

/**
 * Configure l'app Express : middleware globaux + Swagger.
 * Extrait pour alléger buildContainer et faciliter les tests.
 */
function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(compression({ threshold: 1024 }));
  app.use(cors({
    origin: config.app.allowedOrigins || ['https://admin.ucm.local'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token'],
    credentials: true,
  }));

  // Rate limiting global (sauté pour /api/* — chaque route applique son propre limiter)
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de requêtes, réessayez dans 15 minutes' },
    skip: (req) => !req.path.startsWith('/api/'),
  });
  app.use(apiLimiter);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  return app;
}

module.exports = { buildContainer, buildApp };