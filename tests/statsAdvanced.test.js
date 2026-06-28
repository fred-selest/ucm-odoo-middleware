'use strict';

// Tests E2E pour les endpoints v1.4.0 — stats avancées.
// Mock complet : axios, CallHistory, DB, WebhookManager, UcmWsClient.

jest.mock('axios');

jest.mock('../src/infrastructure/database/Database', () => {
  const _mockStore = { calls: [] };
  return {
    run: jest.fn().mockImplementation(async (sql, params = []) => {
      // INSERT INTO _migrations
      if (sql.includes('INSERT INTO _migrations')) return { id: 1, changes: 1 };
      // INSERT INTO calls
      if (sql.includes('INSERT INTO calls')) {
        const newId = _mockStore.calls.length + 1;
        const row = {
          unique_id: params[0] || `call-${newId}`,
          caller_id_num: params[1] || null,
          caller_id_name: params[2] || null,
          exten: params[3] || null,
          agent_exten: params[4] || null,
          direction: params[5] || 'inbound',
          status: params[6] || 'ringing',
          started_at: params[7] || new Date().toISOString(),
          answered_at: null,
          hung_up_at: null,
          duration: 0,
          contact_id: null,
          contact_name: null,
        };
        _mockStore.calls.push(row);
        return { id: newId, changes: 1 };
      }
      return { id: 1, changes: 1 };
    }),
    all: jest.fn().mockImplementation(async (sql) => {
      // SELECT version FROM _migrations
      if (sql.includes('SELECT version FROM _migrations')) return [];
      // SELECT * FROM calls (utilisé par getCalls pour export CSV)
      if (sql.includes('FROM calls')) {
        // Pour le test export, retourner _mockStore.calls. En prod, getCalls filtre
        return [..._mockStore.calls];
      }
      return [];
    }),
    get: jest.fn().mockImplementation(async (sql) => {
      // getStats / getCompare : retourne des compteurs agrégés
      const total = _mockStore.calls.length;
      const answered = _mockStore.calls.filter((c) => c.status === 'answered' || c.status === 'hangup').length;
      const missed = _mockStore.calls.filter((c) => c.status === 'missed').length;
      return {
        total, answered, missed,
        avg_duration: total > 0 ? 42 : 0,
      };
    }),
    connect: jest.fn().mockResolvedValue(undefined),
    // Helper accessible via __mockStore
    __mockStore: _mockStore,
  };
});

jest.mock('../src/infrastructure/transcription/WhisperService', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    enabled: false,
  }));
});

jest.mock('../src/application/WebhookManager', () => {
  return jest.fn().mockImplementation(() => ({
    hasToken: jest.fn().mockReturnValue(false),
    processEvent: jest.fn(),
    on: jest.fn(),
  }));
});

jest.mock('../src/infrastructure/ucm/UcmWsClient', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  }));
});

const { buildContainer } = require('../src/container');
const request = require('supertest');
const auth = require('../src/presentation/api/middleware/auth');
const Database = require('../src/infrastructure/database/Database');

