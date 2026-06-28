'use strict';

const { authLimiter } = require('../src/presentation/api/middleware/security');

// Reset le store mémoire entre tests pour ne pas avoir d'interférences
function resetLimiter() {
  if (authLimiter.resetKey) authLimiter.resetKey('127.0.0.1');
  if (authLimiter.resetIp) authLimiter.resetIp('127.0.0.1');
  if (authLimiter.store && authLimiter.store.resetAll) authLimiter.store.resetAll();
}

function makeReqRes(ip = '127.0.0.1') {
  const headers = {};
  let resolveDone;
  const donePromise = new Promise((resolve) => { resolveDone = resolve; });
  const res = {
    statusCode: 200,
    body: null,
    headers,
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    getHeader: (k) => headers[k.toLowerCase()],
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; resolveDone(); return this; },
    send(data) { this.body = data; resolveDone(); return this; },
    done: () => donePromise,
  };
  return {
    req: { ip, headers: {}, app: { get: () => undefined } },
    res,
  };
}

function runLimiter(req, res) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => { if (!resolved) { resolved = true; resolve(); } };
    res.json = ((orig) => function (data) { this.body = data; finish(); return this; })(res.json);
    res.send = ((orig) => function (data) { this.body = data; finish(); return this; })(res.send);
    authLimiter(req, res, () => finish());
    setTimeout(finish, 500);
  });
}

describe('authLimiter — rate-limit sur /api/auth/login', () => {
  beforeEach(() => resetLimiter());

  test('laisse passer les 10 premières requêtes', async () => {
    let passed = 0;
    for (let i = 0; i < 10; i++) {
      const { req, res } = makeReqRes();
      await runLimiter(req, res);
      if (res.statusCode === 200) passed++;
    }
    expect(passed).toBe(10);
  });

  test('bloque la 11e requête avec 429', async () => {
    for (let i = 0; i < 10; i++) {
      const { req, res } = makeReqRes();
      await runLimiter(req, res);
    }
    const { req, res } = makeReqRes();
    await runLimiter(req, res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ ok: false, error: expect.stringContaining('Trop de tentatives') });
  });

  test('compteurs séparés par IP (isolation)', async () => {
    for (let i = 0; i < 10; i++) {
      const { req, res } = makeReqRes('10.0.0.1');
      await runLimiter(req, res);
    }
    const { req: reqB, res: resB } = makeReqRes('10.0.0.2');
    await runLimiter(reqB, resB);
    expect(resB.statusCode).toBe(200);
  });
});