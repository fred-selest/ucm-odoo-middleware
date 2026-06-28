'use strict';

const auth = require('../src/presentation/api/middleware/auth');

describe('SESSIONS — plafond anti-OOM', () => {
  beforeEach(() => {
    auth.SESSIONS.clear();
  });

  test('createSession accepte sous le plafond et persiste la session', () => {
    const token = auth.createSession(1, 'alice');
    expect(token).toBeTruthy();
    expect(auth.checkSession(token)).toMatchObject({ uid: 1, username: 'alice' });
    expect(auth.SESSIONS.has(token)).toBe(true);
  });

  test('createSession utilise un UUID v4 (collision quasi-impossible)', () => {
    const t1 = auth.createSession(1, 'a');
    const t2 = auth.createSession(2, 'b');
    expect(t1).not.toBe(t2);
    expect(t1).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('cleanupExpiredSessions supprime uniquement les sessions expirées', () => {
    const t1 = auth.createSession(1, 'alice');
    const t2 = auth.createSession(2, 'bob');
    auth.SESSIONS.get(t1).expiresAt = Date.now() - 1000; // expirer alice
    auth.cleanupExpiredSessions();
    expect(auth.SESSIONS.has(t1)).toBe(false);
    expect(auth.SESSIONS.has(t2)).toBe(true);
  });

  test('checkSession supprime automatiquement une session expirée', () => {
    const token = auth.createSession(1, 'alice');
    auth.SESSIONS.get(token).expiresAt = Date.now() - 1000;
    const result = auth.checkSession(token);
    expect(result).toBeNull();
    expect(auth.SESSIONS.has(token)).toBe(false);
  });
});