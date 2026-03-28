'use strict';

/**
 * Constantes utilisées dans l'application
 * Centralise les timeouts, limites, codes HTTP et autres valeurs
 */

// ── Timeouts (millisecondes) ────────────────────────────────────────────────

/** Timeout par défaut pour les requêtes HTTP (ms) */
const HTTP_TIMEOUT_MS = 8000;

/** Timeout pour les requêtes UCM (ms) */
const UCM_TIMEOUT_MS = 8000;

/** Timeout pour les requêtes Odoo (ms) */
const ODOO_TIMEOUT_MS = 8000;

/** Délai de reconnexion UCM (ms) */
const UCM_RECONNECT_DELAY_MS = 3000;

/** Délai de reconnexion maximum UCM (ms) */
const UCM_RECONNECT_MAX_DELAY_MS = 60000;

/** Intervalle de polling des appels (ms) */
const CALL_POLLING_INTERVAL_MS = 3000;

/** Timeout pour vérification spam Tellows (ms) */
const SPAM_CHECK_TIMEOUT_MS = 5000;

// ── Intervalles et délais ───────────────────────────────────────────────────

/** TTL des sessions utilisateur (8 heures en ms) */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** TTL des événements webhook (30 jours en ms) */
const WEBHOOK_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** TTL du cache contacts (5 minutes en ms) */
const CONTACT_CACHE_TTL_MS = 300000;

/** TTL du cache SIRENE (1 heure en ms) */
const SIRENE_CACHE_TTL_MS = 3600000;

/** TTL du cache Google Places (24 heures en ms) */
const GOOGLE_PLACES_CACHE_TTL_MS = 86400000;

/** TTL du cache spam Tellows (1 heure en ms) */
const SPAM_CACHE_TTL_MS = 3600000;

/** Intervalle de synchronisation CDR (5 minutes en ms) */
const CDR_SYNC_INTERVAL_MS = 300000;

// ── Limites ─────────────────────────────────────────────────────────────────

/** Nombre maximum de logs en mémoire */
const LOG_BUFFER_MAX_SIZE = 300;

/** Taille maximale du cache SIRENE (nombre d'entrées) */
const SIRENE_CACHE_MAX_SIZE = 500;

/** Taille maximale du cache Google Places (nombre d'entrées) */
const GOOGLE_PLACES_CACHE_MAX_SIZE = 500;

/** Taille maximale du cache spam Tellows (nombre d'entrées) */
const SPAM_CACHE_MAX_SIZE = 1000;

/** Limite par défaut pour la pagination */
const DEFAULT_PAGE_LIMIT = 50;

/** Limite par défaut pour l'historique des appels */
const DEFAULT_CALL_HISTORY_LIMIT = 1000;

/** Limite maximale pour la pagination */
const MAX_PAGE_LIMIT = 200;

/** Limite par défaut pour la recherche de contacts */
const DEFAULT_SEARCH_LIMIT = 20;

/** Nombre maximum d'appels à résoudre par batch */
const MAX_CALLS_TO_RESOLVE = 200;

/** Seuil de blocage spam Tellows (score >= 7) */
const SPAM_BLOCK_THRESHOLD = 7;

/** Longueur minimale pour recherche de nom (SIRENE/Google) */
const MIN_SEARCH_NAME_LENGTH = 2;

/** Longueur minimale d'un numéro de téléphone */
const MIN_PHONE_LENGTH = 6;

/** Longueur minimale des chiffres pour un numéro externe valide */
const MIN_PHONE_DIGITS_LENGTH = 5;

/** Délai pour le lock anti-doublon création de contacts (ms) */
const AUTO_CREATE_LOCK_DELAY_MS = 10000;

/** Délai avant premier sync CDR (ms) */
const CDR_SYNC_INITIAL_DELAY_MS = 30000;

// ── Codes HTTP ──────────────────────────────────────────────────────────────

/** HTTP 200 OK */
const HTTP_OK = 200;

/** HTTP 400 Bad Request */
const HTTP_BAD_REQUEST = 400;

/** HTTP 401 Unauthorized */
const HTTP_UNAUTHORIZED = 401;

/** HTTP 403 Forbidden */
const HTTP_FORBIDDEN = 403;

/** HTTP 404 Not Found */
const HTTP_NOT_FOUND = 404;

/** HTTP 429 Too Many Requests */
const HTTP_TOO_MANY_REQUESTS = 429;

