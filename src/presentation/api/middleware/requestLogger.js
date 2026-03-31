'use strict';

const logger = require('../../../logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Middleware de logging des requêtes HTTP
 * Ajoute un ID de requête unique et logue les informations de requête/réponse
 */
function requestLogger(req, res, next) {
  // ID de requête unique pour le tracing
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  req.startTime = Date.now();

  // Log du début de la requête (niveau debug pour ne pas polluer)
  logger.debug('Requête entrante', {
    requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Hook pour loguer la fin de la requête
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[logLevel]('Requête traitée', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });

  next();
}

/**
 * Middleware de logging pour les opérations métier
 * À utiliser dans les services pour logger avec le contexte de la requête
 */
function createLoggerWithContext(req) {
  const childLogger = logger.child({
    requestId: req.requestId,
    path: req.path,
    method: req.method,
  });

  return childLogger;
}

module.exports = {
  requestLogger,
  createLoggerWithContext,
};
