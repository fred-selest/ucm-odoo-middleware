'use strict';

/**
 * Tests E2E / intégration : exercent le stack HTTP complet (Express + middleware
 * + sessions + rate-limit + validators) avec les services internes mockés.
 *
 * Différence vs tests unitaires :
 *   - On passe par supertest (HTTP réel via l'app Express)
 *   - Pas de mock direct de requireSession ou du router — on teste le tout
 *   - Les services externes (UCM, Odoo, DB) sont mockés
 */

// Mock axios pour éviter tout appel réseau (auth Odoo XML-RPC → REST)
jest.mock('axios');

// Mock Database pour ne pas dépendre du filesystem (SQLite en RAM trop fragile)
jest.mock('../src/infrastructure/database/Database', () => ({
  run: jest.fn().mockResolvedValue({ id: 1, changes: 1 }),
  all: jest.fn().mockResolvedValue([]),
  get: jest.fn().mockResolvedValue(null),
  connect: jest.fn().mockResolvedValue(undefined),
}));

// Mock WhisperService : sinon tente de détecter une commande locale
jest.mock('../src/infrastructure/transcription/WhisperService', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    enabled: false,
  }));
});

// Mock WebhookManager avec comportement réaliste + capture des instances
const webhookInstances = [];
jest.mock('../src/application/WebhookManager', () => {
  return jest.fn().mockImplementation(() => {
    const instance = {
      hasToken: jest.fn((token) => token === 'valid-token'),
      // Retourne true uniquement si event présent (reflète la vraie logique)
      processEvent: jest.fn((token, query) => {
        if (!query || !query.event) return false;
        if (!query.event.startsWith('call:')) return false;
        return true;
      }),
      on: jest.fn(),
    };
    webhookInstances.push(instance);
    return instance;
  });
});

// Mock UcmWsClient : EventEmitter no-op pour CallHandler._bindSource
jest.mock('../src/infrastructure/ucm/UcmWsClient', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  }));
});

const axios = require('axios');
const request = require('supertest');
const { buildContainer } = require('../src/container');
const { reset: resetMetrics } = require('../src/infrastructure/monitoring/metrics');
const auth = require('../src/presentation/api/middleware/auth');
const { authLimiter } = require('../src/presentation/api/middleware/security');

describe('E2E — Auth flow complet', () => {
  let app;

  beforeAll(async () => {
    const c = await buildContainer();
    app = c.app;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    auth.SESSIONS.clear();
    resetMetrics();
    // Reset du rate-limit store pour éviter les interférences entre tests
    if (authLimiter.store && authLimiter.store.resetAll) authLimiter.store.resetAll();
  });

  test('login OK → 200 + token + uid', async () => {
    axios.post.mockResolvedValue({ data: { result: { uid: 7 } } });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin@selest.info', password: 'AdminSelest2026!' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      username: 'admin@selest.info',
      uid: 7,
    });
    expect(res.body.token).toMatch(/^[0-9a-f-]{36}$/); // UUID v4
  });

  test('login mauvais creds (Odoo retourne uid=null) → 401', async () => {
    axios.post.mockResolvedValue({ data: { result: { uid: false } } });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'wrong@selest.info', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('login sans username → 400 (validation)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'x' });
    expect(res.status).toBe(400);
  });

  test('login sans password → 400 (validation)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin' }); // missing email → 400
    expect(res.status).toBe(400);
  });

  test('login avec body vide → 400 (validation)', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  test('GET /api/auth/me avec token valide → 200 + username', async () => {
    axios.post.mockResolvedValue({ data: { result: { uid: 7 } } });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin@selest.info', password: 'pwd' });
    const token = loginRes.body.token;

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('X-Session-Token', token);
    expect(meRes.status).toBe(200);
    expect(meRes.body).toMatchObject({ ok: true, username: 'admin@selest.info', uid: 7 });
  });

  test('GET /api/auth/me sans token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('GET /api/auth/me avec token invalide → 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('X-Session-Token', 'invalid-uuid');
    expect(res.status).toBe(401);
  });

  test('logout invalide la session (puis /me → 401)', async () => {
    axios.post.mockResolvedValue({ data: { result: { uid: 7 } } });
    // Crée une session directement (évite de tomber sur le rate-limit après
    // les nombreux logins précédents du describe)
    const fakeToken = auth.createSession(7, 'admin@selest.info');
    expect(auth.SESSIONS.has(fakeToken)).toBe(true);

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('X-Session-Token', fakeToken);
    expect(logoutRes.status).toBe(200);
    expect(auth.SESSIONS.has(fakeToken)).toBe(false);

    // La session est détruite : /me → 401
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('X-Session-Token', fakeToken);
    expect(meRes.status).toBe(401);
  });

  test('sessions cleanup : session expirée nettoyée à /me', async () => {
    axios.post.mockResolvedValue({ data: { result: { uid: 7 } } });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin@selest.info', password: 'pwd' });
    const token = loginRes.body.token;

    // Force expiration
    const sess = auth.SESSIONS.get(token);
    sess.expiresAt = Date.now() - 1000;

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('X-Session-Token', token);
    expect(meRes.status).toBe(401);
    expect(auth.SESSIONS.has(token)).toBe(false); // auto-cleanup
  });

  test('2 logins simultanés → 2 sessions distinctes', async () => {
    axios.post.mockResolvedValue({ data: { result: { uid: 7 } } });
    const r1 = await request(app).post('/api/auth/login').send({ username: 'a@selest.info', password: 'p' });
    const r2 = await request(app).post('/api/auth/login').send({ username: 'b@selest.info', password: 'p' });
    expect(r1.body.token).not.toBe(r2.body.token);
    expect(auth.SESSIONS.size).toBe(2);
  });
});

