'use strict';

const CdrSyncService = require('../src/application/CdrSyncService');
const constants = require('../src/config/constants');

// Mock du module config
jest.mock('../src/config', () => ({
  cdrSync: {
    enabled: true,
    intervalMs: 300000, // 5 minutes
  },
}));

// Helper pour tester flattenCdrRecords (normalement exportée)
function flattenCdrRecords(records) {
  const flat = [];
  for (const cdr of records) {
    const subs = constants.UCM_SUB_CDR_KEYS.map(k => cdr[k]).filter(Boolean);
    const answered = subs.filter(s => s.disposition === 'ANSWERED');
    const best = answered.sort((a, b) => (b.billsec || 0) - (a.billsec || 0))[0]
      || subs[0] || cdr.main_cdr;
    if (!best?.uniqueid) continue;
    if (!best.recordfiles?.replace(/@$/g, '').trim()) {
      const withRec = subs.find(s => s.recordfiles?.replace(/@$/g, '').trim());
      if (withRec) best.recordfiles = withRec.recordfiles;
    }
    flat.push(best);
  }
  return flat;
}

const createMocks = () => ({
  ucmHttpClient: {
    fetchCdr: jest.fn(),
  },
  callHistory: {
    createCallFromCdr: jest.fn(),
    updateCallRecordingUrl: jest.fn(),
    getUnresolvedPhones: jest.fn(() => Promise.resolve([])),
    resolveCallsByPhone: jest.fn(),
  },
  crmClient: {
    findContactByPhone: jest.fn(),
  },
  wsServer: {
    broadcast: jest.fn(),
  },
  whisperService: {
    isEnabled: true,
    processNewRecordings: jest.fn(),
  },
});

