'use strict';

const { v4: uuidv4 } = require('uuid');
const { AppError } = require('./errorHandler');

// ── Sessions en mémoire ──────────────────────────────────────────────────────
// token → { uid, username, expiresAt }
const SESSIONS = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 heures

/**
 * Crée une nouvelle session pour un utilisateur
 * @param {number} uid - ID utilisateur
 * @param {string} username - Nom d'utilisateur
 * @returns {string} Token de session
 */
function createSession(uid, username) {
  const token = uuidv4();
  SESSIONS.set(token, { uid, username, expiresAt: Date.now() + SESSION_TTL });
  return token;
}

/**
 * Vérifie si un token de session est valide
 * @param {string} token - Token à vérifier
 * @returns {object|null} Session ou null
 */
function checkSession(token) {
  if (!token) return null;
  const s = SESSIONS.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    SESSIONS.delete(token);
    return null;
  }
  return s;
}

/**
 * Middleware pour exiger une session valide
 * Si la session est invalide, retourne une erreur 401
 */
function requireSession(req, res, next) {
  const token = (req.headers['x-session-token'] || '').trim();
  const session = checkSession(token);
  
  if (!session) {
    throw new AppError('Non authentifié', 401, 'UNAUTHORIZED');
  }
  
  req.session = session;
  next();
}

/**
 * Middleware optionnel - ajoute la session si présente mais ne bloque pas
 */
function optionalSession(req, res, next) {
  const token = (req.headers['x-session-token'] || '').trim();
  const session = checkSession(token);
  
  if (session) {
    req.session = session;
  }
  
  next();
}

/**
 * Nettoie les sessions expirées (à appeler périodiquement)
 */
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of SESSIONS.entries()) {
    if (session.expiresAt < now) {
      SESSIONS.delete(token);
    }
  }
}

// Nettoyage toutes les heures
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

module.exports = {
  createSession,
  checkSession,
  requireSession,
  optionalSession,
  cleanupExpiredSessions,
  SESSIONS, // Exporté pour les tests uniquement
};
