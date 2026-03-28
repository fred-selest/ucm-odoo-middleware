'use strict';

const SireneService = require('../src/infrastructure/lookup/SireneService');
const GooglePlacesService = require('../src/infrastructure/lookup/GooglePlacesService');
const SpamScoreService = require('../src/infrastructure/lookup/SpamScoreService');

// Mock config
jest.mock('../src/config', () => ({
  sirene: { apiKey: 'test-api-key' },
  google: { placesApiKey: 'test-google-key' },
}));

describe('SireneService', () => {
  let service;

  beforeEach(() => {
    service = new SireneService();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    test('doit être configuré avec une clé API', () => {
      expect(service.isConfigured).toBe(true);
    });
  });

  describe('Recherche par SIREN', () => {
    test('doit valider le format SIREN (9 chiffres)', async () => {
      await expect(service.searchBySiren('123')).rejects.toThrow('SIREN invalide');
      await expect(service.searchBySiren('1234567890')).rejects.toThrow('SIREN invalide');
    });

    test('doit rechercher par SIREN avec cache', async () => {
      const mockResponse = {
        uniteLegale: {
          siren: '123456789',
          denominationUniteLegale: 'TEST SARL',
          sigleUniteLegale: 'TEST',
          categorieJuridiqueUniteLegale: '5498',
          categorieEntreprise: 'PME',
          dateCreationUniteLegale: '20200101',
          periodesUniteLegale: [{
            etatAdministratifUniteLegale: 'A',
            denominationUniteLegale: 'TEST SARL',
            activitePrincipaleUniteLegale: '6201Z',
            nomenclatureActivitePrincipaleUniteLegale: 'NAFRev2',
          }],
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.searchBySiren('123456789');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.insee.fr/api-sirene/3.11/siren/123456789'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-INSEE-Api-Key-Integration': 'test-api-key',
          }),
        })
      );

      expect(result).toMatchObject({
        siren: '123456789',
        denomination: 'TEST SARL',
        sigle: 'TEST',
        actif: true,
        source: 'sirene_insee',
      });

      // Test du cache
      global.fetch.mockClear();
      await service.searchBySiren('123456789');
      expect(fetch).not.toHaveBeenCalled();
    });

    test('doit retourner null pour un SIREN inexistant (404)', async () => {
      global.fetch.mockResolvedValue({
        status: 404,
        ok: false,
      });

      const result = await service.searchBySiren('000000000');
      expect(result).toBeNull();
    });

    test('doit gérer les erreurs 429 (quota dépassé)', async () => {
      global.fetch.mockResolvedValue({
        status: 429,
        ok: false,
      });

      await expect(service.searchBySiren('123456789'))
        .rejects.toThrow('Quota API SIRENE dépassé');
    });
  });

  describe('Recherche par SIRET', () => {
    test('doit valider le format SIRET (14 chiffres)', async () => {
      await expect(service.searchBySiret('123')).rejects.toThrow('SIRET invalide');
      await expect(service.searchBySiret('123456789012345')).rejects.toThrow('SIRET invalide');
    });

    test('doit rechercher par SIRET', async () => {
      const mockResponse = {
        etablissement: {
          siren: '123456789',
          siret: '12345678901234',
          etablissementSiege: true,
          dateCreationEtablissement: '20200101',
          adresseEtablissement: {
            numeroVoieEtablissement: '10',
            typeVoieEtablissement: 'RUE',
            libelleVoieEtablissement: 'DE LA PAIX',
            codePostalEtablissement: '75002',
            libelleCommuneEtablissement: 'PARIS',
          },
          periodesEtablissement: [{
            etatAdministratifEtablissement: 'A',
            activitePrincipaleEtablissement: '6201Z',
            nomenclatureActivitePrincipaleEtablissement: 'NAFRev2',
          }],
          uniteLegale: {
            denominationUniteLegale: 'TEST SARL',
            categorieJuridiqueUniteLegale: '5498',
          },
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.searchBySiret('12345678901234');

      expect(result).toMatchObject({
        siret: '12345678901234',
        denomination: 'TEST SARL',
        siege: true,
        actif: true,
        adresse: expect.objectContaining({
          codePostal: '75002',
          commune: 'PARIS',
        }),
        source: 'sirene_insee',
      });
    });
  });

  describe('Recherche par nom', () => {
    test('doit valider la longueur du nom', async () => {
      await expect(service.searchByName('A')).rejects.toThrow('Nom trop court');
    });

    test('doit rechercher par nom d\'entreprise', async () => {
      const mockResponse = {
        etablissements: [{
          siren: '123456789',
          siret: '12345678901234',
          etablissementSiege: true,
          adresseEtablissement: {},
          periodesEtablissement: [{
            etatAdministratifEtablissement: 'A',
          }],
          uniteLegale: {
            denominationUniteLegale: 'TEST SARL',
          },
        }],
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.searchByName('TEST', 5);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('api.insee.fr/api-sirene/3.11/siret'),
        expect.anything()
      );
      expect(result).toHaveLength(1);
      expect(result[0].denomination).toBe('TEST SARL');
    });
  });

  describe('Cache', () => {
    test('doit limiter la taille du cache à 500 entrées', () => {
      service._maxCacheSize = 3;

      service._addToCache('key1', { data: 1 });
      service._addToCache('key2', { data: 2 });
      service._addToCache('key3', { data: 3 });
      service._addToCache('key4', { data: 4 });

      expect(service._cache.size).toBe(3);
      expect(service._cache.has('key1')).toBe(false);
      expect(service._cache.has('key4')).toBe(true);
    });

    test('doit expirer les entrées après TTL', async () => {
      service._cacheTtl = 100; // 100ms pour le test

      service._addToCache('test', { value: 'test' });
      expect(service._getFromCache('test')).toEqual({ value: 'test' });

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(service._getFromCache('test')).toBeNull();
    });
  });
});

