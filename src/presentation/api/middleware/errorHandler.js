'use strict';

const logger = require('../../../logger');

/**
 * Classe d'erreur personnalisée pour les erreurs métier
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Middleware de gestion centralisée des erreurs
 * Doit être placé en dernier dans la chaîne de middleware
 */
function errorHandler(err, req, res, next) {
  // Erreur déjà gérée (erreur métier)
  if (err.isOperational) {
    logger.warn('Erreur métier', {
      code: err.code,
      message: err.message,
      path: req.path,
      method: req.method,
    });

    return res.status(err.statusCode).json({
      ok: false,
      error: err.message,
      code: err.code,
    });
  }

  // Erreur de validation (express-validator)
  if (err.array && typeof err.array === 'function') {
    const errors = err.array();
    logger.warn('Erreur de validation', {
      path: req.path,
      errors: errors.map(e => ({ field: e.path, message: e.msg })),
    });

    return res.status(400).json({
      ok: false,
      error: 'Erreur de validation',
      details: errors.map(e => ({
        field: e.path,
        message: e.msg,
        value: e.value,
      })),
    });
  }

  // Erreur non gérée - log complet avec stack trace
  logger.error('Erreur non gérée', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    query: req.query,
    params: req.params,
  });

  // Ne pas exposer les détails de l'erreur en production
  const isDev = process.env.NODE_ENV !== 'production';

  res.status(err.statusCode || 500).json({
    ok: false,
    error: isDev ? err.message : 'Une erreur interne est survenue',
    ...(isDev && { stack: err.stack }),
  });
}

/**
 * Middleware pour gérer les routes 404
 */
function notFoundHandler(req, res, next) {
  res.status(404).json({
    ok: false,
    error: 'Ressource non trouvée',
    path: req.path,
  });
}

module.exports = {
  errorHandler,
  notFoundHandler,
  AppError,
};
