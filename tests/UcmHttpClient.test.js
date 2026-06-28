'use strict';

describe('UcmHttpClient — TLS', () => {
  const ORIGINAL_TLS = process.env.UCM_TLS_REJECT_UNAUTHORIZED;

  // Recharge config + client avec une valeur d'env donnée (indépendant du .env ambiant)
  function freshClient(rejectValue) {
    jest.resetModules();
    if (rejectValue === undefined) {
      delete process.env.UCM_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.UCM_TLS_REJECT_UNAUTHORIZED = rejectValue;
    }
    const UcmHttpClient = require('../src/infrastructure/ucm/UcmHttpClient');
    return new UcmHttpClient();
  }

  afterEach(() => {
    if (ORIGINAL_TLS === undefined) {
      delete process.env.UCM_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.UCM_TLS_REJECT_UNAUTHORIZED = ORIGINAL_TLS;
    }
  });

  test('rejectUnauthorized vaut true sauf si explicitement "false"', () => {
    const agent = freshClient('true')._axiosInstance.defaults.httpsAgent;
    expect(agent).toBeDefined();
    expect(agent.options.rejectUnauthorized).toBe(true);
  });

  test('rejectUnauthorized passe à false quand UCM_TLS_REJECT_UNAUTHORIZED=false', () => {
    const agent = freshClient('false')._axiosInstance.defaults.httpsAgent;
    expect(agent.options.rejectUnauthorized).toBe(false);
  });

  test('doit conserver keepAlive et maxSockets pour le pool de connexions', () => {
    const agent = freshClient('true')._axiosInstance.defaults.httpsAgent;
    expect(agent.options.keepAlive).toBe(true);
    expect(agent.options.maxSockets).toBe(50);
  });
});
