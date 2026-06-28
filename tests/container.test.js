'use strict';

// Tests du container DI : on vérifie que tous les services sont instanciés
// et câblés correctement. On mocke les dépendances externes (DB, HTTP, etc.).

jest.mock('../src/infrastructure/database/CallHistory', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    db: { close: jest.fn().mockResolvedValue(undefined) },
  }));
});

jest.mock('../src/infrastructure/transcription/WhisperService', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
  }));
});

const { buildContainer, buildApp } = require('../src/container');

describe('container.buildContainer — câblage DI', () => {
  let c;

  beforeAll(async () => {
    c = await buildContainer();
  });

  test('retourne app + httpServer', () => {
    expect(c.app).toBeDefined();
    expect(typeof c.app.use).toBe('function'); // Express app
    expect(c.httpServer).toBeDefined();
    expect(typeof c.httpServer.listen).toBe('function');
  });

  test('instancie tous les services d\'infrastructure', () => {
    expect(c.ucmHttpClient).toBeDefined();
    expect(c.ucmWsClient).toBeDefined();
    expect(c.crmClient).toBeDefined();
    expect(c.webhookManager).toBeDefined();
    expect(c.callHistory).toBeDefined();
    expect(c.wsServer).toBeDefined();
  });

  test('instancie tous les services d\'application', () => {
    expect(c.spamScoreService).toBeDefined();
    expect(c.notificationService).toBeDefined();
    expect(c.callHandler).toBeDefined();
    expect(c.sireneService).toBeDefined();
    expect(c.annuaireService).toBeDefined();
    expect(c.googlePlacesService).toBeDefined();
    expect(c.whisperService).toBeDefined();
    expect(c.cdrSyncService).toBeDefined();
  });

  test('construit les routers', () => {
    expect(c.apiRouter).toBeDefined();
    expect(c.queuesRouter).toBeDefined();
    expect(typeof c.apiRouter).toBe('function'); // Express router
  });

  test('CallHistory expose une méthode init() (câblage OK)', () => {
    expect(typeof c.callHistory.init).toBe('function');
  });

  test('WhisperService expose une méthode init() (câblage OK)', () => {
    expect(typeof c.whisperService.init).toBe('function');
  });
});

describe('container.buildApp — middleware Express', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  test('retourne une Express app', () => {
    expect(typeof app.use).toBe('function');
    expect(typeof app.get).toBe('function');
    expect(typeof app.listen).toBe('function');
  });

  test('a trust proxy activé (pour IP derrière reverse proxy)', () => {
    expect(app.get('trust proxy')).toBe(1);
  });

  test('a désactivé x-powered-by header', () => {
    expect(app.get('x-powered-by')).toBe(false);
  });
});