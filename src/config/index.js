'use strict';

const fs   = require('fs');
const path = require('path');

require('dotenv').config();

const ENV_FILE = path.join(process.cwd(), '.env');
const OVERRIDE_FILE = path.join(process.cwd(), 'data', 'config.json');

function list(name, fallback = []) {
  const val = process.env[name];
  if (!val) return fallback;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function loadOverrides() {
  try {
    if (fs.existsSync(OVERRIDE_FILE)) return JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
  } catch { /* ignore */ }
  return {};
}

/**
 * Sauvegarde les overrides dans .env (persistant) ET config.json (compatibilité)
 */
function saveOverrides(overrides) {
  // 1. Sauvegarder dans .env
  if (fs.existsSync(ENV_FILE)) {
    let envContent = fs.readFileSync(ENV_FILE, 'utf8');
    
    // Fonction helper pour mettre à jour une variable .env
    const updateEnvVar = (key, value, section) => {
      if (value === undefined || value === null || value === '') return;
      const regex = new RegExp(`^(#\\s*)?${key}=.*$`, 'm');
      const newLine = `${key}=${value}`;
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, newLine);
      } else {
        // Ajouter après la section si elle existe
        const sectionRegex = new RegExp(`^(#\\s*===\\s*${section}.*===\\s*$)`, 'm');
        if (sectionRegex.test(envContent)) {
          envContent = envContent.replace(sectionRegex, `$1\n${newLine}`);
        } else {
          envContent += `\n${newLine}`;
        }
      }
    };
    
    // Whisper
    if (overrides.whisper) {
      updateEnvVar('WHISPER_ENABLED', overrides.whisper.enabled, 'WHISPER TRANSCRIPTION');
      updateEnvVar('WHISPER_MODE', overrides.whisper.mode, 'WHISPER TRANSCRIPTION');
      updateEnvVar('WHISPER_MODEL', overrides.whisper.model, 'WHISPER TRANSCRIPTION');
      updateEnvVar('WHISPER_LANGUAGE', overrides.whisper.language, 'WHISPER TRANSCRIPTION');
      updateEnvVar('WHISPER_API_URL', overrides.whisper.apiUrl, 'WHISPER TRANSCRIPTION');
      updateEnvVar('WHISPER_MAX_DURATION', overrides.whisper.maxDurationSec, 'WHISPER TRANSCRIPTION');
      if (overrides.whisper.apiKey) {
        updateEnvVar('WHISPER_API_KEY', overrides.whisper.apiKey, 'WHISPER TRANSCRIPTION');
      }
    }
    
    // UCM
    if (overrides.ucm) {
      updateEnvVar('UCM_MODE', overrides.ucm.mode, 'UCM CONFIGURATION');
      updateEnvVar('UCM_HOST', overrides.ucm.host, 'UCM CONFIGURATION');
      updateEnvVar('UCM_PORT', overrides.ucm.webPort, 'UCM CONFIGURATION');
      updateEnvVar('UCM_API_USER', overrides.ucm.webUser, 'UCM CONFIGURATION');
      updateEnvVar('UCM_API_PASS', overrides.ucm.webPassword, 'UCM CONFIGURATION');
    }
    
    // Odoo
    if (overrides.odoo) {
      updateEnvVar('ODOO_URL', overrides.odoo.url, 'ODOO');
      updateEnvVar('ODOO_DB', overrides.odoo.db, 'ODOO');
      updateEnvVar('ODOO_USERNAME', overrides.odoo.username, 'ODOO');
      if (overrides.odoo.apiKey) {
        updateEnvVar('ODOO_API_KEY', overrides.odoo.apiKey, 'ODOO');
      }
    }
    
    // Dolibarr
    if (overrides.dolibarr) {
      updateEnvVar('DOLIBARR_URL', overrides.dolibarr.url, 'DOLIBARR');
      if (overrides.dolibarr.apiKey) {
        updateEnvVar('DOLIBARR_API_KEY', overrides.dolibarr.apiKey, 'DOLIBARR');
      }
      updateEnvVar('DOLIBARR_USER_ID', overrides.dolibarr.userId, 'DOLIBARR');
      updateEnvVar('DOLIBARR_ENTITY_ID', overrides.dolibarr.entityId, 'DOLIBARR');
    }
    
    fs.writeFileSync(ENV_FILE, envContent);
  }
  
  // 2. Sauvegarder dans config.json (compatibilité)
  fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
  fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(overrides, null, 2));
}

