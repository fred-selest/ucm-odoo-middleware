'use strict';

const config = require('../../config');
const logger = require('../../logger');

/**
 * Service d'enrichissement de fiches clients via l'API SIRENE INSEE v3.11.
 *
 * Recherche par nom d'entreprise ou SIREN/SIRET → retourne dénomination,
 * adresse, activité, forme juridique, catégorie.
 *
 * Pas de recherche par téléphone (champ retiré par l'INSEE, RGPD).
 */
class SireneService {
  constructor() {
    this._baseUrl = 'https://api.insee.fr/api-sirene/3.11';
    this._cache = new Map();
    this._maxCacheSize = 500;
    this._cacheTtl = 3600000; // 1h
  }

  get isConfigured() {
    return !!config.sirene?.apiKey;
  }

  // ── Recherche par nom d'entreprise ─────────────────────────────────────────

  async searchByName(name, limit = 5) {
    if (!this.isConfigured) throw new Error('Clé API SIRENE non configurée');
    if (!name || name.trim().length < 2) throw new Error('Nom trop court (min 2 car.)');

    const q = `denominationUniteLegale:"${name.trim()}" AND etatAdministratifUniteLegale:A`;
    return this._searchEtablissements(q, limit);
  }

  // ── Recherche par SIREN (9 chiffres) ───────────────────────────────────────

  async searchBySiren(siren) {
    if (!this.isConfigured) throw new Error('Clé API SIRENE non configurée');
    const cleaned = siren.replace(/\s/g, '');
    if (!/^\d{9}$/.test(cleaned)) throw new Error('SIREN invalide (9 chiffres attendus)');

    const cacheKey = `siren:${cleaned}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const url = `${this._baseUrl}/siren/${cleaned}`;
    const data = await this._fetch(url);
    if (!data?.uniteLegale) return null;

    const result = this._formatUniteLegale(data.uniteLegale);
    this._addToCache(cacheKey, result);
    return result;
  }

  // ── Recherche par SIRET (14 chiffres) ──────────────────────────────────────

  async searchBySiret(siret) {
    if (!this.isConfigured) throw new Error('Clé API SIRENE non configurée');
    const cleaned = siret.replace(/\s/g, '');
    if (!/^\d{14}$/.test(cleaned)) throw new Error('SIRET invalide (14 chiffres attendus)');

    const cacheKey = `siret:${cleaned}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const url = `${this._baseUrl}/siret/${cleaned}`;
    const data = await this._fetch(url);
    if (!data?.etablissement) return null;

    const result = this._formatEtablissement(data.etablissement);
    this._addToCache(cacheKey, result);
    return result;
  }

  // ── Privé ──────────────────────────────────────────────────────────────────

  async _searchEtablissements(q, limit) {
    const params = new URLSearchParams({
      q,
      nombre: String(limit),
      tri: 'denominationUniteLegale',
    });
    const url = `${this._baseUrl}/siret?${params}`;
    const data = await this._fetch(url);

    if (!data?.etablissements) return [];
    return data.etablissements.map(e => this._formatEtablissement(e));
  }

  async _fetch(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(url, {
        headers: { 'X-INSEE-Api-Key-Integration': config.sirene.apiKey },
        signal: controller.signal,
      });

      if (res.status === 404) return null;
      if (res.status === 429) {
        logger.warn('SIRENE: quota dépassé (429)');
        throw new Error('Quota API SIRENE dépassé, réessayez plus tard');
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`SIRENE HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  _formatEtablissement(etab) {
    const ul = etab.uniteLegale || {};
    const addr = etab.adresseEtablissement || {};
    const periode = etab.periodesEtablissement?.[0] || {};

    return {
      siren: etab.siren,
      siret: etab.siret,
      denomination: ul.denominationUniteLegale || null,
      enseigne: periode.enseigne1Etablissement || null,
      siege: !!etab.etablissementSiege,
      actif: periode.etatAdministratifEtablissement === 'A',
      dateCreation: etab.dateCreationEtablissement || null,
      activite: {
        code: periode.activitePrincipaleEtablissement || null,
        nomenclature: periode.nomenclatureActivitePrincipaleEtablissement || null,
      },
      categorieJuridique: ul.categorieJuridiqueUniteLegale || null,
      categorieEntreprise: ul.categorieEntreprise || null,
      adresse: {
        numero: addr.numeroVoieEtablissement || '',
        type: addr.typeVoieEtablissement || '',
        voie: addr.libelleVoieEtablissement || '',
        complement: addr.complementAdresseEtablissement || '',
        codePostal: addr.codePostalEtablissement || '',
        commune: addr.libelleCommuneEtablissement || '',
      },
      adresseFormatee: this._formatAdresse(addr),
      source: 'sirene_insee',
    };
  }

  _formatUniteLegale(ul) {
    const periode = ul.periodesUniteLegale?.[0] || {};
    return {
      siren: ul.siren,
      denomination: periode.denominationUniteLegale || ul.denominationUniteLegale || null,
      sigle: ul.sigleUniteLegale || null,
      actif: periode.etatAdministratifUniteLegale === 'A',
      dateCreation: ul.dateCreationUniteLegale || null,
      activite: {
        code: periode.activitePrincipaleUniteLegale || null,
        nomenclature: periode.nomenclatureActivitePrincipaleUniteLegale || null,
      },
      categorieJuridique: periode.categorieJuridiqueUniteLegale || null,
      categorieEntreprise: ul.categorieEntreprise || null,
      nicSiege: periode.nicSiegeUniteLegale || null,
      siretSiege: ul.siren && periode.nicSiegeUniteLegale
        ? ul.siren + periode.nicSiegeUniteLegale : null,
      source: 'sirene_insee',
    };
  }

  _formatAdresse(addr) {
    const parts = [
      addr.numeroVoieEtablissement,
      addr.typeVoieEtablissement,
      addr.libelleVoieEtablissement,
    ].filter(Boolean).join(' ');

    const ville = [
      addr.codePostalEtablissement,
      addr.libelleCommuneEtablissement,
    ].filter(Boolean).join(' ');

    return [parts, ville].filter(Boolean).join(', ');
  }

  // ── Cache ──────────────────────────────────────────────────────────────────

  _getFromCache(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._cache.delete(key);
      return null;
    }
    return entry.data;
  }

  _addToCache(key, data) {
    if (this._cache.size >= this._maxCacheSize) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    this._cache.set(key, { data, expiresAt: Date.now() + this._cacheTtl });
  }
}

module.exports = SireneService;
