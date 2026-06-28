'use strict';

// Tests du CrmFactory et des deux adaptateurs (Odoo, Dolibarr).
// On utilise jest.resetModules() pour pouvoir mocker config et exiger
// CrmFactory avec différents CRM_TYPE.

describe('CrmFactory.create', () => {
  // Helper : crée un mock de config avec un type donné
  function loadFactoryWithCrmType(type) {
    jest.resetModules();
    jest.doMock('../src/config', () => ({
      crm: { type },
      odoo: { url: 'http://test', db: 'test', username: 'u', apiKey: 'k' },
      dolibarr: { url: 'http://dolibarr', apiKey: 'k', userId: 1, entityId: null, cacheContactTtl: 300 },
    }));
    return require('../src/infrastructure/crm/CrmFactory');
  }

  afterEach(() => {
    jest.resetModules();
  });

  test('type=odoo → OdooAdapter', () => {
    const CrmFactory = loadFactoryWithCrmType('odoo');
    expect(CrmFactory.create().crmType).toBe('odoo');
  });

  test('type=dolibarr → DolibarrAdapter', () => {
    const CrmFactory = loadFactoryWithCrmType('dolibarr');
    expect(CrmFactory.create().crmType).toBe('dolibarr');
  });

  test('type=inconnu → fallback sur Odoo', () => {
    const CrmFactory = loadFactoryWithCrmType('unknown-crm');
    expect(CrmFactory.create().crmType).toBe('odoo');
  });

  test('type=ODOO (majuscules) → normalisé en minuscule', () => {
    const CrmFactory = loadFactoryWithCrmType('ODOO');
    expect(CrmFactory.create().crmType).toBe('odoo');
  });

  test('currentType() reflète la config', () => {
    const CrmFactory = loadFactoryWithCrmType('dolibarr');
    expect(CrmFactory.currentType()).toBe('dolibarr');
  });

  test('type absent (undefined) → Odoo par défaut', () => {
    const CrmFactory = loadFactoryWithCrmType(undefined);
    expect(CrmFactory.create().crmType).toBe('odoo');
  });
});

describe('OdooAdapter', () => {
  let OdooAdapter;
  let adapter;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/config', () => ({
      odoo: { url: 'http://odoo.test', db: 'test', username: 'u', apiKey: 'k' },
      dolibarr: { url: 'http://dolibarr.test', apiKey: 'k' },
    }));
    OdooAdapter = require('../src/infrastructure/crm/adapters/OdooAdapter');
    adapter = new OdooAdapter();
  });

  test('crmType = "odoo"', () => {
    expect(adapter.crmType).toBe('odoo');
  });

  test('getCrmUrl construit une URL Odoo valide', () => {
    const url = adapter.getCrmUrl(42, false);
    expect(url).toMatch(/^https?:\/\/.+\/web#model=res\.partner&id=42$/);
  });

  test('getCrmUrl ignore isCompany (même URL pour contact et société en Odoo)', () => {
    expect(adapter.getCrmUrl(42, false)).toBe(adapter.getCrmUrl(42, true));
  });

  test('délègue authenticate() à OdooClient', async () => {
    const spy = jest.spyOn(adapter._client, 'authenticate').mockResolvedValue(7);
    expect(await adapter.authenticate()).toBe(7);
    spy.mockRestore();
  });

  test('délègue findContactByPhone() à OdooClient', async () => {
    const spy = jest.spyOn(adapter._client, 'findContactByPhone').mockResolvedValue({ id: 1, name: 'Test' });
    expect(await adapter.findContactByPhone('0612345678')).toEqual({ id: 1, name: 'Test' });
    spy.mockRestore();
  });

  test('délègue searchContacts() à OdooClient.searchContactsByNameOrCompany()', async () => {
    const spy = jest.spyOn(adapter._client, 'searchContactsByNameOrCompany').mockResolvedValue([]);
    expect(await adapter.searchContacts('Acme', 20)).toEqual([]);
    expect(spy).toHaveBeenCalledWith('Acme', 20);
    spy.mockRestore();
  });

  test('invalidateCache et cacheSize passent au client', () => {
    adapter._client._cache.set('0612345678', { contact: { id: 1 }, expiresAt: Date.now() + 60000 });
    expect(adapter.cacheSize).toBe(1);
    adapter.invalidateCache('0612345678');
    expect(adapter.cacheSize).toBe(0);
  });
});

