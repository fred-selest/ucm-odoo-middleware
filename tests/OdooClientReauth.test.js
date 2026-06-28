'use strict';

// Tests ciblés sur le helper _searchReadWithReauth + son usage dans
// findContactByPhone et searchContactsByNameOrCompany.

jest.mock('axios');

const OdooClient = require('../src/infrastructure/odoo/OdooClient');

describe('OdooClient._searchReadWithReauth', () => {
  let client;

  beforeEach(() => {
    client = new OdooClient();
    // Pas besoin d'authentification réelle pour ce helper — on shunte.
    client._uid = 2;
  });

  test('appelle _callModel une fois si pas d\'erreur', async () => {
    jest.spyOn(client, '_callModel').mockResolvedValue([{ id: 1, name: 'Test' }]);
    const result = await client._searchReadWithReauth([['id', '=', 1]], { limit: 1 });
    expect(result).toEqual([{ id: 1, name: 'Test' }]);
    expect(client._callModel).toHaveBeenCalledTimes(1);
  });

  test('retry automatique sur "Access Denied" (auth reset + nouvelle tentative)', async () => {
    const callModel = jest.spyOn(client, '_callModel')
      .mockRejectedValueOnce(new Error('Access Denied'))
      .mockResolvedValueOnce([{ id: 2, name: 'Recovered' }]);
    const authenticate = jest.spyOn(client, 'authenticate').mockImplementation(async () => {
      client._uid = 2;
      return 2;
    });

    const result = await client._searchReadWithReauth([['id', '=', 2]]);
    expect(result).toEqual([{ id: 2, name: 'Recovered' }]);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(client._uid).toBe(2);
  });

  test('retry automatique sur "Session expired"', async () => {
    jest.spyOn(client, '_callModel')
      .mockRejectedValueOnce(new Error('Session expired'))
      .mockResolvedValueOnce([]);
    jest.spyOn(client, 'authenticate').mockResolvedValue(2);

    const result = await client._searchReadWithReauth([]);
    expect(result).toEqual([]);
  });

  test('pas de retry sur une erreur non-auth', async () => {
    const callModel = jest.spyOn(client, '_callModel').mockRejectedValue(new Error('Network timeout'));
    await expect(client._searchReadWithReauth([])).rejects.toThrow('Network timeout');
    expect(callModel).toHaveBeenCalledTimes(1); // 1 seul appel, pas de retry
  });

  test('retry unique : si le 2e appel échoue aussi, propage l\'erreur', async () => {
    jest.spyOn(client, '_callModel')
      .mockRejectedValueOnce(new Error('Access Denied'))
      .mockRejectedValueOnce(new Error('Access Denied (retry)'));
    jest.spyOn(client, 'authenticate').mockResolvedValue(2);
    await expect(client._searchReadWithReauth([])).rejects.toThrow('Access Denied (retry)');
  });

  test('findContactByPhone utilise le helper (pas de duplication du try/catch)', async () => {
    const searchReadWithReauth = jest.spyOn(client, '_searchReadWithReauth')
      .mockResolvedValue([{ id: 99, name: 'Cache', phone: '0612345678', is_company: false, parent_id: false, image_128: null }]);
    jest.spyOn(client, 'ensureAuthenticated').mockResolvedValue(2);

    const contact = await client.findContactByPhone('0612345678');
    expect(searchReadWithReauth).toHaveBeenCalledTimes(1);
    expect(contact.id).toBe(99);
  });

  test('searchContactsByNameOrCompany utilise le helper', async () => {
    const helper = jest.spyOn(client, '_searchReadWithReauth').mockResolvedValue([]);
    jest.spyOn(client, 'ensureAuthenticated').mockResolvedValue(2);
    await client.searchContactsByNameOrCompany('Acme');
    expect(helper).toHaveBeenCalledTimes(1);
    expect(helper.mock.calls[0][0]).toEqual([
      '|',
      ['name', 'ilike', 'Acme'],
      ['parent_id.name', 'ilike', 'Acme'],
    ]);
  });
});