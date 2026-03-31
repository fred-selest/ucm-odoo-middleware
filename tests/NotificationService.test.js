'use strict';

const { describe, it, beforeEach, afterEach, expect } = require('@jest/globals');

// Mock logger avant d'importer le service
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  on: jest.fn(),
}));

// Mock config
jest.mock('../src/config', () => ({
  telegram: { token: 'test-token', chatIds: ['123456'] },
  smtp: { host: 'smtp.test.com', port: 587, from: 'test@test.com' },
  notifications: {
    missedCallThreshold: { count: 3, minutes: 15 },
    dailySummaryEnabled: true,
    dailySummaryTime: '18:00',
  },
}));

describe('NotificationService', () => {
  let NotificationService;
  let service;

  let mockCallHistory;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock CallHistory
    mockCallHistory = {
      getStats: jest.fn(),
      getTopCallers: jest.fn(),
    };

    NotificationService = require('../src/application/NotificationService');
  });

  afterEach(() => {
    jest.resetModules();
  });

  describe('Constructor', () => {
    it('devrait initialiser le service avec CallHistory', () => {
      service = new NotificationService(mockCallHistory);
      expect(service._callHistory).toBe(mockCallHistory);
    });

    it('devrait initialiser le service sans CallHistory', () => {
      service = new NotificationService(null);
      expect(service._callHistory).toBeNull();
    });
  });

  describe('checkMissedCallAlert', () => {
    beforeEach(() => {
      service = new NotificationService(mockCallHistory);
      service._sendMissedCallAlert = jest.fn();
    });

    it('devrait ignorer les appels non manqués', async () => {
      await service.checkMissedCallAlert({ status: 'answered' });
      expect(service._sendMissedCallAlert).not.toHaveBeenCalled();
    });

    it('devrait ajouter un appel manqué au buffer', async () => {
      await service.checkMissedCallAlert({
        status: 'missed',
        caller_id_num: '0612345678',
        exten: '101',
      });
      expect(service._missedCallBuffer.length).toBe(1);
    });

    it('devrait déclencher l\'alerte quand le seuil est atteint', async () => {
      for (let i = 0; i < 3; i++) {
        await service.checkMissedCallAlert({
          status: 'missed',
          caller_id_num: `061234567${i}`,
          exten: '101',
        });
      }
      expect(service._sendMissedCallAlert).toHaveBeenCalledTimes(1);
      expect(service._missedCallBuffer.length).toBe(0);
    });

    it('devrait nettoyer les anciens appels du buffer', async () => {
      service._missedCallBuffer.push({
        time: Date.now() - 20 * 60 * 1000,
        caller: '0612345678',
        exten: '101',
      });

      await service.checkMissedCallAlert({
        status: 'missed',
        caller_id_num: '0698765432',
        exten: '101',
      });

      expect(service._missedCallBuffer.length).toBe(1);
      expect(service._missedCallBuffer[0].caller).toBe('0698765432');
    });
  });

  describe('_getDailyStats', () => {
    it('devrait retourner des stats vides sans CallHistory', async () => {
      service = new NotificationService(null);
      const stats = await service._getDailyStats('2026-03-30');
      expect(stats.total).toBe(0);
      expect(stats.answered).toBe(0);
      expect(stats.missed).toBe(0);
      expect(stats.duration).toBe(0);
      expect(stats.topCallers).toEqual([]);
    });

    it('devrait récupérer les stats depuis CallHistory', async () => {
      mockCallHistory.getStats.mockResolvedValue({
        total: 50,
        answered: 40,
        missed: 10,
        totalDuration: 3600,
      });
      mockCallHistory.getTopCallers.mockResolvedValue([
        { caller_id_num: '0612345678', contact_name: 'Jean Dupont', call_count: 5 },
      ]);

      service = new NotificationService(mockCallHistory);
      const stats = await service._getDailyStats('2026-03-30');

      expect(stats.total).toBe(50);
      expect(stats.answered).toBe(40);
      expect(stats.missed).toBe(10);
      expect(stats.duration).toBe(3600);
      expect(stats.topCallers.length).toBe(1);
      expect(stats.topCallers[0].name).toBe('Jean Dupont');
    });

    it('devrait gérer les erreurs de CallHistory', async () => {
      mockCallHistory.getStats.mockRejectedValue(new Error('DB error'));

      service = new NotificationService(mockCallHistory);
      const stats = await service._getDailyStats('2026-03-30');

      expect(stats.total).toBe(0);
      expect(stats.answered).toBe(0);
    });
  });

  describe('testNotification', () => {
    beforeEach(() => {
      service = new NotificationService(mockCallHistory);
      service.sendTelegram = jest.fn().mockResolvedValue(true);
      service.sendEmail = jest.fn().mockResolvedValue(true);
      service.sendWebPush = jest.fn().mockResolvedValue(true);
    });

    it('devrait tester Telegram', async () => {
      const result = await service.testNotification('telegram');
      expect(result).toBe(true);
      expect(service.sendTelegram).toHaveBeenCalled();
    });

    it('devrait tester Email', async () => {
      const result = await service.testNotification('email');
      expect(result).toBe(true);
      expect(service.sendEmail).toHaveBeenCalled();
    });

    it('devrait tester Web Push', async () => {
      const result = await service.testNotification('webpush');
      expect(result).toBe(true);
      expect(service.sendWebPush).toHaveBeenCalled();
    });

    it('devrait retourner false pour un type inconnu', async () => {
      const result = await service.testNotification('unknown');
      expect(result).toBe(false);
    });
  });
});