describe('DolibarrAdapter — pure functions (pas de réseau)', () => {
  let DolibarrAdapter;
  let adapter;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/config', () => ({
      dolibarr: {
        url: 'http://dolibarr.test',
        apiKey: 'k',
        userId: 1,
        entityId: null,
        cacheContactTtl: 300,
        timeout: 8000,
      },
    }));
    DolibarrAdapter = require('../src/infrastructure/crm/adapters/DolibarrAdapter');
    adapter = new DolibarrAdapter();
  });

  test('crmType = "dolibarr"', () => {
    expect(adapter.crmType).toBe('dolibarr');
  });

  test('getCrmUrl isCompany=false → URL contact', () => {
    const url = adapter.getCrmUrl(42, false);
    expect(url).toMatch(/\/contact\/card\.php\?id=42$/);
  });

  test('getCrmUrl isCompany=true → URL société', () => {
    const url = adapter.getCrmUrl(42, true);
    expect(url).toMatch(/\/societe\/card\.php\?socid=42$/);
  });

  test('_normalizePhone : format français', () => {
    expect(adapter._normalizePhone('06 12 34 56 78')).toBe('0612345678');
    expect(adapter._normalizePhone('06.12.34.56.78')).toBe('0612345678');
    expect(adapter._normalizePhone('+33612345678')).toBe('0612345678');
    expect(adapter._normalizePhone('0033612345678')).toBe('0612345678');
    expect(adapter._normalizePhone('')).toBe('');
    expect(adapter._normalizePhone(null)).toBe('');
  });

  test('_phoneVariants : génère local + 2 formes internationales', () => {
    const variants = adapter._phoneVariants('0612345678');
    expect(variants).toContain('0612345678');
    expect(variants).toContain('+33612345678');
    expect(variants).toContain('0033612345678');
  });

  test('_normalizeContact : firstname + lastname → name', () => {
    const raw = { id: 1, firstname: 'Jean', lastname: 'Dupont', phone_pro: '0612345678' };
    const c = adapter._normalizeContact(raw);
    expect(c.name).toBe('Jean Dupont');
    expect(c.phone).toBe('0612345678');
    expect(c.isCompany).toBe(false);
    expect(c.id).toBe(1);
  });

  test('_normalizeContact : nom seul → "Inconnu #N" si rien', () => {
    const raw = { id: 99 };
    const c = adapter._normalizeContact(raw);
    expect(c.name).toBe('Contact #99');
  });

  test('_normalizeContact : récupère phone_pro OU phone_mobile OU phone_perso', () => {
    expect(adapter._normalizeContact({ id: 1, lastname: 'A', phone_pro: '01' }).phone).toBe('01');
    expect(adapter._normalizeContact({ id: 1, lastname: 'A', phone_mobile: '02' }).phone).toBe('02');
    expect(adapter._normalizeContact({ id: 1, lastname: 'A', phone_perso: '03' }).phone).toBe('03');
    expect(adapter._normalizeContact({ id: 1, lastname: 'A' }).phone).toBeNull();
  });

  test('_normalizeThirdparty : isCompany=true, pas de companyId', () => {
    const raw = { id: 5, name: 'Acme Corp', phone: '0102030405' };
    const t = adapter._normalizeThirdparty(raw);
    expect(t.isCompany).toBe(true);
    expect(t.name).toBe('Acme Corp');
    expect(t.phone).toBe('0102030405');
    expect(t.companyId).toBeNull();
    expect(t.company).toBeNull();
  });

  test('cache téléphone : set / get / expire', () => {
    const phone = '0612345678';
    const contact = { id: 1, name: 'Test' };
    expect(adapter._cacheGet(phone)).toBeNull();
    adapter._cacheSet(phone, contact);
    expect(adapter._cacheGet(phone)).toEqual(contact);
    expect(adapter.cacheSize).toBe(1);
    adapter.invalidateCache(phone);
    expect(adapter.cacheSize).toBe(0);
  });

  test('invalidateCache() sans paramètre vide tout', () => {
    adapter._cacheSet('0612345678', { id: 1 });
    adapter._cacheSet('0698765432', { id: 2 });
    expect(adapter.cacheSize).toBe(2);
    adapter.invalidateCache();
    expect(adapter.cacheSize).toBe(0);
  });

  test('isAuthenticated() retourne false avant authenticate()', () => {
    // Réinitialiser un adapter vierge pour ce test
    const a = new DolibarrAdapter();
    expect(a.isAuthenticated()).toBe(false);
  });

  test('logCallActivity ne lève pas si axios échoue (log warn, pas throw)', async () => {
    // Force _req à throw — logCallActivity doit swallow l'erreur
    jest.spyOn(adapter, '_req').mockRejectedValue(new Error('Network error'));
    // Pas d'await throw → log warn silencieux
    await expect(adapter.logCallActivity(1, { direction: 'inbound', status: 'answered', duration: 30 }))
      .resolves.toBeUndefined();
    jest.restoreAllMocks();
  });
});

describe('CrmClientInterface — contrat respecté par les adaptateurs', () => {
  let OdooAdapter;
  let DolibarrAdapter;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/config', () => ({
      odoo: { url: 'http://odoo.test', db: 'test', username: 'u', apiKey: 'k' },
      dolibarr: { url: 'http://dolibarr.test', apiKey: 'k', userId: 1, entityId: null, cacheContactTtl: 300 },
    }));
    OdooAdapter = require('../src/infrastructure/crm/adapters/OdooAdapter');
    DolibarrAdapter = require('../src/infrastructure/crm/adapters/DolibarrAdapter');
  });

  test('OdooAdapter expose toutes les méthodes du contrat', () => {
    const a = new OdooAdapter();
    const methods = [
      'authenticate', 'ensureAuthenticated', 'isAuthenticated',
      'findContactByPhone', 'searchContacts', 'getContactById', 'getContactFull',
      'createContact', 'updateContact',
      'logCallActivity', 'getContactMessages', 'addContactNote',
      'invalidateCache', 'getAllContactsWithPhone',
    ];
    for (const m of methods) {
      expect(typeof a[m]).toBe('function');
    }
  });

  test('DolibarrAdapter expose toutes les méthodes du contrat', () => {
    const a = new DolibarrAdapter();
    const methods = [
      'authenticate', 'ensureAuthenticated', 'isAuthenticated',
      'findContactByPhone', 'searchContacts', 'getContactById', 'getContactFull',
      'createContact', 'updateContact',
      'logCallActivity', 'getContactMessages', 'addContactNote',
      'invalidateCache', 'getAllContactsWithPhone',
    ];
    for (const m of methods) {
      expect(typeof a[m]).toBe('function');
    }
  });
});