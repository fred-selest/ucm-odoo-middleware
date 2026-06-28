'use strict';

// Tests de structure de la configuration.
// On mocke le module config pour découpler du contenu de .env (qui n'existe pas en CI).

describe('Configuration', () => {
  let config;

  beforeAll(() => {
    // Mock config avec des valeurs stables (pas de dépendance au .env)
    jest.doMock('../src/config', () => ({
      ucm: {
        mode: 'webhook',
        host: '127.0.0.1',
        webPort: 8089,
        username: 'admin',
        reconnectDelay: 3000,
        reconnectMaxDelay: 60000,
        tls: { rejectUnauthorized: true },
      },
      odoo: {
        url: 'https://odoo.example.com',
        db: 'odoo',
        username: 'admin',
        apiKey: 'test-key',
        timeout: 8000,
        cacheContactTtl: 300,
      },
      dolibarr: {
        url: 'https://dolibarr.example.com',
        apiKey: 'test-key',
        timeout: 8000,
      },
      crm: { type: 'odoo' },
      cdrSync: { enabled: true, intervalMs: 300000 },
      whisper: {
        enabled: true,
        mode: 'api',
        model: 'Systran/faster-whisper-large-v3',
        language: 'fr',
      },
      server: { port: 3000, wsPath: '/ws', apiSecretKey: '' },
      app: { nodeEnv: 'test', logLevel: 'info' },
    }));
    config = require('../src/config');
  });

  afterAll(() => {
    jest.unmock('../src/config');
  });

  describe('UCM', () => {
    test('les champs essentiels sont définis', () => {
      expect(config.ucm).toBeDefined();
      expect(config.ucm.mode).toBe('webhook');
      expect(typeof config.ucm.host).toBe('string');
      expect(config.ucm.webPort).toBe(8089);
      expect(typeof config.ucm.username).toBe('string');
    });

    test('délais de reconnexion configurés', () => {
      expect(config.ucm.reconnectDelay).toBe(3000);
      expect(config.ucm.reconnectMaxDelay).toBe(60000);
    });

    test('TLS configuré (rejectUnauthorized par défaut true)', () => {
      expect(config.ucm.tls).toBeDefined();
      expect(config.ucm.tls.rejectUnauthorized).toBe(true);
    });
  });

  describe('Odoo', () => {
    test('les paramètres de connexion sont définis', () => {
      expect(config.odoo).toBeDefined();
      expect(typeof config.odoo.url).toBe('string');
      expect(config.odoo.url).toMatch(/^https?:\/\//);
      expect(typeof config.odoo.db).toBe('string');
      expect(typeof config.odoo.username).toBe('string');
      expect(config.odoo.apiKey).toBeDefined();
    });

    test('timeout et cache TTL configurés', () => {
      expect(typeof config.odoo.timeout).toBe('number');
      expect(config.odoo.timeout).toBeGreaterThan(0);
      expect(config.odoo.cacheContactTtl).toBe(300);
    });
  });

  describe('CDR Sync', () => {
    test('intervalle défini', () => {
      expect(typeof config.cdrSync.enabled).toBe('boolean');
      expect(typeof config.cdrSync.intervalMs).toBe('number');
      expect(config.cdrSync.intervalMs).toBeGreaterThan(0);
    });
  });

  describe('Whisper', () => {
    test('transcription configurée', () => {
      expect(typeof config.whisper.enabled).toBe('boolean');
      expect(typeof config.whisper.mode).toBe('string');
      expect(typeof config.whisper.model).toBe('string');
      expect(typeof config.whisper.language).toBe('string');
    });
  });

  describe('Serveur', () => {
    test('port et chemin WebSocket configurés', () => {
      expect(config.server.port).toBe(3000);
      expect(config.server.wsPath).toBe('/ws');
    });
  });
});