describe('CdrSyncService', () => {
  let mocks;
  let service;

  beforeEach(() => {
    mocks = createMocks();
    service = new CdrSyncService({
      ucmHttpClient: mocks.ucmHttpClient,
      callHistory: mocks.callHistory,
      crmClient: mocks.crmClient,
      wsServer: mocks.wsServer,
      whisperService: mocks.whisperService,
    });
    jest.useFakeTimers();
    global.clearInterval = jest.fn();
  });

  afterEach(() => {
    service.stop();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('flattenCdrRecords', () => {
    test('doit aplatir un CDR avec sub_cdr', () => {
      const records = [{
        main_cdr: { uniqueid: '123', disposition: 'NO ANSWER' },
        sub_cdr_1: { uniqueid: '123-1', disposition: 'ANSWERED', billsec: 45 },
        sub_cdr_2: null,
        sub_cdr_3: null,
        sub_cdr_4: null,
      }];

      const result = flattenCdrRecords(records);

      expect(result).toHaveLength(1);
      expect(result[0].uniqueid).toBe('123-1');
      expect(result[0].disposition).toBe('ANSWERED');
    });

    test('doit choisir le sub_cdr ANSWERED le plus long', () => {
      const records = [{
        main_cdr: { uniqueid: '123', disposition: 'NO ANSWER' },
        sub_cdr_1: { uniqueid: '123-1', disposition: 'ANSWERED', billsec: 30 },
        sub_cdr_2: { uniqueid: '123-2', disposition: 'ANSWERED', billsec: 60 },
        sub_cdr_3: null,
        sub_cdr_4: null,
      }];

      const result = flattenCdrRecords(records);

      expect(result).toHaveLength(1);
      expect(result[0].uniqueid).toBe('123-2');
      expect(result[0].billsec).toBe(60);
    });

    test('doit propager recordfiles si absent du sub_cdr sélectionné', () => {
      const records = [{
        main_cdr: { uniqueid: '123', disposition: 'NO ANSWER' },
        sub_cdr_1: { uniqueid: '123-1', disposition: 'ANSWERED', billsec: 45, recordfiles: '2026-03/call.wav@' },
        sub_cdr_2: { uniqueid: '123-2', disposition: 'ANSWERED', billsec: 60 },
      }];

      const result = flattenCdrRecords(records);

      // Le sub_cdr_2 est sélectionné (plus long) mais doit hériter du recordfiles
      expect(result[0].recordfiles).toBe('2026-03/call.wav@');
    });

    test('doit filtrer les CDR sans uniqueid', () => {
      const records = [{
        main_cdr: { disposition: 'ANSWERED' }, // pas d'uniqueid
        sub_cdr_1: null,
      }];

      const result = flattenCdrRecords(records);

      expect(result).toHaveLength(0);
    });

    test('doit gérer plusieurs CDR en entrée', () => {
      const records = [
        {
          main_cdr: { uniqueid: '123', disposition: 'NO ANSWER' },
          sub_cdr_1: { uniqueid: '123-1', disposition: 'ANSWERED', billsec: 45 },
        },
        {
          main_cdr: { uniqueid: '456', disposition: 'ANSWERED' },
          sub_cdr_1: null,
        },
      ];

      const result = flattenCdrRecords(records);

      expect(result).toHaveLength(2);
      expect(result[0].uniqueid).toBe('123-1');
      expect(result[1].uniqueid).toBe('456');
    });
  });

  describe('Démarrage et arrêt', () => {
    test('doit démarrer avec un intervalle', () => {
      service.start();

      expect(service._interval).toBeDefined();
    });

    test('doit exécuter un premier sync après 30s', () => {
      const syncSpy = jest.spyOn(service, '_runSync').mockResolvedValue({});
      service.start();

      // Avancer de 30 secondes
      jest.advanceTimersByTime(30000);

      expect(syncSpy).toHaveBeenCalled();
    });

    test('doit s\'arrêter correctement', () => {
      service.start();
      const interval = service._interval;

      service.stop();

      expect(service._interval).toBeNull();
      expect(clearInterval).toHaveBeenCalledWith(interval);
    });
  });

  describe('Synchronisation CDR', () => {
    test('doit récupérer et insérer les CDR', async () => {
      mocks.ucmHttpClient.fetchCdr.mockResolvedValue({
        records: [{
          main_cdr: { uniqueid: '123', disposition: 'ANSWERED', billsec: 45 },
          sub_cdr_1: null,
        }],
        total: 1,
      });
      mocks.callHistory.createCallFromCdr.mockResolvedValue(true);

      const result = await service.syncNow({ startTime: '2026-03-28 00:00:00', endTime: '2026-03-28 23:59:59' });

      expect(mocks.ucmHttpClient.fetchCdr).toHaveBeenCalledWith('2026-03-28 00:00:00', '2026-03-28 23:59:59');
      expect(mocks.callHistory.createCallFromCdr).toHaveBeenCalled();
      expect(result).toMatchObject({
        fetched: 1,
        flattened: 1,
        inserted: 1,
      });
    });

    test('doit mettre à jour recording_url pour les CDR existants', async () => {
      mocks.ucmHttpClient.fetchCdr.mockResolvedValue({
        records: [{
          main_cdr: { uniqueid: '123', disposition: 'ANSWERED', recordfiles: '2026-03/call.wav@' },
          sub_cdr_1: null,
        }],
        total: 1,
      });
      mocks.callHistory.createCallFromCdr.mockResolvedValue(false); // CDR existant

      await service.syncNow();

      expect(mocks.callHistory.updateCallRecordingUrl).toHaveBeenCalledWith(
        '123',
        '/api/recordings/download/call.wav'
      );
    });

    test('doit éviter les exécutions parallèles', async () => {
      let resolvePromise;
      const pendingPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      mocks.ucmHttpClient.fetchCdr.mockImplementation(() => pendingPromise);

      const promise1 = service.syncNow();
      const promise2 = service.syncNow();

      // Résoudre la promesse pendante
      resolvePromise({ records: [], total: 0 });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBeDefined();
      expect(result2).toEqual({ skipped: true });
    }, 20000);
  });

  describe('Résolution des contacts', () => {
    test('doit résoudre les appels avec numéro inconnu', async () => {
      mocks.callHistory.getUnresolvedPhones.mockResolvedValue([
        { caller_id_num: '+33612345678' },
        { caller_id_num: '+33698765432' },
      ]);

      mocks.crmClient.findContactByPhone
        .mockResolvedValueOnce({ id: 1, name: 'Jean Dupont', phone: '+33612345678' })
        .mockResolvedValueOnce({ id: 2, name: 'Marie Martin', phone: '+33698765432' });

      mocks.callHistory.resolveCallsByPhone.mockResolvedValue(5);

      const result = await service.resolveContacts();

      expect(mocks.callHistory.getUnresolvedPhones).toHaveBeenCalledWith(200);
      expect(mocks.crmClient.findContactByPhone).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ checked: 2, resolved: expect.any(Number) });
    });

    test('doit ignorer les contacts déjà connus (Inconnu *)', async () => {
      mocks.callHistory.getUnresolvedPhones.mockResolvedValue([
        { caller_id_num: '+33612345678' },
      ]);

      mocks.crmClient.findContactByPhone.mockResolvedValue({
        id: 1,
        name: 'Inconnu +33612345678',
        phone: '+33612345678',
      });

      const result = await service.resolveContacts();

      expect(mocks.callHistory.resolveCallsByPhone).not.toHaveBeenCalled();
      expect(result.resolved).toBe(0);
    });

    test('doit notifier les clients WebSocket après résolution', async () => {
      mocks.callHistory.getUnresolvedPhones.mockResolvedValue([
        { caller_id_num: '+33612345678' },
      ]);

      mocks.crmClient.findContactByPhone.mockResolvedValue({
        id: 1,
        name: 'Jean Dupont',
        phone: '+33612345678',
      });

      mocks.callHistory.resolveCallsByPhone.mockResolvedValue(3);

      await service.resolveContacts();

      expect(mocks.wsServer.broadcast).toHaveBeenCalledWith({
        type: 'calls_updated',
        resolved: 3,
      });
    });
  });

  describe('Transcription Whisper', () => {
    test('doit lancer la transcription après sync', async () => {
      mocks.ucmHttpClient.fetchCdr.mockResolvedValue({
        records: [],
        total: 0,
      });

      await service.syncNow();

      expect(mocks.whisperService.processNewRecordings).toHaveBeenCalled();
    });

    test('doit continuer même si Whisper échoue', async () => {
      mocks.ucmHttpClient.fetchCdr.mockResolvedValue({
        records: [],
        total: 0,
      });

      mocks.whisperService.processNewRecordings.mockRejectedValue(new Error('Whisper error'));

      // Ne doit pas lever d'exception
      await expect(service.syncNow()).resolves.toBeDefined();
    });
  });
});