const ov = loadOverrides();

const config = {

  // ── Sélection du CRM ────────────────────────────────────────────────────────
  crm: {
    type: ov.crm?.type ?? process.env.CRM_TYPE ?? 'odoo',  // 'odoo' | 'dolibarr'
  },

  ucm: {
    mode:              ov.ucm?.mode        ?? process.env.UCM_MODE            ?? 'websocket',
    host:              ov.ucm?.host        ?? process.env.UCM_HOST            ?? 'localhost',
    webPort:           ov.ucm?.webPort     ?? parseInt(process.env.UCM_WEB_PORT  ?? '8089', 10),
    username:          ov.ucm?.username    ?? process.env.UCM_API_USER        ?? 'admin',
    password:          ov.ucm?.password    ?? process.env.UCM_API_PASS        ?? '',
    reconnectDelay:    parseInt(process.env.UCM_RECONNECT_DELAY    || '3000', 10),
    reconnectMaxDelay: parseInt(process.env.UCM_RECONNECT_MAX_DELAY || '60000', 10),
    timeout:           parseInt(process.env.UCM_TIMEOUT            || '8000', 10),
    watchExtensions:   ov.ucm?.watchExtensions ?? list('UCM_WATCH_EXTENSIONS'),
    
    // TLS configuration
    tls: {
      rejectUnauthorized: process.env.UCM_TLS_REJECT_UNAUTHORIZED !== 'false',
      caCert:            process.env.UCM_TLS_CA_CERT_CONTENT || null,
    },
    
    // Webhook (fallback for old UCM models)
    webhookPort:       ov.ucm?.webhookPort   ?? parseInt(process.env.UCM_WEBHOOK_PORT ?? '8088', 10),
  },

  odoo: {
    url:             ov.odoo?.url      ?? process.env.ODOO_URL      ?? 'http://localhost:8069',
    db:              ov.odoo?.db       ?? process.env.ODOO_DB       ?? 'odoo',
    username:        ov.odoo?.username ?? process.env.ODOO_USERNAME ?? 'admin',
    apiKey:          ov.odoo?.apiKey   ?? process.env.ODOO_API_KEY  ?? '',
    timeout:         parseInt(process.env.ODOO_TIMEOUT       || '8000', 10),
    cacheContactTtl: parseInt(process.env.CACHE_CONTACT_TTL  || '300',  10),
  },

  // ── Dolibarr ────────────────────────────────────────────────────────────────
  dolibarr: {
    url:            ov.dolibarr?.url      ?? process.env.DOLIBARR_URL      ?? 'http://localhost:80',
    apiKey:         ov.dolibarr?.apiKey   ?? process.env.DOLIBARR_API_KEY  ?? '',
    userId:         ov.dolibarr?.userId   ?? parseInt(process.env.DOLIBARR_USER_ID || '1', 10),
    entityId:       ov.dolibarr?.entityId ?? process.env.DOLIBARR_ENTITY_ID ?? null,
    timeout:        parseInt(process.env.DOLIBARR_TIMEOUT || '8000', 10),
    cacheContactTtl: parseInt(process.env.CACHE_CONTACT_TTL || '300', 10),
  },

  // ── SIRENE INSEE ───────────────────────────────────────────────────────────
  sirene: {
    apiKey: process.env.INSEE_SIRENE_API_KEY || '',
  },

  // ── Google Places ─────────────────────────────────────────────────────────
  google: {
    placesApiKey: process.env.GOOGLE_PLACES_API_KEY || '',
  },

  // ── Telegram Notifications ─────────────────────────────────────────────
  telegram: {
    token: process.env.TELEGRAM_TOKEN || '',
    chatIds: (() => {
      try {
        const ids = process.env.TELEGRAM_CHAT_IDS || '[]';
        return JSON.parse(ids);
      } catch {
        return [];
      }
    })(),
  },

  // ── SMTP Email ───────────────────────────────────────────────────────────
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || '',
    defaultRecipients: process.env.SMTP_DEFAULT_RECIPIENTS || '',
  },

  // ── Notifications Settings ───────────────────────────────────────────────
  notifications: {
    missedCallThreshold: {
      count: parseInt(process.env.NOTIFICATION_MISSED_CALL_COUNT || '3', 10),
      minutes: parseInt(process.env.NOTIFICATION_MISSED_CALL_MINUTES || '15', 10),
    },
    dailySummaryEnabled: process.env.NOTIFICATION_DAILY_SUMMARY_ENABLED === 'true',
    dailySummaryTime: process.env.NOTIFICATION_DAILY_SUMMARY_TIME || '18:00',
  },

  // ── CDR Auto-Sync ──────────────────────────────────────────────────────
  cdrSync: {
    enabled:    (process.env.CDR_SYNC_ENABLED || 'true') === 'true',
    intervalMs: parseInt(process.env.CDR_SYNC_INTERVAL_MS || '300000', 10),
  },

  // ── Whisper Transcription ──────────────────────────────────────────────
  whisper: {
    enabled:  (process.env.WHISPER_ENABLED || 'false') === 'true',
    mode:     process.env.WHISPER_MODE     || 'local',   // 'local' | 'api'
    model:    process.env.WHISPER_MODEL    || 'tiny',
    language: process.env.WHISPER_LANGUAGE || 'fr',
    command:  process.env.WHISPER_COMMAND  || '',
    maxDurationSec: parseInt(process.env.WHISPER_MAX_DURATION || '600', 10),
    // Mode API (OpenAI ou Groq)
    apiKey:   process.env.WHISPER_API_KEY  || '',
    apiUrl:   process.env.WHISPER_API_URL  || 'https://api.openai.com/v1/audio/transcriptions',
  },

  server: {
    port:         parseInt(process.env.SERVER_PORT || '3000', 10),
    wsPath:       process.env.WS_PATH         || '/ws',
    apiSecretKey: process.env.API_SECRET_KEY  || '',
  },

  app: {
    nodeEnv:   process.env.NODE_ENV    || 'production',
    logLevel:  process.env.LOG_LEVEL   || 'info',
    logOutput: process.env.LOG_OUTPUT  || 'both',
    logDir:    process.env.LOG_DIR     || './logs',
  },

  // ── Mise à jour dynamique ───────────────────────────────────────────────────
  applyUcm(fields) {
    const allowed = ['mode', 'host', 'webPort', 'webUser', 'webPassword', 'watchExtensions'];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) config.ucm[k] = v;
    }
    this._persist();
  },

  applyOdoo(fields) {
    const allowed = ['url', 'db', 'username', 'apiKey'];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) config.odoo[k] = v;
    }
    this._persist();
  },

  applyWhisper(fields) {
    const allowed = ['enabled', 'mode', 'model', 'language', 'command', 'maxDurationSec', 'apiKey', 'apiUrl'];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) config.whisper[k] = v;
    }
    this._persist();
  },

  applyDolibarr(fields) {
    const allowed = ['url', 'apiKey', 'userId', 'entityId'];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) config.dolibarr[k] = v;
    }
    this._persist();
  },

  applyCrm(fields) {
    const allowed = ['type'];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) config.crm[k] = v;
    }
    this._persist();
  },

  _persist() {
    const overrides = {
      crm: {
        type: config.crm.type,
      },
      ucm: {
        mode:             config.ucm.mode,
        host:             config.ucm.host,
        webPort:          config.ucm.webPort,
        webUser:          config.ucm.webUser,
        webPassword:      config.ucm.webPassword,
        watchExtensions:  config.ucm.watchExtensions,
      },
      odoo: {
        url:      config.odoo.url,
        db:       config.odoo.db,
        username: config.odoo.username,
        apiKey:   config.odoo.apiKey,
      },
      dolibarr: {
        url:      config.dolibarr.url,
        apiKey:   config.dolibarr.apiKey,
        userId:   config.dolibarr.userId,
        entityId: config.dolibarr.entityId,
      },
      whisper: {
        enabled:        config.whisper.enabled,
        mode:           config.whisper.mode,
        model:          config.whisper.model,
        language:       config.whisper.language,
        apiUrl:         config.whisper.apiUrl,
        maxDurationSec: config.whisper.maxDurationSec,
        // apiKey persistée localement (fichier config.json protégé)
        apiKey:         config.whisper.apiKey || '',
      },
    };
    saveOverrides(overrides);
  },
};

module.exports = config;
