'use strict';

const CallHandler = require('../src/application/CallHandler');

// Mocks des dépendances
const createMocks = () => ({
  ucmHttpClient: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    fetchCdr: jest.fn(),
    listBridgedChannels: jest.fn(() => Promise.resolve([])),
    listUnBridgedChannels: jest.fn(() => Promise.resolve([])),
    getSystemStatus: jest.fn(),
  },
  ucmWsClient: {
    on: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    emit: jest.fn(),
  },
  crmClient: {
    authenticate: jest.fn(),
    findContactByPhone: jest.fn(),
    createContact: jest.fn(),
    logCallActivity: jest.fn().mockResolvedValue(true),
    invalidateCache: jest.fn(),
    crmType: 'odoo',
  },
  wsServer: {
    notifyExtension: jest.fn(),
    broadcast: jest.fn(),
  },
  webhookManager: {
    on: jest.fn(),
    emit: jest.fn(),
  },
  callHistory: {
    init: jest.fn(),
    createCall: jest.fn(),
    updateCallContact: jest.fn(),
    updateCallAnswered: jest.fn(),
    updateCallHangup: jest.fn(),
    setAgentOnCall: jest.fn(),
    setAgentAvailable: jest.fn(),
    removeActiveCall: jest.fn(),
    isBlacklisted: jest.fn(() => Promise.resolve(false)),
    addToBlacklist: jest.fn(),
  },
  spamScoreService: {
    check: jest.fn(),
  },
});

