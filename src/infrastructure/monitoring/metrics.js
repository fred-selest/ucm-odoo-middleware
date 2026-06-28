'use strict';

/**
 * Métriques Prometheus pour le middleware.
 *
 * Expose :
 *   - registry : le registry global (peut être réinitialisé pour les tests)
 *   - metrics   : les compteurs/histogrammes/gauges métier
 *   - middleware : middleware Express pour observer les requêtes HTTP
 *   - metricsHandler : handler Express pour /metrics
 */

const client = require('prom-client');

const registry = new client.Registry();

// Métadonnées par défaut
client.collectDefaultMetrics({ register: registry, prefix: 'ucm_' });

const metrics = {
  // ── Appels ──────────────────────────────────────────────────────────────
  calls_total: new client.Counter({
    name: 'ucm_calls_total',
    help: 'Nombre total d\'appels traités',
    labelNames: ['direction', 'status'],
    registers: [registry],
  }),
  call_duration_seconds: new client.Histogram({
    name: 'ucm_call_duration_seconds',
    help: 'Durée des appels en secondes',
    labelNames: ['direction'],
    buckets: [5, 15, 30, 60, 120, 300, 600],
    registers: [registry],
  }),
  active_calls: new client.Gauge({
    name: 'ucm_active_calls',
    help: 'Nombre d\'appels actifs en mémoire',
    registers: [registry],
  }),
  blacklist_auto_blocks_total: new client.Counter({
    name: 'ucm_blacklist_auto_blocks_total',
    help: 'Nombre d\'appels auto-bloqués par scoring spam',
    labelNames: ['source'],
    registers: [registry],
  }),

  // ── HTTP / API ──────────────────────────────────────────────────────────
  http_requests_total: new client.Counter({
    name: 'ucm_http_requests_total',
    help: 'Nombre total de requêtes HTTP',
    labelNames: ['method', 'route', 'status_code'],
    registers: [registry],
  }),
  http_request_duration_seconds: new client.Histogram({
    name: 'ucm_http_request_duration_seconds',
    help: 'Durée des requêtes HTTP en secondes',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registers: [registry],
  }),

  // ── Sessions ────────────────────────────────────────────────────────────
  sessions_active: new client.Gauge({
    name: 'ucm_sessions_active',
    help: 'Nombre de sessions actives en mémoire',
    registers: [registry],
  }),
  sessions_login_total: new client.Counter({
    name: 'ucm_sessions_login_total',
    help: 'Nombre de tentatives de login',
    labelNames: ['result'],
    registers: [registry],
  }),

  // ── Cache contacts ──────────────────────────────────────────────────────
  cache_hits_total: new client.Counter({
    name: 'ucm_cache_hits_total',
    help: 'Nombre de hits du cache contacts',
    labelNames: ['cache'],
    registers: [registry],
  }),

  // ── UCM / Odoo ──────────────────────────────────────────────────────────
  external_requests_total: new client.Counter({
    name: 'ucm_external_requests_total',
    help: 'Nombre de requêtes vers les services externes',
    labelNames: ['service', 'method', 'status'],
    registers: [registry],
  }),
  external_request_duration_seconds: new client.Histogram({
    name: 'ucm_external_request_duration_seconds',
    help: 'Durée des requêtes externes en secondes',
    labelNames: ['service', 'method'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
  }),
};

/**
 * Middleware Express qui observe chaque requête HTTP.
 * À monter AVANT les routes (typiquement dans buildApp).
 */
function httpMetricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    // Utilise req.route?.path si défini, sinon req.path
    const route = req.route?.path || (req.baseUrl + (req.path || '')) || 'unknown';
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    metrics.http_requests_total.inc(labels);
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    metrics.http_request_duration_seconds.observe(labels, durationSec);
  });
  next();
}

/**
 * Handler Express pour /metrics. Retourne le texte au format Prometheus.
 */
async function metricsHandler(req, res) {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
}

/**
 * Reset toutes les métriques (utile pour les tests).
 */
function reset() {
  registry.resetMetrics();
}

module.exports = {
  registry,
  metrics,
  httpMetricsMiddleware,
  metricsHandler,
  reset,
};