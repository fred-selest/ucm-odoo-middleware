'use strict';

const UcmHttpClient = require('../src/infrastructure/ucm/UcmHttpClient');

describe('UcmHttpClient — TLS', () => {
  test('le HTTPS agent doit respecter config.ucm.tls.rejectUnauthorized (défaut: true)', () => {
    const client = new UcmHttpClient();
    const agent = client._axiosInstance.defaults.httpsAgent;
    expect(agent).toBeDefined();
    expect(agent.options.rejectUnauthorized).toBe(true);
  });

  test('doit conserver keepAlive et maxSockets pour le pool de connexions', () => {
    const client = new UcmHttpClient();
    const agent = client._axiosInstance.defaults.httpsAgent;
    expect(agent.options.keepAlive).toBe(true);
    expect(agent.options.maxSockets).toBe(50);
  });
});