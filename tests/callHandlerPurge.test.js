'use strict';

const CallHandler = require('../src/application/CallHandler');
const { ACTIVE_CALL_TTL_MS } = require('../src/config/constants');

// Mocks minimaux — CallHandler n'utilise pas vraiment ces dépendances pour
// les tests de purge (juste pour ne pas crasher au constructeur).
function makeHandler() {
  return new CallHandler(
    { on() {}, connect: jest.fn(), disconnect: jest.fn() }, // http
    { on() {}, connect: jest.fn(), disconnect: jest.fn() }, // ws
    { findContactByPhone: jest.fn().mockResolvedValue(null) }, // crm
    { notifyExtension: jest.fn() },                            // wsServer
    null,                                                       // webhookManager
    null,                                                       // callHistory
    null,                                                       // spamScore
    null,                                                       // notifications
  );
}

describe('CallHandler._purgeStaleCalls — TTL sur _activeCalls', () => {
  let handler;
  afterEach(() => handler?.disconnect());

  test('ne purge rien quand toutes les entrées sont récentes', () => {
    handler = makeHandler();
    handler._activeCalls.set('recent-1', { _addedAt: Date.now(), callerIdNum: '0612345678' });
    handler._activeCalls.set('recent-2', { _addedAt: Date.now() - 1000, callerIdNum: '0612345679' });
    const purged = handler._purgeStaleCalls();
    expect(purged).toBe(0);
    expect(handler._activeCalls.size).toBe(2);
  });

  test('purge les entrées plus vieilles que ACTIVE_CALL_TTL_MS', () => {
    handler = makeHandler();
    const now = Date.now();
    handler._activeCalls.set('fresh',     { _addedAt: now,                    callerIdNum: 'a' });
    handler._activeCalls.set('stale-1',   { _addedAt: now - ACTIVE_CALL_TTL_MS - 1000, callerIdNum: 'b' });
    handler._activeCalls.set('stale-2',   { _addedAt: now - ACTIVE_CALL_TTL_MS - 60_000, callerIdNum: 'c' });
    const purged = handler._purgeStaleCalls();
    expect(purged).toBe(2);
    expect(handler._activeCalls.size).toBe(1);
    expect(handler._activeCalls.has('fresh')).toBe(true);
  });

  test('considère les entrées sans _addedAt comme expirées (sécurité)', () => {
    handler = makeHandler();
    handler._activeCalls.set('no-timestamp', { callerIdNum: 'x' });
    const purged = handler._purgeStaleCalls();
    expect(purged).toBe(1);
  });

  test('frontière : entrée bien sous le TTL est gardée, bien au-dessus est purgée', () => {
    handler = makeHandler();
    const now = Date.now();
    const safeAddedAt  = now - ACTIVE_CALL_TTL_MS + 60_000;  // 1 min sous le TTL
    const exp1AddedAt  = now - ACTIVE_CALL_TTL_MS - 60_000;  // 1 min au-dessus
    const exp2AddedAt  = now - ACTIVE_CALL_TTL_MS * 2;       // 2× le TTL
    handler._activeCalls.set('safe',      { _addedAt: safeAddedAt,  callerIdNum: 's' });
    handler._activeCalls.set('expired-1', { _addedAt: exp1AddedAt,  callerIdNum: 'e1' });
    handler._activeCalls.set('expired-2', { _addedAt: exp2AddedAt,  callerIdNum: 'e2' });
    expect(handler._activeCalls.size).toBe(3);
    const purged = handler._purgeStaleCalls();
    expect(purged).toBe(2);
    expect(handler._activeCalls.size).toBe(1);
    expect(handler._activeCalls.has('safe')).toBe(true);
  });

  test('disconnect() arrête le timer de purge (pas de fuite)', () => {
    handler = makeHandler();
    expect(handler._purgeTimer).toBeDefined();
    handler.disconnect();
    expect(handler._purgeTimer).toBeNull();
  });
});