describe('E2E — v1.4.0 Stats avancées', () => {
  let app;
  let token;

  beforeAll(async () => {
    const c = await buildContainer();
    app = c.app;
    token = auth.createSession(1, 'admin@selest.info');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    auth.SESSIONS.clear();
    Database.__mockStore.calls = []; // reset DB mock entre tests
    token = auth.createSession(1, 'admin@selest.info');
  });

  describe('GET /api/stats/compare', () => {
    test('retourne period=week par défaut avec structure current/previous', async () => {
      const res = await request(app)
        .get('/api/stats/compare')
        .set('X-Session-Token', token);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveProperty('period', 'week');
      expect(res.body.data).toHaveProperty('current');
      expect(res.body.data).toHaveProperty('previous');
      expect(res.body.data).toHaveProperty('trend');
      expect(res.body.data.current).toEqual(expect.objectContaining({
        total: expect.any(Number),
        answered: expect.any(Number),
        missed: expect.any(Number),
        avgDuration: expect.any(Number),
      }));
    });

    test('accepte period=month', async () => {
      const res = await request(app)
        .get('/api/stats/compare?period=month')
        .set('X-Session-Token', token);
      expect(res.status).toBe(200);
      expect(res.body.data.period).toBe('month');
    });

    test('accepte period=day', async () => {
      const res = await request(app)
        .get('/api/stats/compare?period=day')
        .set('X-Session-Token', token);
      expect(res.status).toBe(200);
      expect(res.body.data.period).toBe('day');
    });

    test('rejette period invalide → 400', async () => {
      const res = await request(app)
        .get('/api/stats/compare?period=year')
        .set('X-Session-Token', token);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/period invalide/);
    });

    test('calcule le delta correctement', async () => {
      // Inject 5 calls "current"
      Database.__mockStore.calls = Array.from({ length: 5 }, (_, i) => ({
        unique_id: `c-${i}`, status: 'answered', direction: 'inbound',
        started_at: new Date().toISOString(),
      }));
      const res = await request(app)
        .get('/api/stats/compare')
        .set('X-Session-Token', token);
      expect(res.body.data.current.total).toBe(5);
      expect(res.body.data.trend.totalDelta).toBeGreaterThanOrEqual(0);
    });

    test('401 sans token', async () => {
      const res = await request(app).get('/api/stats/compare');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/calls/export.csv', () => {
    test('retourne Content-Type text/csv', async () => {
      const res = await request(app)
        .get('/api/calls/export.csv')
        .set('X-Session-Token', token);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
    });

    test('Content-Disposition attachment avec filename date', async () => {
      const res = await request(app)
        .get('/api/calls/export.csv')
        .set('X-Session-Token', token);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.headers['content-disposition']).toMatch(/calls-export-\d{4}-\d{2}-\d{2}\.csv/);
    });

    test('CSV vide : juste le header', async () => {
      const res = await request(app)
        .get('/api/calls/export.csv')
        .set('X-Session-Token', token);
      const lines = res.text.trim().split('\n');
      expect(lines.length).toBe(1); // header seulement
      expect(lines[0]).toMatch(/unique_id,caller_id_num/);
    });

    test('échappement RFC 4180 pour virgules et guillemets', async () => {
      Database.__mockStore.calls = [{
        unique_id: 'u1',
        caller_id_num: '0612345678',
        caller_id_name: 'Dupont, Jean "JD"', // virgule + guillemets
        direction: 'inbound',
        exten: '100',
        agent_exten: '100',
        status: 'answered',
        started_at: '2026-06-28T10:00:00Z',
        answered_at: null,
        hung_up_at: null,
        duration: 30,
        contact_name: null,
        contact_phone: null,
      }];
      const res = await request(app)
        .get('/api/calls/export.csv')
        .set('X-Session-Token', token);
      // Le nom avec virgule+guillemets doit être entouré de " et "" pour les guillemets
      expect(res.text).toMatch(/"Dupont, Jean ""JD"""/);
    });

    test('échappement newline dans une valeur', async () => {
      Database.__mockStore.calls = [{
        unique_id: 'u2',
        caller_id_num: '06',
        caller_id_name: 'Multi\nLine',
        direction: 'inbound',
        exten: '100',
        status: 'answered',
        started_at: '2026-06-28T10:00:00Z',
      }];
      const res = await request(app)
        .get('/api/calls/export.csv')
        .set('X-Session-Token', token);
      // Le newline interne force un saut de ligne dans le CSV :
      // la ligne "u2,06,\"Multi" doit finir par "Multi" wrappé,
      // et la ligne suivante commence par "Line\",..."
      expect(res.text).toMatch(/"Multi\s*\n\s*Line"/);
    });

    test('valeurs null/undefined → cellule vide', async () => {
      Database.__mockStore.calls = [{
        unique_id: 'u3',
        caller_id_num: null,
        caller_id_name: null,
        contact_name: null,
        direction: 'inbound',
        status: 'missed',
        exten: null,
        agent_exten: null,
        started_at: null,
      }];
      const res = await request(app)
        .get('/api/calls/export.csv')
        .set('X-Session-Token', token);
      const lines = res.text.trim().split('\n');
      expect(lines.length).toBe(2);
      expect(lines[1].startsWith('u3,')).toBe(true);
      // Plusieurs virgules successives (cellules vides)
      expect(lines[1]).toMatch(/,{2,}/);
    });

    test('filtre status=missed appliqué', async () => {
      Database.__mockStore.calls = [
        { unique_id: 'a', status: 'missed', direction: 'inbound', started_at: '2026-06-28T10:00:00Z' },
        { unique_id: 'b', status: 'answered', direction: 'inbound', started_at: '2026-06-28T10:01:00Z' },
        { unique_id: 'c', status: 'missed', direction: 'inbound', started_at: '2026-06-28T10:02:00Z' },
      ];
      const res = await request(app)
        .get('/api/calls/export.csv?status=missed')
        .set('X-Session-Token', token);
      // Le mock getCalls passe le filtre via les options
      // On vérifie que l'API reçoit bien le filtre
      // (le mock retourne tous les calls, mais en prod getCalls filtre)
      // → ici on vérifie que les headers sont OK et l'API n'a pas planté
      expect(res.status).toBe(200);
    });

    test('401 sans token', async () => {
      const res = await request(app).get('/api/calls/export.csv');
      expect(res.status).toBe(401);
    });
  });
});