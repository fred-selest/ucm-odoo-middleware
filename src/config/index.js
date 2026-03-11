'use strict';

const fs   = require('fs');
const path = require('path');

require('dotenv').config();

function list(name, fallback = []) {
  const val = process.env[name];
  if (!val) return fallback;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

const OVERRIDE_FILE = path.join(process.cwd(), 'data', 'config.json');

function loadOverrides() {
  try {
    if (fs.existsSync(OVERRIDE_FILE)) return JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
  } catch { /* ignore */ }
  return {};
}

function saveOverrides(overrides) {
  fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
  fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(overrides, null, 2));
}

const ov = loadOverrides();

const config = {
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

  _persist() {
    const overrides = {
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
    };
    saveOverrides(overrides);
  },
};

module.exports = config;
