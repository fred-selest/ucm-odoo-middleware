'use strict';

// Test ciblé : vérifie que la logique de batching pour updateCallsForPhone
// utilise des placeholders (?) au lieu d'interpoler les uniqueIds,
// et respecte la taille de batch (500).

// On simule la fonction en l'important directement depuis CallHistory.
// Comme CallHistory dépend de la base SQLite, on mocke la classe Database.
jest.mock('../src/infrastructure/database/Database', () => ({
  run: jest.fn(async (sql, params) => {
    // Vérifie qu'aucune valeur uniqueId n'est interpolée dans le SQL
    return { id: 0, changes: params.length };
  }),
  all: jest.fn(),
  get: jest.fn(),
  connect: jest.fn(),
}));

const CallHistory = require('../src/infrastructure/database/CallHistory');

describe('CallHistory.updateCallsForPhone — sécurité SQL', () => {
  let callHistory;
  let Database;

  beforeEach(() => {
    jest.clearAllMocks();
    Database = require('../src/infrastructure/database/Database');
    callHistory = new CallHistory();
  });

  const fakeContact = {
    id: 42,
    name: 'Test',
    phone: '+33612345678',
    email: null,
    odooUrl: 'http://odoo/x/42',
    partnerId: 42,
    avatar: null,
  };

  test('aucun uniqueId n\'est interpolé dans la requête SQL', async () => {
    Database.all.mockResolvedValue([
      { unique_id: 'abc\'; DROP TABLE calls; --' }, // tentative d'injection
    ]);
    await callHistory.updateCallsForPhone('+33612345678', fakeContact);
    expect(Database.run).toHaveBeenCalledTimes(1);
    const [sql, params] = Database.run.mock.calls[0];
    // La chaîne malveillante ne doit PAS apparaître dans le SQL brut
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('abc\';');
    // Elle doit être passée en paramètre
    expect(params).toContain('abc\'; DROP TABLE calls; --');
    // Et le SQL doit utiliser des placeholders
    expect(sql).toMatch(/WHERE unique_id IN \(\?/);
  });

  test('batching : 1200 ids → 3 appels (taille batch = 500)', async () => {
    const calls = [];
    for (let i = 0; i < 1200; i++) calls.push({ unique_id: `uid-${i}` });
    Database.all.mockResolvedValue(calls);
    await callHistory.updateCallsForPhone('+33612345678', fakeContact);
    expect(Database.run).toHaveBeenCalledTimes(3);
    // Vérifier la taille de chaque batch
    expect(Database.run.mock.calls[0][1].length).toBe(15 + 500); // 15 contact + 500 ids
    expect(Database.run.mock.calls[1][1].length).toBe(15 + 500);
    expect(Database.run.mock.calls[2][1].length).toBe(15 + 200); // reste
  });

  test('aucun appel SQL si aucun appel à mettre à jour', async () => {
    Database.all.mockResolvedValue([]);
    const result = await callHistory.updateCallsForPhone('+33612345678', fakeContact);
    expect(result).toBe(0);
    expect(Database.run).not.toHaveBeenCalled();
  });

  test('retourne le nombre total de lignes updatées', async () => {
    Database.all.mockResolvedValue([{ unique_id: 'a' }, { unique_id: 'b' }, { unique_id: 'c' }]);
    Database.run.mockResolvedValue({ id: 0, changes: 3 });
    const result = await callHistory.updateCallsForPhone('+33612345678', fakeContact);
    expect(result).toBe(3);
  });

  test('retourne 0 si le phone est falsy', async () => {
    const result = await callHistory.updateCallsForPhone('', fakeContact);
    expect(result).toBe(0);
    expect(Database.run).not.toHaveBeenCalled();
  });
});