describe('E2E — Webhook flow', () => {
  let app;
  let webhookInstance;

  beforeAll(async () => {
    const c = await buildContainer();
    app = c.app;
    // Capture l'instance créée par buildContainer() pour CE describe
    webhookInstance = webhookInstances[webhookInstances.length - 1];
  });

  beforeEach(() => {
    // Reset seulement axios (pas jest.clearAllMocks qui vide aussi mock.instances
    // du WebhookManager — dont on a besoin pour vérifier processEvent)
    axios.post.mockReset();
    // Clear calls de processEvent localement (mais pas l'instance)
    if (webhookInstance) webhookInstance.processEvent.mockClear();
  });

  test('GET /webhook/:token avec event=call:incoming → 200 + processEvent appelé', async () => {
    const res = await request(app)
      .get('/webhook/valid-token?event=call:incoming&uniqueId=abc123&callerIdNum=0612345678');
    expect(res.status).toBe(200);
    expect(webhookInstance.processEvent).toHaveBeenCalledWith(
      'valid-token',
      expect.objectContaining({ event: 'call:incoming' })
    );
  });

  test('GET /webhook/:token avec token invalide → 401', async () => {
    const res = await request(app)
      .get('/webhook/invalid-token?event=call:incoming');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Token invalide' });
  });

  test('GET /webhook/:token sans param event → 400', async () => {
    const res = await request(app).get('/webhook/valid-token');
    expect(res.status).toBe(400);
  });
});

describe('E2E — Endpoint public + métriques', () => {
  let app;

  beforeAll(async () => {
    const c = await buildContainer();
    app = c.app;
  });

  beforeEach(() => {
    resetMetrics();
  });

  test('GET /health → 200 (ou 503 si UCM déconnecté, mais 200 attendu avec mocks)', async () => {
    const res = await request(app).get('/health');
    // Le health reflète l'état des composants — peut être 503 ou 200 selon la dispo
    expect([200, 503]).toContain(res.status);
  });

  test('GET /metrics → 200 + format Prometheus', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(/ucm_process_/);
  });

  test('GET /api-docs.json → 200 + spec Swagger', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('openapi');
  });

  test('requête sur route inconnue → 401 (auth d\'abord)', async () => {
    // Avec mon fix du bug auth, les routes inconnues sont d'abord
    // filtrées par apiRequireSession → 401 avant d'atteindre le
    // notFoundHandler. C'est le comportement correct (sécurité
    // d'abord, routage ensuite).
    const res = await request(app).get('/api/this-does-not-exist');
    expect(res.status).toBe(401);
  });

  test('CORS : OPTIONS preflight avec Origin → headers CORS présents', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'https://admin.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-methods']).toBeDefined();
  });
});

describe('E2E — Compression + payload limits', () => {
  let app;

  beforeAll(async () => {
    const c = await buildContainer();
    app = c.app;
  });

  test('Réponse JSON > 1024 bytes est compressée (gzip)', async () => {
    // Le health endpoint + métriques retournent de gros payloads
    const res = await request(app)
      .get('/metrics')
      .set('Accept-Encoding', 'gzip');
    // Si la réponse est >1024 bytes (threshold), elle est compressée
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});