describe('CallHandler', () => {
  let mocks;

  beforeEach(() => {
    // Désactiver les fake timers pour CallHandler (utilise setInterval)
    jest.useRealTimers();
    mocks = createMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('Construction', () => {
    test('doit initialiser avec toutes les dépendances', () => {
      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        mocks.webhookManager,
        mocks.callHistory,
        mocks.spamScoreService
      );

      expect(handler).toBeDefined();
      expect(handler.activeCallsCount).toBe(0);
      expect(mocks.ucmWsClient.on).toHaveBeenCalled();
    });

    test('doit fonctionner sans webhookManager (optionnel)', () => {
      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        null,
        mocks.callHistory,
        mocks.spamScoreService
      );

      expect(handler).toBeDefined();
    });

    test('doit fonctionner sans callHistory (optionnel)', () => {
      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        mocks.webhookManager,
        null,
        mocks.spamScoreService
      );

      expect(handler).toBeDefined();
    });
  });

  describe('Gestion des appels entrants', () => {
    test('doit traiter un appel entrant avec contact trouvé', async () => {
      const contact = { id: 123, name: 'Jean Dupont', phone: '+33612345678' };
      mocks.crmClient.findContactByPhone.mockResolvedValue(contact);

      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        null,
        mocks.callHistory,
        null
      );

      // Déconnecter le polling pour éviter les interférences
      handler.disconnect();
      jest.clearAllMocks();

      const callEvent = {
        type: 'call:incoming',
        data: {
          uniqueId: '1234567890.1',
          callerIdNum: '+33612345678',
          callerIdName: 'Jean Dupont',
          exten: '6500',
          channel: 'SIP/6500-00000001',
          direction: 'inbound',
          timestamp: new Date().toISOString(),
        },
      };

      handler.handleUcmEvent(callEvent);

      // Attendre les promesses asynchrones
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mocks.crmClient.findContactByPhone).toHaveBeenCalledWith('+33612345678');
      expect(mocks.callHistory.createCall).toHaveBeenCalledWith(expect.objectContaining({
        uniqueId: '1234567890.1',
        callerIdNum: '+33612345678',
        direction: 'inbound',
      }));
      expect(mocks.wsServer.notifyExtension).toHaveBeenCalledWith('6500', 'call:incoming', expect.any(Object));
    });

    test('doit ignorer un numéro blacklisté', async () => {
      mocks.callHistory.isBlacklisted.mockResolvedValue(true);

      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        null,
        mocks.callHistory,
        null
      );

      handler.handleUcmEvent({
        type: 'call:incoming',
        data: {
          uniqueId: '1234567890.2',
          callerIdNum: '+33600000000',
          callerIdName: 'Spam',
          exten: '6500',
          direction: 'inbound',
          timestamp: new Date().toISOString(),
        },
      });

      await Promise.resolve();

      expect(mocks.callHistory.createCall).not.toHaveBeenCalled();
      expect(mocks.wsServer.notifyExtension).not.toHaveBeenCalled();
    });

    test('doit ignorer les appels sur trunk SIP', async () => {
      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        null,
        mocks.callHistory,
        null
      );

      handler.handleUcmEvent({
        type: 'call:incoming',
        data: {
          uniqueId: '1234567890.3',
          callerIdNum: '+33612345678',
          exten: 'SLI-TRK-SIP',
          direction: 'inbound',
          timestamp: new Date().toISOString(),
        },
      });

      await Promise.resolve();

      expect(mocks.callHistory.createCall).not.toHaveBeenCalled();
    });

    test('doit détecter un numéro interne (1-5 chiffres)', () => {
      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        null,
        mocks.callHistory,
        null
      );

      // Accès à la méthode privée via le prototype
      const isInternal = handler._isInternalNumber.bind(handler);

      expect(isInternal('6500')).toBe(true);
      expect(isInternal('100')).toBe(true);
      expect(isInternal('12345')).toBe(true);
      expect(isInternal('+33612345678')).toBe(false);
      expect(isInternal('123456')).toBe(false);
    });
  });

  describe('Gestion des appels décrochés', () => {
    test('doit mettre à jour le statut quand un appel est décroché', async () => {
      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        null,
        mocks.callHistory,
        null
      );

      // Simuler un appel entrant d'abord
      handler.handleUcmEvent({
        type: 'call:incoming',
        data: {
          uniqueId: '1234567890.4',
          callerIdNum: '+33612345678',
          exten: '6500',
          direction: 'inbound',
          timestamp: new Date().toISOString(),
        },
      });

      await Promise.resolve();
      jest.clearAllMocks();

      // Simuler le décroché
      handler.handleUcmEvent({
        type: 'call:answered',
        data: {
          uniqueId: '1234567890.4',
          exten: '6500',
          channel: 'SIP/6500-00000001',
          answerTime: new Date().toISOString(),
        },
      });

      await Promise.resolve();

      expect(mocks.callHistory.updateCallAnswered).toHaveBeenCalledWith('1234567890.4');
      expect(mocks.callHistory.setAgentOnCall).toHaveBeenCalledWith('6500', '1234567890.4');
      expect(mocks.wsServer.notifyExtension).toHaveBeenCalledWith('6500', 'call:answered', expect.any(Object));
    });
  });

  describe('Gestion des appels raccrochés', () => {
    test('doit mettre à jour le statut et logger l\'activité quand un appel est raccroché', async () => {
      const contact = { id: 123, name: 'Jean Dupont', phone: '+33612345678' };
      mocks.crmClient.findContactByPhone.mockResolvedValue(contact);

      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        null,
        mocks.callHistory,
        null
      );

      handler.disconnect();
      jest.clearAllMocks();

      // Simuler un appel entrant
      handler.handleUcmEvent({
        type: 'call:incoming',
        data: {
          uniqueId: '1234567890.5',
          callerIdNum: '+33612345678',
          callerIdName: 'Jean Dupont',
          exten: '6500',
          direction: 'inbound',
          timestamp: new Date().toISOString(),
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Simuler le décroché
      handler.handleUcmEvent({
        type: 'call:answered',
        data: {
          uniqueId: '1234567890.5',
          exten: '6500',
          answerTime: new Date().toISOString(),
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      jest.clearAllMocks();

      // Simuler le raccroché
      handler.handleUcmEvent({
        type: 'call:hangup',
        data: {
          uniqueId: '1234567890.5',
          channel: 'SIP/6500-00000001',
          duration: 45,
          disposition: 'ANSWERED',
          hangupTime: new Date().toISOString(),
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mocks.callHistory.updateCallHangup).toHaveBeenCalledWith('1234567890.5', expect.any(Number));
      expect(mocks.callHistory.setAgentAvailable).toHaveBeenCalledWith('6500', expect.any(Number));
      expect(mocks.crmClient.logCallActivity).toHaveBeenCalledWith(123, expect.objectContaining({
        status: 'answered',
        direction: 'inbound',
      }));
    });
  });

  describe('Détection des doublons', () => {
    test('doit ignorer un appel en cours avec le même uniqueId', async () => {
      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        null,
        mocks.callHistory,
        null
      );

      // Premier événement
      handler.handleUcmEvent({
        type: 'call:incoming',
        data: {
          uniqueId: '1234567890.6',
          callerIdNum: '+33612345678',
          exten: '6500',
          direction: 'inbound',
          timestamp: new Date().toISOString(),
        },
      });

      await Promise.resolve();
      jest.clearAllMocks();

      // Deuxième événement (doublon)
      handler.handleUcmEvent({
        type: 'call:incoming',
        data: {
          uniqueId: '1234567890.6',
          callerIdNum: '+33612345678',
          exten: '6500',
          direction: 'inbound',
          timestamp: new Date().toISOString(),
        },
      });

      await Promise.resolve();

      // createCall ne doit être appelé qu'une seule fois
      expect(mocks.callHistory.createCall).toHaveBeenCalledTimes(1);
    });

    test('doit ignorer un appel en cours avec le même numéro', async () => {
      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        null,
        mocks.callHistory,
        null
      );

      handler.disconnect();
      jest.clearAllMocks();

      // Premier appel
      handler.handleUcmEvent({
        type: 'call:incoming',
        data: {
          uniqueId: '1234567890.7',
          callerIdNum: '+33612345678',
          exten: '6500',
          direction: 'inbound',
          timestamp: new Date().toISOString(),
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      jest.clearAllMocks();

      // Deuxième appel avec même numéro mais uniqueId différent
      handler.handleUcmEvent({
        type: 'call:incoming',
        data: {
          uniqueId: '1234567890.8',
          callerIdNum: '+33612345678',
          exten: '6500',
          direction: 'inbound',
          timestamp: new Date().toISOString(),
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mocks.callHistory.createCall).toHaveBeenCalledTimes(0);
    });
  });

  describe('Nettoyage', () => {
    test('doit nettoyer les ressources lors de la déconnexion', () => {
      const handler = new CallHandler(
        mocks.ucmHttpClient,
        mocks.ucmWsClient,
        mocks.crmClient,
        mocks.wsServer,
        null,
        mocks.callHistory,
        null
      );

      // Ajouter un appel fictif
      handler._activeCalls.set('1234567890.9', { uniqueId: '1234567890.9' });

      handler.disconnect();

      expect(handler.activeCallsCount).toBe(0);
      expect(handler._polledCalls.size).toBe(0);
      expect(handler._autoCreatingPhones.size).toBe(0);
    });
  });
});
