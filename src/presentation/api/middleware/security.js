'use strict';

const rateLimit = require('express-rate-limit');
const { AppError } = require('./errorHandler');

/**
 * Middleware de sécurité - Rate limiting par route
 */

// Rate limiting général (déjà dans index.js, mais on peut le renforcer)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requêtes par fenêtre
  message: { ok: false, error: 'Trop de requêtes, réessayez plus tard' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting strict pour l'authentification
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives de login
  message: { ok: false, error: 'Trop de tentatives de connexion' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Compter aussi les succès
});

// Rate limiting pour les appels API (click-to-call, etc.)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 appels par minute
  message: { ok: false, error: 'Trop de requêtes API' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting pour les webhooks (plus permissif)
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 webhooks par minute
  message: { ok: false, error: 'Trop de webhooks' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Middleware pour vérifier les IPs autorisées
 * Utilise une liste blanche d'IPs depuis la config
 */
function ipFilter(allowedIps = []) {
  return (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;

    // Si aucune IP n'est spécifiée, on laisse passer
    if (!allowedIps || allowedIps.length === 0) {
      return next();
    }

    // Vérifier si l'IP est dans la liste blanche
    const isAllowed = allowedIps.some(allowed => {
      // Support des CIDR simples
      if (allowed.includes('/')) {
        const [network, prefix] = allowed.split('/');
        // Comparaison simple (pour une implémentation complète, utiliser ipaddr.js)
        return clientIp.startsWith(network.split('.').slice(0, 3).join('.'));
      }
      return clientIp === allowed || allowed === '*';
    });

    if (!isAllowed) {
      throw new AppError('Accès refusé - IP non autorisée', 403, 'IP_FORBIDDEN');
    }

    next();
  };
}

/**
 * Middleware pour vérifier les headers de sécurité
 */
function securityHeaders(req, res, next) {
  // Vérifier le header Content-Type pour les requêtes POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('Content-Type');
    if (!contentType || !contentType.includes('application/json')) {
      // On laisse passer pour la rétrocompatibilité, mais on pourrait être plus strict
      // throw new AppError('Content-Type doit être application/json', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
  }

  next();
}

/**
 * Middleware pour sanitiser les entrées
 * Nettoie les strings des caractères dangereux
 */
function sanitizeInput(req, res, next) {
  function sanitize(obj) {
    if (typeof obj === 'string') {
      // Supprimer les caractères de contrôle non imprimables
      return obj.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '').trim();
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    if (obj !== null && typeof obj === 'object') {
      const sanitized = {};
      for (const key of Object.keys(obj)) {
        sanitized[key] = sanitize(obj[key]);
      }
      return sanitized;
    }
    return obj;
  }

  if (req.body) {
    req.body = sanitize(req.body);
  }
  if (req.query) {
    req.query = sanitize(req.query);
  }
  if (req.params) {
    req.params = sanitize(req.params);
  }

  next();
}

module.exports = {
  generalLimiter,
  authLimiter,
  apiLimiter,
  webhookLimiter,
  ipFilter,
  securityHeaders,
  sanitizeInput,
};
