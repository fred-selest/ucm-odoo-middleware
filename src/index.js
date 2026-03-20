'use strict';

require('dotenv').config();

const http         = require('http');
const express      = require('express');
const swaggerUi    = require('swagger-ui-express');
const config       = require('./config');
const logger       = require('./logger');
const UcmHttpClient  = require('./infrastructure/ucm/UcmHttpClient');
const UcmWsClient    = require('./infrastructure/ucm/UcmWsClient');
const CrmFactory     = require('./infrastructure/crm/CrmFactory');
const WsServer       = require('./infrastructure/websocket/WsServer');
const CallHandler    = require('./application/CallHandler');
const WebhookManager = require('./application/WebhookManager');
const CallHistory    = require('./infrastructure/database/CallHistory');
const createRouter       = require('./presentation/api/router');
const createQueuesRouter = require('./presentation/api/queues.routes');
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
    crmType:   config.crm.type,
    crmUrl:    config.crm.type === 'dolibarr' ? config.dolibarr.url : config.odoo.url,
    port:      config.server.port,
    nodeEnv:   config.app.nodeEnv,
    logLevel:  config.app.logLevel,
  });

  // ── Infrastructure ─────────────────────────────────────────────────────────
  // UCM6300: HTTP API + WebSocket pour événements temps réel
  const ucmMode    = config.ucm.mode || 'websocket';
  logger.info(`UCM: mode ${ucmMode.toUpperCase()}`);
  
  const ucmHttpClient  = new UcmHttpClient();
  const ucmWsClient    = new UcmWsClient();
  const crmClient      = CrmFactory.create();
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
  const callHandler = new CallHandler(ucmHttpClient, ucmWsClient, crmClient, wsServer, webhookManager, callHistory);

  // ── Routes ─────────────────────────────────────────────────────────────────
  const apiRouter = createRouter({ ucmHttpClient, ucmWsClient, crmClient, wsServer, callHandler, webhookManager, callHistory });
  app.use('/', apiRouter);

  const queuesRouter = createQueuesRouter({ ucmHttpClient, callHistory, wsServer });
  app.use('/api/queues', queuesRouter);

  // 404 catch-all
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // ── Démarrage ──────────────────────────────────────────────────────────────

  // 1. Pré-authentifier le CRM (optionnel, fail silencieux)
  try {
    await crmClient.authenticate();
  } catch (err) {
    logger.warn(`${crmClient.crmType}: pré-authentification échouée (sera retentée à la demande)`, {
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
  logger.info(`WebSocket disponible sur ws://0.0.0.0:${config.server.port}${config.server.wsPath}`);
  logger.info(`Documentation API disponible sur http://0.0.0.0:${config.server.port}/api-docs`);

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
  healthAgent.start(ucmHttpClient, ucmWsClient || null, crmClient, wsServer, callHistory);
  
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
      if (ucmWsClient) ucmWsClient.disconnect();
    } catch (err) {
      logger.warn('UCM: erreur déconnexion', { error: err.message });
    }
    
    // Nettoyage CallHandler
    if (callHandler?.disconnect) {
      callHandler.disconnect();
    }
    
    if (callHistory) {
      await callHistory.db.close();
    }
    httpServer.close(() => {
      logger.info('Serveur HTTP arrêté');
    });
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
  throw err;
});
