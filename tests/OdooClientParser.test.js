'use strict';

jest.mock('axios');
const OdooClient = require('../src/infrastructure/odoo/OdooClient');

describe('OdooClient._parseXml — parser XML-RPC manuel', () => {
  let client;
  beforeEach(() => {
    client = new OdooClient();
    client._uid = 2;
  });

  describe('types primitifs', () => {
    test('parse un entier', () => {
      const xml = '<?xml version="1.0"?><methodResponse><params><param><value><int>42</int></value></param></params></methodResponse>';
      expect(client._parseXml(xml)).toBe(42);
    });

    test('parse <i4> comme un entier (alias XML-RPC)', () => {
      const xml = '<?xml version="1.0"?><methodResponse><params><param><value><i4>123</i4></value></param></params></methodResponse>';
      expect(client._parseXml(xml)).toBe(123);
    });

    test('parse un double', () => {
      const xml = '<?xml version="1.0"?><methodResponse><params><param><value><double>3.14</double></value></param></params></methodResponse>';
      expect(client._parseXml(xml)).toBeCloseTo(3.14);
    });

    test('parse un booléen true', () => {
      const xml = '<?xml version="1.0"?><methodResponse><params><param><value><boolean>1</boolean></value></param></params></methodResponse>';
      expect(client._parseXml(xml)).toBe(true);
    });

    test('parse un booléen false', () => {
      const xml = '<?xml version="1.0"?><methodResponse><params><param><value><boolean>0</boolean></value></param></params></methodResponse>';
      expect(client._parseXml(xml)).toBe(false);
    });

    test('parse une chaîne avec caractères spéciaux (&, <, >, ")', () => {
      const xml = '<?xml version="1.0"?><methodResponse><params><param><value><string>Hello &amp; &lt;world&gt; &quot;quoted&quot;</string></value></param></params></methodResponse>';
      expect(client._parseXml(xml)).toBe('Hello & <world> "quoted"');
    });

    test('parse un nil (null)', () => {
      const xml = '<?xml version="1.0"?><methodResponse><params><param><value><nil/></value></param></params></methodResponse>';
      expect(client._parseXml(xml)).toBeNull();
    });
  });

  describe('structures', () => {
    test('parse un struct (objet clé/valeur)', () => {
      const xml = '<?xml version="1.0"?><methodResponse><params><param><value><struct>'
        + '<member><name>uid</name><value><int>7</int></value></member>'
        + '<member><name>name</name><value><string>admin</string></value></member>'
        + '</struct></value></param></params></methodResponse>';
      expect(client._parseXml(xml)).toEqual({ uid: 7, name: 'admin' });
    });

    test('parse un array de valeurs mixtes', () => {
      const xml = '<?xml version="1.0"?><methodResponse><params><param><value><array><data>'
        + '<value><int>1</int></value>'
        + '<value><string>deux</string></value>'
        + '<value><boolean>1</boolean></value>'
        + '</data></array></value></param></params></methodResponse>';
      expect(client._parseXml(xml)).toEqual([1, 'deux', true]);
    });

    test('parse un struct imbriqué', () => {
      const xml = '<?xml version="1.0"?><methodResponse><params><param><value><struct>'
        + '<member><name>outer</name><value><struct>'
        + '<member><name>inner</name><value><int>99</int></value></member>'
        + '</struct></value></member>'
        + '</struct></value></param></params></methodResponse>';
      expect(client._parseXml(xml)).toEqual({ outer: { inner: 99 } });
    });
  });

  describe('erreurs', () => {
    test('lève une exception sur fault', () => {
      const xml = '<?xml version="1.0"?><methodResponse><fault><value><struct>'
        + '<member><name>faultCode</name><value><int>1</int></value></member>'
        + '<member><name>faultString</name><value><string>Access Denied</string></value></member>'
        + '</struct></value></fault></methodResponse>';
      expect(() => client._parseXml(xml)).toThrow(/Access Denied/);
    });

    test('lève une exception sur réponse sans <param>', () => {
      const xml = '<?xml version="1.0"?><methodResponse></methodResponse>';
      expect(() => client._parseXml(xml)).toThrow(/réponse invalide/);
    });
  });
});

describe('OdooClient._normalizePhone — normalisation française', () => {
  let client;
  beforeEach(() => { client = new OdooClient(); });

  test('format national 0X XX XX XX XX → reste tel quel', () => {
    expect(client._normalizePhone('0612345678')).toBe('0612345678');
    expect(client._normalizePhone('06 12 34 56 78')).toBe('0612345678');
    expect(client._normalizePhone('06.12.34.56.78')).toBe('0612345678');
  });

  test('format international +33X... → 0X...', () => {
    expect(client._normalizePhone('+33612345678')).toBe('0612345678');
    expect(client._normalizePhone('+33 6 12 34 56 78')).toBe('0612345678');
  });

  test('format 0033X... → 0X...', () => {
    expect(client._normalizePhone('0033612345678')).toBe('0612345678');
  });

  test('chiffres uniquement après nettoyage', () => {
    expect(client._normalizePhone('(0) 6-12-34-56-78')).toBe('0612345678');
  });
});

describe('OdooClient._phoneVariants — variantes pour recherche', () => {
  let client;
  beforeEach(() => { client = new OdooClient(); });

  test('numéro national : produit national + international + espaces + points', () => {
    const variants = client._phoneVariants('0612345678');
    expect(variants).toContain('0612345678');           // national
    expect(variants).toContain('+33612345678');          // international
    expect(variants).toContain('0033612345678');        // 0033
    expect(variants).toContain('06 12 34 56 78');        // espaces national
    expect(variants).toContain('06.12.34.56.78');        // points national
    expect(variants).toContain('+33 6 12 34 56 78');     // espaces international
  });

  test('numéro international : produit national + 0033 + espaces', () => {
    const variants = client._phoneVariants('+33612345678');
    expect(variants).toContain('0612345678');
    expect(variants).toContain('0033612345678');
  });

  test('numéro court (8 chiffres) : ajoute suffixe comme variante de fallback', () => {
    const variants = client._phoneVariants('12345678');
    expect(variants).toContain('12345678');
  });

  test('pas de doublons dans la liste de variantes', () => {
    const variants = client._phoneVariants('0612345678');
    const unique = [...new Set(variants)];
    expect(variants.length).toBe(unique.length);
  });
});