'use strict';

const { body, param, query, validationResult } = require('express-validator');
const { AppError } = require('./errorHandler');

/**
 * Middleware pour valider les résultats de validation express-validator
 * À utiliser après les règles de validation
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = new AppError(
      'Erreur de validation',
      400,
      'VALIDATION_ERROR'
    );
    error.errors = errors.array();
    throw error;
  }
  next();
}

/**
 * Règles de validation réutilisables
 */
const rules = {
  // ── Contact ───────────────────────────────────────────────────────────────
  contactId: param('id')
    .isInt({ min: 1 })
    .withMessage('L\'ID du contact doit être un entier positif'),

  createContact: [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Le nom est requis')
      .isLength({ max: 200 })
      .withMessage('Le nom ne doit pas dépasser 200 caractères'),
    
    body('phone')
      .optional()
      .trim()
      .matches(/^[\d\s\+\-\.\(\)]+$/)
      .withMessage('Numéro de téléphone invalide'),
    
    body('email')
      .optional()
      .trim()
      .isEmail()
      .withMessage('Email invalide'),
    
    body('company')
      .optional()
      .trim(),
    
    body('function')
      .optional()
      .trim(),
  ],

  updateContact: [
    body('name')
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Le nom ne doit pas dépasser 200 caractères'),
    
    body('phone')
      .optional()
      .trim()
      .matches(/^[\d\s\+\-\.\(\)]+$/)
      .withMessage('Numéro de téléphone invalide'),
    
    body('email')
      .optional()
      .trim()
      .isEmail()
      .withMessage('Email invalide'),
    
    body('street', 'La rue est invalide').optional().trim(),
    body('zip', 'Le code postal est invalide').optional().trim(),
    body('city', 'La ville est invalide').optional().trim(),
    body('country', 'Le pays est invalide').optional().trim(),
    body('website', 'Le site web est invalide').optional().trim(),
    body('comment', 'Le commentaire est invalide').optional().trim(),
  ],

  // ── Blacklist ──────────────────────────────────────────────────────────────
  addToBlacklist: [
    body('phoneNumber')
      .trim()
      .notEmpty()
      .withMessage('Le numéro de téléphone est requis')
      .matches(/^[\d\s\+\-\.\(\)]+$/)
      .withMessage('Numéro de téléphone invalide'),
    
    body('reason')
      .optional()
      .trim(),
  ],

  importBlacklist: [
    body('numbers')
      .isArray({ min: 1 })
      .withMessage('Le tableau numbers est requis et ne peut pas être vide'),
    
    body('numbers.*')
      .trim()
      .matches(/^[\d\s\+\-\.\(\)]+$/)
      .withMessage('Numéro de téléphone invalide'),
  ],

  // ── Click-to-call ──────────────────────────────────────────────────────────
  clickToCall: [
    body('phone')
      .trim()
      .notEmpty()
      .withMessage('Le numéro de téléphone est requis')
      .matches(/^[\d\s\+\-\.\(\)]+$/)
      .withMessage('Numéro de téléphone invalide'),
    
    body('exten')
      .trim()
      .notEmpty()
      .withMessage('L\'extension est requise'),
  ],

  // ── Agent status ───────────────────────────────────────────────────────────
  updateAgentStatus: [
    param('exten')
      .trim()
      .notEmpty()
      .withMessage('L\'extension est requise'),
    
    body('status')
      .isIn(['available', 'busy', 'on_call', 'pause', 'offline'])
      .withMessage('Statut invalide'),
  ],

  // ── DND ────────────────────────────────────────────────────────────────────
  updateDnd: [
    param('exten')
      .trim()
      .notEmpty()
      .withMessage('L\'extension est requise'),
    
    body('enable')
      .isBoolean()
      .withMessage('enable doit être un booléen'),
  ],

  // ── Transfert d'appel ──────────────────────────────────────────────────────
  transferCall: [
    param('uniqueId')
      .trim()
      .notEmpty()
      .withMessage('L\'ID unique de l\'appel est requis'),
    
    body('extension')
      .trim()
      .notEmpty()
      .withMessage('L\'extension de transfert est requise'),
  ],

  // ── Notes d'appel ──────────────────────────────────────────────────────────
  addCallNote: [
    param('uniqueId')
      .trim()
      .notEmpty()
      .withMessage('L\'ID unique de l\'appel est requis'),
    
    body('note')
      .trim()
      .notEmpty()
      .withMessage('La note est requise')
      .isLength({ max: 1000 })
      .withMessage('La note ne doit pas dépasser 1000 caractères'),
  ],

  // ── Authentification ───────────────────────────────────────────────────────
  login: [
    body('username')
      .trim()
      .notEmpty()
      .withMessage('L\'identifiant est requis')
      .isEmail()
      .withMessage('Format email requis'),
    
    body('password')
      .notEmpty()
      .withMessage('Le mot de passe est requis'),
  ],

  // ── Recherche ──────────────────────────────────────────────────────────────
  search: [
    query('q')
      .optional()
      .trim(),
    
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('La limite doit être entre 1 et 100'),
  ],

  // ── Historique des appels ──────────────────────────────────────────────────
  callHistory: [
    query('caller')
      .optional()
      .trim(),
    
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Format de date invalide (ISO 8601 requis)'),
    
    query('status')
      .optional()
      .isIn(['answered', 'missed', 'hangup', 'ringing'])
      .withMessage('Statut invalide'),
    
    query('limit')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('La limite doit être entre 1 et 1000'),
  ],

  // ── Configuration UCM ──────────────────────────────────────────────────────
  updateUcmConfig: [
    body('mode')
      .optional()
      .isIn(['websocket', 'webhook'])
      .withMessage('Mode invalide (websocket ou webhook)'),
    
    body('host')
      .optional()
      .trim()
      .isFQDN()
      .withMessage('Hôte invalide'),
    
    body('webPort')
      .optional()
      .isInt({ min: 1, max: 65535 })
      .withMessage('Port invalide'),
    
    body('watchExtensions')
      .optional()
      .trim(),
  ],

  // ── Configuration Odoo ─────────────────────────────────────────────────────
  updateOdooConfig: [
    body('url')
      .optional()
      .trim()
      .isURL()
      .withMessage('URL invalide'),
    
    body('db')
      .optional()
      .trim(),
    
    body('username')
      .optional()
      .trim()
      .isEmail()
      .withMessage('Email invalide'),
    
    body('apiKey')
      .optional()
      .trim(),
  ],

  // ── Webhook ────────────────────────────────────────────────────────────────
  createWebhook: [
    body('name')
      .trim()
      .notEmpty()
      .withMessage('Le nom est requis')
      .isLength({ max: 100 })
      .withMessage('Le nom ne doit pas dépasser 100 caractères'),
  ],
};

module.exports = {
  validate,
  rules,
};