describe('GooglePlacesService', () => {
  let service;

  beforeEach(() => {
    service = new GooglePlacesService();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    test('doit être configuré avec une clé API', () => {
      expect(service.isConfigured).toBe(true);
    });
  });

  describe('Recherche de lieu', () => {
    test('doit valider la longueur du nom', async () => {
      await expect(service.search('A')).rejects.toThrow('Nom trop court');
    });

    test('doit rechercher un lieu avec city', async () => {
      const mockResponse = {
        places: [{
          displayName: { text: 'Restaurant Le Test' },
          formattedAddress: '10 Rue de la Paix, 75002 Paris, France',
          nationalPhoneNumber: '01 23 45 67 89',
          internationalPhoneNumber: '+33 1 23 45 67 89',
          websiteUri: 'https://www.example.com?utm_source=google',
          types: ['restaurant', 'food'],
          rating: 4.5,
          userRatingCount: 120,
        }],
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await service.search('Restaurant Test', 'Paris');

      expect(fetch).toHaveBeenCalledWith(
        'https://places.googleapis.com/v1/places:searchText',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Goog-Api-Key': 'test-google-key',
          }),
        })
      );

      expect(result).toMatchObject({
        name: 'Restaurant Le Test',
        phone: '01 23 45 67 89',
        phoneIntl: '+33 1 23 45 67 89',
        website: expect.stringContaining('example.com'),
        address: '10 Rue de la Paix, 75002 Paris, France',
        types: ['restaurant', 'food'],
        rating: 4.5,
        userRatingsTotal: 120,
        source: 'google_places',
      });
    });

    test('doit retourner null si aucun résultat', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ places: [] }),
      });

      const result = await service.search('Lieu Inexistant');
      expect(result).toBeNull();
    });

    test('doit gérer les erreurs HTTP', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('API_KEY_INVALID'),
      });

      await expect(service.search('Test'))
        .rejects.toThrow('Google Places HTTP 403');
    });
  });

  describe('Nettoyage URL', () => {
    test('doit supprimer les paramètres UTM', () => {
      const url = 'https://example.com/page?utm_source=google&utm_medium=cpc';
      const clean = GooglePlacesService._cleanUrl(url);
      expect(clean).toBe('https://example.com/page');
    });

    test('doit supprimer fbclid et gclid', () => {
      const url = 'https://example.com/page?fbclid=123&gclid=456';
      const clean = GooglePlacesService._cleanUrl(url);
      expect(clean).toBe('https://example.com/page');
    });

    test('doit gérer les URL invalides', () => {
      const url = 'not-a-valid-url';
      const clean = GooglePlacesService._cleanUrl(url);
      expect(clean).toBe('not-a-valid-url');
    });
  });
});

describe('SpamScoreService', () => {
  let service;

  beforeEach(() => {
    service = new SpamScoreService(7); // Seuil de blocage à 7
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Vérification spam', () => {
    test('doit retourner null pour un numéro trop court', async () => {
      const result = await service.check('123');
      expect(result).toBeNull();
    });

    test('doit vérifier le score spam avec Tellows', async () => {
      const tellowsResponse = {
        tellows: {
          score: '8',
          searches: '150',
          comments: '25',
          location: 'Paris',
          country: 'FR',
          callerTypes: {
            caller: [{ name: 'Démarchage téléphonique' }],
          },
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(tellowsResponse)),
      });

      const result = await service.check('+33123456789');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('tellows.de/basic/num/%2B33123456789'),
        expect.anything()
      );

      expect(result).toMatchObject({
        score: 8,
        searches: 150,
        comments: 25,
        location: 'Paris',
        country: 'FR',
        callerType: 'Démarchage téléphonique',
        isSpam: true, // score >= 7
        source: 'tellows',
      });
    });

    test('doit marquer comme non-spam si score < seuil', async () => {
      const tellowsResponse = {
        tellows: {
          score: '3',
          searches: '10',
          comments: '2',
          callerTypes: { caller: [] },
        },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(tellowsResponse)),
      });

      const result = await service.check('+33123456789');

      expect(result.isSpam).toBe(false);
    });

    test('doit retourner null en cas d\'erreur', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await service.check('+33123456789');
      expect(result).toBeNull();
    });

    test('doit gérer le timeout', async () => {
      global.fetch.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 10000);
        });
      });

      const result = await service.check('+33123456789');
      expect(result).toBeNull();
    });
  });

  describe('Cache', () => {
    test('doit mettre en cache les résultats', async () => {
      const tellowsResponse = {
        tellows: { score: '5', searches: '10', comments: '1', callerTypes: { caller: [] } },
      };

      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(tellowsResponse)),
      });

      await service.check('+33123456789');
      global.fetch.mockClear();

      // Deuxième appel, doit utiliser le cache
      await service.check('+33123456789');
      expect(fetch).not.toHaveBeenCalled();
    });

    test('doit limiter la taille du cache à 1000', () => {
      service._maxCacheSize = 3;

      service._addToCache('key1', {});
      service._addToCache('key2', {});
      service._addToCache('key3', {});
      service._addToCache('key4', {});

      expect(service._cache.size).toBe(3);
      expect(service._cache.has('key1')).toBe(false);
    });
  });
});
