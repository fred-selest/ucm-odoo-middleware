'use strict';

require('dotenv').config();

const http         = require('http');
const express      = require('express');
const swaggerUi    = require('swagger-ui-express');
const config       = require('./config');
const logger       = require('./logger');
const UcmClient      = require('./infrastructure/ucm/UcmClient');
const UcmWsClient    = require('./infrastructure/ucm/UcmWsClient');
const OdooClient     = require('./infrastructure/odoo/OdooClient');
const WsServer       = require('./infrastructure/websocket/WsServer');
const CallHandler    = require('./application/CallHandler');
const WebhookManager = require('./application/WebhookManager');
const CallHistory    = require('./infrastructure/database/CallHistory');
const createRouter   = require('./presentation/api/router');
const swaggerSpec    = require('./config/swagger');

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
  const ucmMode    = config.ucm.mode || 'ami';
  const ucmClient  = ucmMode === 'websocket' ? new UcmWsClient() : new UcmClient();
  logger.info(`UCM: mode ${ucmMode.toUpperCase()}`);
  const odooClient     = new OdooClient();
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

  // Désactiver X-Powered-By
  app.disable('x-powered-by');

  // Documentation Swagger
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  const httpServer = http.createServer(app);
  const wsServer   = new WsServer(httpServer);

  // ── Application ────────────────────────────────────────────────────────────
  const callHandler = new CallHandler(ucmClient, odooClient, wsServer, webhookManager, callHistory);

  // ── Routes ─────────────────────────────────────────────────────────────────
  const apiRouter = createRouter({ ucmClient, odooClient, wsServer, callHandler, webhookManager, callHistory });
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

  // 2. Démarrer le serveur HTTP
  await new Promise((resolve, reject) => {
    httpServer.listen(config.server.port, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
  logger.info(`Serveur HTTP démarré sur le port ${config.server.port}`);
  logger.info(`WebSocket disponible sur ws://localhost:${config.server.port}${config.server.wsPath}`);
  logger.info(`Documentation API disponible sur http://localhost:${config.server.port}/api-docs`);

  // 3. Connecter UCM (listener error obligatoire pour éviter uncaughtException)
  ucmClient.on('error', err => logger.warn('UCM: erreur réseau', { error: err.message }));
  ucmClient.connect();

  // ── Arrêt propre ───────────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`Signal ${signal} reçu — arrêt propre...`);
    ucmClient.disconnect();
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
