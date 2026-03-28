'use strict';

const config = require('../src/config');

describe('Configuration', () => {
  describe('UCM', () => {
    test('doit avoir les valeurs par défaut correctes', () => {
      expect(config.ucm).toBeDefined();
      expect(config.ucm.mode).toBe('webhook');
      expect(config.ucm.host).toBe('217.71.122.142');
      expect(config.ucm.webPort).toBe(8089);
      expect(config.ucm.username).toBe('fred_admin');
    });

    test('doit avoir les délais de reconnexion configurés', () => {
      expect(config.ucm.reconnectDelay).toBe(3000);
      expect(config.ucm.reconnectMaxDelay).toBe(60000);
    });

    test('doit avoir TLS configuré', () => {
      expect(config.ucm.tls).toBeDefined();
      expect(config.ucm.tls.rejectUnauthorized).toBe(true);
    });
  });

  describe('Odoo', () => {
    test('doit avoir les paramètres de connexion', () => {
      expect(config.odoo).toBeDefined();
      expect(config.odoo.url).toBe('https://selest-informatique.odoo.com');
      expect(config.odoo.db).toBe('selest-informatique');
      expect(config.odoo.username).toBe('contact@selest.info');
      expect(config.odoo.apiKey).toBeDefined();
    });

    test('doit avoir un timeout et cache TTL', () => {
      expect(config.odoo.timeout).toBe(8000);
      expect(config.odoo.cacheContactTtl).toBe(300);
    });
  });

  describe('CDR Sync', () => {
    test('doit être activé avec un intervalle', () => {
      expect(config.cdrSync.enabled).toBe(true);
      expect(config.cdrSync.intervalMs).toBe(300000); // 5 minutes
    });
  });

  describe('Whisper', () => {
    test('doit avoir la transcription configurée', () => {
      expect(config.whisper.enabled).toBe(true);
      expect(config.whisper.mode).toBe('local');
      expect(config.whisper.model).toBe('tiny');
      expect(config.whisper.language).toBe('fr');
    });
  });

  describe('Serveur', () => {
    test('doit avoir le port et le chemin WebSocket', () => {
      expect(config.server.port).toBe(3000);
      expect(config.server.wsPath).toBe('/ws');
    });
  });
});
