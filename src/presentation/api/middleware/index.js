'use strict';

/**
 * Middleware index - Export centralisé de tous les middlewares
 */

const { errorHandler, notFoundHandler, AppError } = require('./errorHandler');
const { validate, rules } = require('./validator');
const { requestLogger, createLoggerWithContext } = require('./requestLogger');
const {
  generalLimiter,
  authLimiter,
  apiLimiter,
  webhookLimiter,
  ipFilter,
  securityHeaders,
  sanitizeInput,
} = require('./security');
const {
  createSession,
  checkSession,
  requireSession,
  optionalSession,
} = require('./auth');

module.exports = {
  // Gestion d'erreurs
  errorHandler,
  notFoundHandler,
  AppError,

  // Validation
  validate,
  rules,

  // Logging
  requestLogger,
  createLoggerWithContext,

  // Sécurité
  generalLimiter,
  authLimiter,
  apiLimiter,
  webhookLimiter,
  ipFilter,
  securityHeaders,
  sanitizeInput,

  // Authentification
  createSession,
  checkSession,
  requireSession,
  optionalSession,
};
