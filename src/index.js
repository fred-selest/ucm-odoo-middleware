'use strict';

const config = require('./config');
const logger = require('./logger');
const HealthAgent = require('./infrastructure/monitoring/HealthAgent');
const { buildContainer } = require('./container');

async function main() {
  logger.info('═══════════════════════════════════════════');
  logger.info(' UCM ↔ Odoo Middleware démarrage');
  logger.info('═══════════════════════════════════════════');
  logger.info('Config', {
    ucmHost:  config.ucm.host,
    ucmPort:  config.ucm.port,
    crmType:  config.crm.type,
    crmUrl:   config.crm.type === 'dolibarr' ? config.dolibarr.url : config.odoo.url,
    port:     config.server.port,
    nodeEnv:  config.app.nodeEnv,
    logLevel: config.app.logLevel,
  });

  const c = await buildContainer();
  logger.info(`UCM: mode ${config.ucm.mode.toUpperCase()}`);

  // 1. Pré-authentifier le CRM (optionnel, fail silencieux)
  try {
    await c.crmClient.authenticate();
  } catch (err) {
    logger.warn(`${c.crmClient.crmType}: pré-authentification échouée (sera retentée à la demande)`, {
      error: err.message,
    });
  }

  // 2. Démarrer le serveur HTTP
  await listen(c.httpServer, config.server.port);
  logger.info(`Serveur HTTP démarré sur le port ${config.server.port}`);
  logger.info(`WebSocket disponible sur ws://0.0.0.0:${config.server.port}${config.server.wsPath}`);
  logger.info(`Documentation API disponible sur http://0.0.0.0:${config.server.port}/api-docs`);

  // 3. Connecter UCM6300 (HTTP + WebSocket)
  try {
    await c.ucmHttpClient.connect();
    logger.info('UCM HTTP: connecté avec succès');
    const status = await c.ucmHttpClient.getSystemStatus();
    logger.info('UCM: statut système', status);
    if (config.ucm.mode === 'websocket') {
      c.ucmWsClient.on('error', (err) => logger.warn('UCM WS: erreur', { error: err.message }));
      c.ucmWsClient.connect();
    }
  } catch (err) {
    logger.error('UCM: échec connexion', { error: err.message });
    logger.warn('UCM: le middleware fonctionnera sans connexion UCM (webhook uniquement)');
  }

  // 4. Agent de supervision
  const healthAgent = new HealthAgent();
  healthAgent.start(c.ucmHttpClient, c.ucmWsClient, c.crmClient, c.wsServer, c.callHistory);
  c.app.locals.healthAgent = healthAgent;

  // 5. CDR Auto-Sync
  if (config.cdrSync.enabled) c.cdrSyncService.start();

  // 6. Arrêt propre
  const shutdown = async (signal) => {
    logger.info(`Signal ${signal} reçu — arrêt propre...`);
    if (healthAgent) healthAgent.stop();
    if (c.cdrSyncService) c.cdrSyncService.stop();
    try {
      await c.ucmHttpClient.disconnect();
      if (c.ucmWsClient) c.ucmWsClient.disconnect();
    } catch (err) {
      logger.warn('UCM: erreur déconnexion', { error: err.message });
    }
    if (c.callHandler?.disconnect) c.callHandler.disconnect();
    if (c.callHistory) await c.callHistory.db.close();
    c.httpServer.close(() => logger.info('Serveur HTTP arrêté'));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Exception non catchée', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Promise rejection non gérée', { reason: String(reason) });
  });
}

function listen(httpServer, port) {
  return new Promise((resolve, reject) => {
    httpServer.listen(port, '0.0.0.0', (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

main().catch((err) => {
  console.error('Erreur fatale au démarrage :', err);
  throw err;
});