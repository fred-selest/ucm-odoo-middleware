'use strict';

// Tests du système de migrations versionnées.
// On mock le logger (déjà fait globalement par tests/setup.js) et on passe
// un faux `db` qui enregistre les appels SQL.

function makeFakeDb(existingVersions = []) {
  const calls = [];
  const tables = new Set();
  const columns = new Set();
  const tracked = new Set(existingVersions);

  return {
    calls,
    _columns: columns,
    _tracked: tracked,
    async run(sql, params = []) {
      calls.push({ type: 'run', sql: sql.trim().split('\n')[0], params });
      // Simulate CREATE TABLE _migrations
      if (/CREATE TABLE IF NOT EXISTS _migrations/i.test(sql)) {
        tables.add('_migrations');
      }
      // Simulate INSERT INTO _migrations
      const m = sql.match(/INSERT INTO _migrations.*VALUES.*'(.+?)'/);
      if (m) tracked.add(m[1]);
      // Simulate ALTER TABLE
      const a = sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/);
      if (a) columns.add(`${a[1]}.${a[2]}`);
      return { id: 0, changes: 1 };
    },
    async all(sql) {
      calls.push({ type: 'all', sql: sql.trim().split('\n')[0] });
      if (/SELECT version FROM _migrations/i.test(sql)) {
        return [...tracked].map((v) => ({ version: v }));
      }
      return [];
    },
    async get(sql) { return null; },
  };
}

describe('migrations.applyMigrations — système versionné', () => {
  let applyMigrations;
  let MIGRATIONS;

  beforeEach(() => {
    jest.resetModules();
    const mod = require('../src/infrastructure/database/migrations');
    applyMigrations = mod.applyMigrations;
    MIGRATIONS = mod.MIGRATIONS;
  });

  test('crée la table _migrations puis applique les migrations manquantes', async () => {
    const db = makeFakeDb([]);
    const result = await applyMigrations(db);

    // Premier appel = CREATE TABLE _migrations
    expect(db.calls[0].sql).toMatch(/CREATE TABLE IF NOT EXISTS _migrations/);
    // Puis SELECT version
    expect(db.calls[1].sql).toMatch(/SELECT version FROM _migrations/);
    // Puis ALTER TABLE pour la migration
    expect(db.calls[2].sql).toMatch(/ALTER TABLE calls ADD COLUMN transcription/);
    // Puis INSERT dans _migrations
    expect(db.calls[3].sql).toMatch(/INSERT INTO _migrations/);

    expect(result.applied).toContain('0002_calls_transcription');
    expect(result.skipped).toEqual([]);
  });

  test('skip les migrations déjà trackées', async () => {
    const db = makeFakeDb(['0002_calls_transcription']);
    const result = await applyMigrations(db);

    // ALTER ne doit PAS être exécuté
    const alterCall = db.calls.find((c) => /ALTER TABLE/.test(c.sql));
    expect(alterCall).toBeUndefined();
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain('0002_calls_transcription');
  });

  test('gère "duplicate column" comme "déjà appliqué" (cas legacy)', async () => {
    const db = {
      calls: [],
      _throwOnce: true,
      async run(sql) {
        this.calls.push({ sql: sql.trim().split('\n')[0] });
        // Premier ALTER échoue avec "duplicate column"
        if (/ALTER TABLE.*ADD COLUMN transcription/i.test(sql) && this._throwOnce) {
          this._throwOnce = false;
          const err = new Error('SQLITE_ERROR: duplicate column name: transcription');
          throw err;
        }
        return { id: 0, changes: 1 };
      },
      async all(sql) { return []; },
      async get() { return null; },
    };
    const result = await applyMigrations(db);
    // La migration est marquée comme appliquée malgré l'échec ALTER
    expect(result.applied).toContain('0002_calls_transcription');
    // Et INSERT dans _migrations a bien eu lieu
    const insertCall = db.calls.find((c) => /INSERT INTO _migrations/i.test(c.sql));
    expect(insertCall).toBeDefined();
  });

  test('collecte les erreurs sans bloquer les migrations suivantes', async () => {
    const db = {
      calls: [],
      async run(sql) {
        this.calls.push({ sql: sql.trim().split('\n')[0] });
        if (/ALTER TABLE/.test(sql)) {
          throw new Error('SQLITE_ERROR: disk I/O error');
        }
        return { id: 0, changes: 1 };
      },
      async all(sql) { return []; },
      async get() { return null; },
    };
    const result = await applyMigrations(db);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].version).toBe('0002_calls_transcription');
    expect(result.errors[0].error).toMatch(/disk I.O error/);
  });

  test('la liste MIGRATIONS est ordonnée (sémantique de versioning)', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    for (let i = 1; i < MIGRATIONS.length; i++) {
      expect(MIGRATIONS[i].version > MIGRATIONS[i - 1].version).toBe(true);
    }
  });

  test('toutes les migrations ont version, description, sql', () => {
    for (const m of MIGRATIONS) {
      expect(typeof m.version).toBe('string');
      expect(m.version).toMatch(/^\d{4}_/);
      expect(typeof m.description).toBe('string');
      expect(m.description.length).toBeGreaterThan(0);
      expect(typeof m.sql).toBe('string');
    }
  });
});