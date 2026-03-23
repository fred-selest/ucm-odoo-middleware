// src/infrastructure/lookup/FrenchLookupService.js

class FrenchLookupService {
  constructor() {
    this.cache = new Map(); // Cache mémoire temporaire (pas persistant)
    this.maxCacheSize = 1000; // Limite pour éviter la fuite mémoire
  }

  async lookup(phone) {
    const normalized = this._normalizePhone(phone);
    if (!normalized || normalized.length < 10) return null;

    // Vérifier cache mémoire (temporaire seulement)
    if (this.cache.has(normalized)) {
      return this.cache.get(normalized);
    }

    // Essayer SIRENE API publique (gratuite)
    const sireneContact = await this._lookupSirene(normalized);
    if (sireneContact) {
      this._addToCache(normalized, sireneContact);
      return sireneContact;
    }

    // Essayer Pages Jaunes (annuaire inversé public)
    const pjContact = await this._lookupPagesJaunes(normalized);
    if (pjContact) {
      this._addToCache(normalized, pjContact);
      return pjContact;
    }

    return null; // Numéro vraiment inconnu
  }

  _addToCache(phone, contact) {
    // Nettoyer cache si trop grand
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(phone, contact);
  }

  _normalizePhone(phone) {
    if (!phone) return '';
    let normalized = phone.replace(/[^0-9]/g, '');
    if (normalized.startsWith('+33')) {
      normalized = '0' + normalized.substring(3);
    } else if (normalized.startsWith('33') && normalized.length === 11) {
      normalized = '0' + normalized.substring(2);
    }
    return normalized;
  }

  // Utilise l'API publique SIRENE (gratuite, pas de téléchargement)
  async _lookupSirene(phone) {
    try {
      // API publique INSEE (gratuite, limitée mais suffisante)
      const response = await fetch(
        `https://entreprise.data.gouv.fr/api/sirene/v3/etablissements/search?telephone=${phone}`,
        { timeout: 5000 }
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data.etablissements && data.etablissements.length > 0) {
          const etablissement = data.etablissements[0];
          return {
            name: etablissement.unite_legale?.denomination || 
                   `${etablissement.unite_legale?.prenom_usuel} ${etablissement.unite_legale?.nom}`,
            phone: phone,
            company: !!etablissement.unite_legale?.denomination,
            address: etablissement.adresse,
            activity: etablissement.activite_principale_libelle,
            source: 'sirene_api'
          };
        }
      }
    } catch (error) {
      // Pas grave, on passe à l'alternative
    }
    return null;
  }

  async _lookupPagesJaunes(phone) {
    try {
      // Accès direct à l'annuaire inversé (gratuit, public)
      const response = await fetch(
        `https://api.pagesjaunes.fr/v1/prospection/recherche-inverse?numero=${phone}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (UCM-Odoo-Middleware)'
          },
          timeout: 5000
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data.listings && data.listings.length > 0) {
          const listing = data.listings[0];
          return {
            name: listing.name,
            phone: phone,
            company: listing.isPro,
            address: listing.address?.fullAddress,
            source: 'pages_jaunes'
          };
        }
      }
    } catch (error) {
      // Ignore errors, return null
    }
    return null;
  }
}

module.exports = FrenchLookupService;