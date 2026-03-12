'use strict';

require('dotenv').config();

const http         = require('http');
const express      = require('express');
const swaggerUi    = require('swagger-ui-express');
const config       = require('./config');
const logger       = require('./logger');
const UcmHttpClient  = require('./infrastructure/ucm/UcmHttpClient');
const UcmWsClient        = require('./infrastructure/ucm/UcmWsClient');
const OdooClient     = require('./infrastructure/odoo/OdooClient');
const WsServer       = require('./infrastructure/websocket/WsServer');
const CallHandler    = require('./application/CallHandler');
const WebhookManager = require('./application/WebhookManager');
const CallHistory    = require('./infrastructure/database/CallHistory');
const createRouter   = require('./presentation/api/router');
const swaggerSpec    = require('./config/swagger');
const HealthAgent    = require('./infrastructure/monitoring/HealthAgent');

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function main() {
  logger.info('═══════════════════════════════════════════');
  logger.info(' UCM ↔ Odoo Middleware démarrage');
  logger.info('═══════════════════════════════════════════');
  logger.info('Config', {
    ucmHost:   config.ucm.host,
    ucmPort:   config.ucm.port,
    odooUrl:   config.odoo.url,
    port:      config.server.port,
    nodeEnv:   config.app.nodeEnv,
    logLevel:  config.app.logLevel,
  });

  // ── Infrastructure ─────────────────────────────────────────────────────────
  // UCM6300: HTTP API + WebSocket pour événements temps réel
  const ucmMode    = config.ucm.mode || 'websocket';
  logger.info(`UCM: mode ${ucmMode.toUpperCase()}`);
  
  const ucmHttpClient = new UcmHttpClient();
  const ucmWsClient   = new UcmWsClient();
  const odooClient    = new OdooClient();
  const webhookManager = new WebhookManager();
  
  // ── Base de données / Historique ───────────────────────────────────────────
  const callHistory = new CallHistory();
  try {
    await callHistory.init();
    logger.info('Service d\'historique initialisé');
  } catch (err) {
    logger.error('Erreur initialisation historique', { error: err.message });
  }

  // ── Serveur HTTP + WebSocket ───────────────────────────────────────────────
  const app        = express();
  app.use(express.json());
  
  // Servir les fichiers statiques (favicon, etc.)
  app.use(express.static(__dirname + '/../public'));

  // Désactiver X-Powered-By
  app.disable('x-powered-by');
  
  // Routes API

  // Documentation Swagger
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  const httpServer = http.createServer(app);
  const wsServer   = new WsServer(httpServer);

  // ── Application ────────────────────────────────────────────────────────────
  const callHandler = new CallHandler(ucmHttpClient, ucmWsClient, odooClient, wsServer, webhookManager, callHistory);

  // ── Routes ─────────────────────────────────────────────────────────────────
  const apiRouter = createRouter({ ucmHttpClient, ucmWsClient, odooClient, wsServer, callHandler, webhookManager, callHistory });
  app.use('/', apiRouter);

  // 404 catch-all
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // ── Démarrage ──────────────────────────────────────────────────────────────

  // 1. Pré-authentifier Odoo (optionnel, fail silencieux)
  try {
    await odooClient.authenticate();
  } catch (err) {
    logger.warn('Odoo: pré-authentification échouée (sera retentée à la demande)', {
      error: err.message,
    });
  }

  // 2. Démarrer le serveur HTTP (réseau Docker)
  await new Promise((resolve, reject) => {
    httpServer.listen(config.server.port, '0.0.0.0', (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
  logger.info(`Serveur HTTP démarré sur le port ${config.server.port}`);
  logger.info(`WebSocket disponible sur ws://localhost:${config.server.port}${config.server.wsPath}`);
  logger.info(`Documentation API disponible sur http://localhost:${config.server.port}/api-docs`);

  // 3. Connecter UCM6300 (HTTP + WebSocket)
  try {
    // Connexion HTTP API
    await ucmHttpClient.connect();
    logger.info('UCM HTTP: connecté avec succès');
    
    // Récupérer le statut système
    const status = await ucmHttpClient.getSystemStatus();
    logger.info('UCM: statut système', status);
    
    // Connexion WebSocket pour événements
    ucmWsClient.on('error', (err) => {
      logger.warn('UCM WS: erreur', { error: err.message });
    });

    ucmWsClient.connect();
    
  } catch (err) {
    logger.error('UCM: échec connexion', { error: err.message });
    logger.warn('UCM: le middleware fonctionnera sans connexion UCM (webhook uniquement)');
  }

  // ── Agent de supervision ───────────────────────────────────────────────────
  const healthAgent = new HealthAgent();
  healthAgent.start(ucmHttpClient, ucmWsClient, odooClient, wsServer, callHistory);
  
  // Exposer l'agent pour l'API
  app.locals.healthAgent = healthAgent;

  // ── Arrêt propre ───────────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`Signal ${signal} reçu — arrêt propre...`);
    
    // Arrêt de l'agent de supervision
    if (healthAgent) {
      healthAgent.stop();
    }
    
    // Déconnexion UCM
    try {
      await ucmHttpClient.disconnect();
      ucmWsClient.disconnect();
    } catch (err) {
      logger.warn('UCM: erreur déconnexion', { error: err.message });
    }
    
    if (callHistory) {
      await callHistory.db.close();
    }
    httpServer.close(() => {
      logger.info('Serveur HTTP arrêté');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException', err => {
    logger.error('Exception non catchée', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Promise rejection non gérée', { reason: String(reason) });
  });
}

main().catch(err => {
  console.error('Erreur fatale au démarrage :', err);
  process.exit(1);
});