/** HTTP 500 Internal Server Error */
const HTTP_INTERNAL_ERROR = 500;

/** HTTP 503 Service Unavailable */
const HTTP_SERVICE_UNAVAILABLE = 503;

// ── Rate Limiting ───────────────────────────────────────────────────────────

/** Fenêtre de rate limiting (15 minutes en ms) */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Nombre maximum de requêtes par fenêtre */
const RATE_LIMIT_MAX_REQUESTS = 5000;

// ── Validation ──────────────────────────────────────────────────────────────

/** Nombre de chiffres SIREN */
const SIREN_LENGTH = 9;

/** Nombre de chiffres SIRET */
const SIRET_LENGTH = 14;

/** Nombre maximum de chiffres pour un numéro interne */
const MAX_INTERNAL_NUMBER_LENGTH = 5;

/** Regex pour valider un SIREN */
const SIREN_REGEX = /^\d{9}$/;

/** Regex pour valider un SIRET */
const SIRET_REGEX = /^\d{14}$/;

// ── Whisper Transcription ───────────────────────────────────────────────────

/** Durée maximale d'un audio à transcrire (secondes) */
const WHISPER_MAX_DURATION_SEC = 600;

/** Modèle Whisper par défaut */
const WHISPER_DEFAULT_MODEL = 'tiny';

/** Langue Whisper par défaut */
const WHISPER_DEFAULT_LANGUAGE = 'fr';

// ── UCM CDR ─────────────────────────────────────────────────────────────────

/** Clés des sous-CDR imbriqués UCM */
const UCM_SUB_CDR_KEYS = ['sub_cdr_1', 'sub_cdr_2', 'sub_cdr_3', 'sub_cdr_4'];

// ── Websocket ───────────────────────────────────────────────────────────────

/** Chemin WebSocket par défaut */
const WS_DEFAULT_PATH = '/ws';

// ── Serveur ─────────────────────────────────────────────────────────────────

/** Port HTTP par défaut */
const DEFAULT_SERVER_PORT = 3000;

/** Port webhook UCM par défaut */
const DEFAULT_UCM_WEBHOOK_PORT = 8088;

/** Port API web UCM par défaut */
const DEFAULT_UCM_WEB_PORT = 8089;

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Timeouts
  HTTP_TIMEOUT_MS,
  UCM_TIMEOUT_MS,
  ODOO_TIMEOUT_MS,
  UCM_RECONNECT_DELAY_MS,
  UCM_RECONNECT_MAX_DELAY_MS,
  CALL_POLLING_INTERVAL_MS,
  CDR_SYNC_INITIAL_DELAY_MS,
  SPAM_CHECK_TIMEOUT_MS,

  // Intervalles et délais
  SESSION_TTL_MS,
  CONTACT_CACHE_TTL_MS,
  SIRENE_CACHE_TTL_MS,
  GOOGLE_PLACES_CACHE_TTL_MS,
  SPAM_CACHE_TTL_MS,
  CDR_SYNC_INTERVAL_MS,

  // Limites
  LOG_BUFFER_MAX_SIZE,
  SIRENE_CACHE_MAX_SIZE,
  GOOGLE_PLACES_CACHE_MAX_SIZE,
  SPAM_CACHE_MAX_SIZE,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_CALLS_TO_RESOLVE,
  SPAM_BLOCK_THRESHOLD,
  MIN_SEARCH_NAME_LENGTH,
  MIN_PHONE_LENGTH,

  // Codes HTTP
  HTTP_OK,
  HTTP_BAD_REQUEST,
  HTTP_UNAUTHORIZED,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_INTERNAL_ERROR,
  HTTP_SERVICE_UNAVAILABLE,

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,

  // Validation
  SIREN_LENGTH,
  SIRET_LENGTH,
  MAX_INTERNAL_NUMBER_LENGTH,
  SIREN_REGEX,
  SIRET_REGEX,

  // Whisper
  WHISPER_MAX_DURATION_SEC,
  WHISPER_DEFAULT_MODEL,
  WHISPER_DEFAULT_LANGUAGE,

  // UCM CDR
  UCM_SUB_CDR_KEYS,

  // WebSocket
  WS_DEFAULT_PATH,

  // Serveur
  DEFAULT_SERVER_PORT,
  DEFAULT_UCM_WEBHOOK_PORT,
  DEFAULT_UCM_WEB_PORT,
};
