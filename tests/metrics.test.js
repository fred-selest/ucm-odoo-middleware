'use strict';

const express = require('express');
const request = require('supertest');
const { registry, metrics, httpMetricsMiddleware, metricsHandler, reset } = require('../src/infrastructure/monitoring/metrics');

// Helper : récupère le texte Prometheus complet (réinitialise pas les compteurs)
async function getMetricsText() {
  return registry.metrics();
}

describe('metrics — Prometheus instrumentation', () => {
  let app;

  beforeEach(() => {
    reset();
    app = express();
    app.use(httpMetricsMiddleware);
    app.get('/test', (req, res) => res.json({ ok: true }));
    app.get('/error', (req, res) => res.status(500).json({ error: 'oops' }));
    app.get('/metrics', metricsHandler);
  });

  test('calls_total incrémente par direction/status', async () => {
    metrics.calls_total.inc({ direction: 'inbound', status: 'answered' });
    metrics.calls_total.inc({ direction: 'inbound', status: 'answered' });
    metrics.calls_total.inc({ direction: 'inbound', status: 'missed' });
    const text = await getMetricsText();
    expect(text).toMatch(/ucm_calls_total\{direction="inbound",status="answered"\} 2/);
    expect(text).toMatch(/ucm_calls_total\{direction="inbound",status="missed"\} 1/);
  });

  test('call_duration_seconds observe une durée', async () => {
    metrics.call_duration_seconds.observe({ direction: 'inbound' }, 42);
    const text = await getMetricsText();
    expect(text).toMatch(/ucm_call_duration_seconds_count\{direction="inbound"\} 1/);
    expect(text).toMatch(/ucm_call_duration_seconds_sum\{direction="inbound"\}/);
  });

  test('active_calls est un gauge (set/get)', async () => {
    metrics.active_calls.set(5);
    metrics.active_calls.inc();
    metrics.active_calls.dec();
    const text = await getMetricsText();
    expect(text).toMatch(/ucm_active_calls 5/);
  });

  test('sessions_login_total compte par résultat', async () => {
    metrics.sessions_login_total.inc({ result: 'success' });
    metrics.sessions_login_total.inc({ result: 'failure' });
    metrics.sessions_login_total.inc({ result: 'failure' });
    const text = await getMetricsText();
    expect(text).toMatch(/ucm_sessions_login_total\{result="success"\} 1/);
    expect(text).toMatch(/ucm_sessions_login_total\{result="failure"\} 2/);
  });

  test('httpMetricsMiddleware incrémente http_requests_total par méthode/route/status', async () => {
    await request(app).get('/test').expect(200);
    await request(app).get('/test').expect(200);
    await request(app).get('/error').expect(500);

    const text = await getMetricsText();
    // 2 GET /test → 200, 1 GET /error → 500
    expect(text).toMatch(/ucm_http_requests_total\{[^}]*method="GET"[^}]*status_code="200"[^}]*\} 2/);
    expect(text).toMatch(/ucm_http_requests_total\{[^}]*method="GET"[^}]*status_code="500"[^}]*\} 1/);
  });

  test('httpMetricsMiddleware mesure la durée', async () => {
    await request(app).get('/test').expect(200);
    const text = await getMetricsText();
    // L'histogramme _count doit être > 0
    expect(text).toMatch(/ucm_http_request_duration_seconds_count\{[^}]*\} [1-9]/);
  });

  test('GET /metrics retourne du texte Prometheus', async () => {
    metrics.calls_total.inc({ direction: 'inbound', status: 'answered' });
    const res = await request(app).get('/metrics').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/ucm_calls_total/);
    expect(res.text).toMatch(/ucm_http_requests_total/);
  });

  test('les métriques par défaut (CPU, mémoire) sont présentes', async () => {
    const res = await request(app).get('/metrics').expect(200);
    expect(res.text).toMatch(/ucm_process_cpu_user_seconds_total/);
    expect(res.text).toMatch(/ucm_nodejs_heap_size_total_bytes/);
  });
});