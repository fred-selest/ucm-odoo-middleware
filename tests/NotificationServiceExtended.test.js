'use strict';

// Tests focalisés sur les méthodes d'envoi du NotificationService :
// - sendTelegram (via axios)
// - sendEmail (via nodemailer)
// - sendWebPush (via web-push)
// - _sendDailySummary
// - updateConfig
// + E2E flow missed-call → alert

jest.mock('axios');

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-msg-id' }),
    verify: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn().mockResolvedValue({ statusCode: 201 }),
}));

jest.mock('../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  on: jest.fn(),
}));

jest.mock('../src/config', () => ({
  telegram: { token: 'tg-token', chatIds: ['123456', '789012'] },
  smtp: {
    host: 'smtp.test.com', port: 587, secure: false,
    user: 'user@test.com', password: 'pwd',
    from: 'noreply@test.com',
    defaultRecipients: 'admin@test.com,backup@test.com',
  },
  notifications: {
    missedCallThreshold: { count: 3, minutes: 15 },
    dailySummaryEnabled: true,
    dailySummaryTime: '18:00',
  },
}));

// Mock fs (pour _saveSubscriptions / _loadSubscriptions)
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue('{}'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

const axios = require('axios');
const nodemailer = require('nodemailer');
const webpush = require('web-push');
const fs = require('fs');
const NotificationService = require('../src/application/NotificationService');

function makeCallHistory() {
  return {
    getStats: jest.fn().mockResolvedValue({
      total: 10, answered: 7, missed: 3,
      avgDuration: 30, totalDuration: 300, uniqueCallers: 8,
    }),
    getTopCallers: jest.fn().mockResolvedValue([
      { name: 'Acme Corp', phone: '+33612345678', count: 5 },
      { name: 'Globex', phone: '+33687654321', count: 3 },
    ]),
  };
}

describe('NotificationService — envois', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService(makeCallHistory());
  });

  describe('sendTelegram', () => {
    test('envoie via axios avec le token + chatId', async () => {
      axios.post.mockResolvedValue({ data: { ok: true, result: { message_id: 1 } } });
      // Pour ce test on utilise un seul chatId
      const result = await service.sendTelegram('Hello');
      // 2 chatIds dans la config → 2 appels axios.post (1 par chatId)
      expect(axios.post).toHaveBeenCalledTimes(2);
      const [url, body] = axios.post.mock.calls[0];
      expect(url).toBe('https://api.telegram.org/bottg-token/sendMessage');
      expect(body.chat_id).toBe('123456');
      expect(body.text).toBe('Hello');
      // Le 2e appel va au 2e chatId
      expect(axios.post.mock.calls[1][1].chat_id).toBe('789012');
    });

    test('envoie à tous les chatIds configurés', async () => {
      axios.post.mockResolvedValue({ data: { ok: true } });
      await service.sendTelegram('Test multi-chat');
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(axios.post.mock.calls[0][0]).toContain('/sendMessage');
      expect(axios.post.mock.calls[1][0]).toContain('/sendMessage');
    });

    test('retourne false si pas de token configuré', async () => {
      service._telegramToken = '';
      const result = await service.sendTelegram('Test');
      expect(result).toBe(false);
      expect(axios.post).not.toHaveBeenCalled();
    });

    test('swallow erreur axios et log warn', async () => {
      axios.post.mockRejectedValue(new Error('Telegram down'));
      const result = await service.sendTelegram('Test');
      expect(result).toBe(false);
    });

    test('parseMode=HTML par défaut', async () => {
      axios.post.mockResolvedValue({ data: { ok: true } });
      await service.sendTelegram('<b>bold</b>');
      const body = axios.post.mock.calls[0][1];
      expect(body.parse_mode).toBe('HTML');
    });
  });

  describe('sendEmail', () => {
    test('envoie via nodemailer avec subject + html', async () => {
      await service.sendEmail('Test', '<p>Hello</p>');
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
      const transport = nodemailer.createTransport.mock.results[0].value;
      expect(transport.sendMail).toHaveBeenCalledTimes(1);
      const mailOpts = transport.sendMail.mock.calls[0][0];
      expect(mailOpts.subject).toBe('Test');
      expect(mailOpts.html).toBe('<p>Hello</p>');
      expect(mailOpts.from).toBe('noreply@test.com');
    });

    test('utilise les recipients par défaut si pas spécifiés', async () => {
      await service.sendEmail('S', '<p>x</p>');
      const mailOpts = nodemailer.createTransport.mock.results[0].value.sendMail.mock.calls[0][0];
      // defaultRecipients est une string CSV dans la config — le code la passe telle quelle
      expect(mailOpts.to).toBe('admin@test.com,backup@test.com');
    });

    test('utilise les recipients explicites si fournis', async () => {
      await service.sendEmail('S', '<p>x</p>', ['custom@test.com']);
      const mailOpts = nodemailer.createTransport.mock.results[0].value.sendMail.mock.calls[0][0];
      expect(mailOpts.to).toEqual(['custom@test.com']);
    });

    test('retourne false si pas de host SMTP configuré', async () => {
      service._smtpConfig.host = '';
      const result = await service.sendEmail('S', '<p>x</p>');
      expect(result).toBe(false);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    test('swallow erreur SMTP et log warn', async () => {
      nodemailer.createTransport.mockReturnValueOnce({
        sendMail: jest.fn().mockRejectedValue(new Error('SMTP down')),
      });
      const result = await service.sendEmail('S', '<p>x</p>');
      expect(result).toBe(false);
    });
  });

  describe('sendWebPush', () => {
    test('envoie à tous les subscribers', async () => {
      service.addSubscription({ endpoint: 'https://push.example/1', keys: { p256dh: 'a', auth: 'b' } });
      service.addSubscription({ endpoint: 'https://push.example/2', keys: { p256dh: 'c', auth: 'd' } });
      webpush.sendNotification.mockResolvedValue({ statusCode: 201 });
      await service.sendWebPush('Title', 'Body');
      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    });

    test('supprime un endpoint mort (410 Gone)', async () => {
      service.addSubscription({ endpoint: 'https://push.example/dead', keys: { p256dh: 'a', auth: 'b' } });
      const err = new Error('Gone');
      err.statusCode = 410;
      webpush.sendNotification.mockRejectedValueOnce(err);
      await service.sendWebPush('T', 'B');
      expect(service._webPushSubscriptions.length).toBe(0); // supprimé
    });

    test('retourne false si aucun subscriber', async () => {
      const result = await service.sendWebPush('T', 'B');
      expect(result).toBe(false);
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    test('swallow erreur générique sans supprimer', async () => {
      service.addSubscription({ endpoint: 'https://push.example/err', keys: { p256dh: 'a', auth: 'b' } });
      webpush.sendNotification.mockRejectedValue(new Error('Network blip'));
      await service.sendWebPush('T', 'B');
      expect(service._webPushSubscriptions.length).toBe(1); // pas supprimé
    });
  });

  describe('_sendDailySummary', () => {
    test('envoie Telegram + Email avec stats', async () => {
      axios.post.mockResolvedValue({ data: { ok: true } });
      jest.spyOn(service, 'sendEmail').mockResolvedValue(true);
      await service._sendDailySummary();
      expect(axios.post).toHaveBeenCalledTimes(2); // 2 chatIds
      const telegramBody = axios.post.mock.calls[0][1];
      expect(telegramBody.text).toMatch(/Résumé Quotidien/);
      expect(telegramBody.text).toMatch(/10/); // total
      expect(telegramBody.text).toMatch(/70%/); // 7/10 = 70%
    });

    test('fonctionne même sans CallHistory', async () => {
      service = new NotificationService(null);
      axios.post.mockResolvedValue({ data: { ok: true } });
      jest.spyOn(service, 'sendEmail').mockResolvedValue(true);
      await expect(service._sendDailySummary()).resolves.not.toThrow();
    });
  });

  describe('updateConfig', () => {
    test('met à jour le seuil missed call', () => {
      service.updateConfig({ missedCallThreshold: { count: 10, minutes: 5 } });
      expect(service._missedCallThreshold).toEqual({ count: 10, minutes: 5 });
    });

    test('met à jour la config email (merge)', () => {
      service.updateConfig({ smtp: { host: 'new.smtp.com' } });
      expect(service._smtpConfig.host).toBe('new.smtp.com');
      // Les autres champs sont préservés
      expect(service._smtpConfig.port).toBe(587);
    });

    test('met à jour token + chatIds Telegram', () => {
      service.updateConfig({ telegram: { token: 'new-token', chatIds: ['999'] } });
      expect(service._telegramToken).toBe('new-token');
      expect(service._chatIds).toEqual(['999']);
    });

    test('appelle _saveConfig (writeFile)', () => {
      service.updateConfig({ missedCallThreshold: { count: 5, minutes: 10 } });
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });
});

describe('NotificationService — E2E flow missed calls', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService(makeCallHistory());
  });

  test('3 appels manqués en 15 min → alerte Telegram + Email + WebPush', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });
    jest.spyOn(service, 'sendEmail').mockResolvedValue(true);

    const call1 = { status: 'missed', caller_id_num: '0612345678', exten: '100' };
    const call2 = { status: 'missed', caller_id_num: '0698765432', exten: '100' };
    const call3 = { status: 'missed', caller_id_num: '0611111111', exten: '101' };

    await service.checkMissedCallAlert(call1);
    await service.checkMissedCallAlert(call2);
    expect(axios.post).not.toHaveBeenCalled(); // < 3, pas d'alerte

    await service.checkMissedCallAlert(call3); // seuil atteint
    expect(axios.post).toHaveBeenCalled(); // Telegram envoyé
    const msg = axios.post.mock.calls[0][1].text;
    expect(msg).toMatch(/3 appels manqués/);
    expect(msg).toMatch(/0612345678/); // caller listé
  });

  test('appels non-manqués ignorés (compteur ne s\'incrémente pas)', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });

    await service.checkMissedCallAlert({ status: 'answered', caller_id_num: '06' });
    await service.checkMissedCallAlert({ status: 'hangup', caller_id_num: '06' });
    await service.checkMissedCallAlert({ status: 'missed', caller_id_num: '06' });

    expect(service._missedCallBuffer.length).toBe(1); // seul le missed compte
  });

  test('buffer reset après alerte → peut accumuler à nouveau', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });

    // 1ère vague : 3 missed → alerte
    for (let i = 0; i < 3; i++) {
      await service.checkMissedCallAlert({ status: 'missed', caller_id_num: `06${i}` });
    }
    const callsAfterFirstAlert = axios.post.mock.calls.length;
    expect(callsAfterFirstAlert).toBeGreaterThan(0);
    expect(service._missedCallBuffer.length).toBe(0); // buffer reset

    // 2e vague : 3 missed → buffer se remplit, alerte à nouveau
    for (let i = 0; i < 3; i++) {
      await service.checkMissedCallAlert({ status: 'missed', caller_id_num: `06${i}` });
    }
    expect(axios.post.mock.calls.length).toBeGreaterThan(callsAfterFirstAlert);
    expect(service._missedCallBuffer.length).toBe(0); // reset après 2e alerte
  });

  test('seuil personnalisé (count=5) respecté', async () => {
    service.updateConfig({ missedCallThreshold: { count: 5, minutes: 15 } });
    axios.post.mockResolvedValue({ data: { ok: true } });

    for (let i = 0; i < 4; i++) {
      await service.checkMissedCallAlert({ status: 'missed', caller_id_num: `06${i}` });
    }
    expect(axios.post).not.toHaveBeenCalled(); // < 5

    await service.checkMissedCallAlert({ status: 'missed', caller_id_num: '065' });
    expect(axios.post).toHaveBeenCalled(); // 5e → alerte
  });
});