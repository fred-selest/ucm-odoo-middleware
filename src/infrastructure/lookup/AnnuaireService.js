'use strict';

const logger = require('../../logger');

/**
 * Service d'enrichissement via l'API Annuaire Entreprises (data.gouv.fr).
 *
 * Gratuit, sans clé API, agrège SIRENE + RNE + autres sources.
 * Données plus riches que SIRENE seul : dirigeants, effectif, GPS,
 * conventions collectives, nom commercial, enseignes.
 *
 * Résout le problème des entreprises individuelles introuvables dans
 * SIRENE par nom (ex: FOIE GRAS DU VIGNOBLE → dénomination légale CONRAD).
 */
class AnnuaireService {
  constructor() {
    this._baseUrl = 'https://recherche-entreprises.api.gouv.fr';
    this._cache = new Map();
    this._maxCacheSize = 500;
    this._cacheTtl = 3600000; // 1h
  }

  get isConfigured() {
    return true; // Pas de clé API requise
  }

  // ── Recherche par nom ─────────────────────────────────────────────────────

  async searchByName(name, limit = 5) {
    if (!name || name.trim().length < 2) throw new Error('Nom trop court (min 2 car.)');

    const cacheKey = `name:${name.trim().toLowerCase()}:${limit}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      q: name.trim(),
      page: '1',
      per_page: String(limit),
    });

    const data = await this._fetch(`${this._baseUrl}/search?${params}`);
    if (!data?.results) return [];

    const results = data.results.map(r => this._formatResult(r));
    this._addToCache(cacheKey, results);
    return results;
  }

  // ── Recherche par SIREN (9 chiffres) ──────────────────────────────────────

  async searchBySiren(siren) {
    const cleaned = siren.replace(/\s/g, '');
    if (!/^\d{9}$/.test(cleaned)) throw new Error('SIREN invalide (9 chiffres attendus)');

    const cacheKey = `siren:${cleaned}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({ q: cleaned, page: '1', per_page: '1' });
    const data = await this._fetch(`${this._baseUrl}/search?${params}`);
    if (!data?.results?.length) return null;

    const result = this._formatResult(data.results[0]);
    this._addToCache(cacheKey, result);
    return result;
  }

  // ── Recherche par SIRET (14 chiffres) ─────────────────────────────────────

  async searchBySiret(siret) {
    const cleaned = siret.replace(/\s/g, '');
    if (!/^\d{14}$/.test(cleaned)) throw new Error('SIRET invalide (14 chiffres attendus)');

    const siren = cleaned.slice(0, 9);
    const cacheKey = `siret:${cleaned}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({ q: siren, page: '1', per_page: '1' });
    const data = await this._fetch(`${this._baseUrl}/search?${params}`);
    if (!data?.results?.length) return null;

    const result = this._formatResult(data.results[0], cleaned);
    this._addToCache(cacheKey, result);
    return result;
  }

  // ── Privé ──────────────────────────────────────────────────────────────────

  async _fetch(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (res.status === 404) return null;
      if (res.status === 429) {
        logger.warn('Annuaire Entreprises: rate limit (429)');
        throw new Error('Rate limit Annuaire Entreprises, réessayez plus tard');
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Annuaire HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  _formatResult(r, targetSiret) {
    const siege = r.siege || {};
    // Si un SIRET spécifique est demandé, chercher l'établissement correspondant
    const etab = targetSiret && r.matching_etablissements
      ? r.matching_etablissements.find(e => e.siret === targetSiret) || siege
      : siege;

    const dirigeants = (r.dirigeants || []).map(d => ({
      nom: [d.prenoms, d.nom].filter(Boolean).join(' '),
      qualite: d.qualite || null,
    }));

    return {
      siren: r.siren,
      siret: etab.siret || siege.siret,
      denomination: r.nom_raison_sociale || r.nom_complet || null,
      nomCommercial: siege.nom_commercial || null,
      enseignes: siege.liste_enseignes || [],
      siege: etab === siege,
      actif: siege.etat_administratif === 'A',
      dateCreation: siege.date_creation || null,
      activite: {
        code: r.activite_principale || null,
        label: r.libelle_activite_principale || null,
      },
      categorieEntreprise: r.categorie_entreprise || null,
      effectif: siege.tranche_effectif_salarie || null,
      anneeEffectif: siege.annee_tranche_effectif_salarie || null,
      dirigeants,
      conventionsCollectives: siege.liste_idcc || [],
      adresse: {
        numero: siege.numero_voie || '',
        type: siege.type_voie || '',
        voie: siege.libelle_voie || '',
        complement: siege.complement_adresse || '',
        codePostal: siege.code_postal || '',
        commune: siege.libelle_commune || '',
      },
      adresseFormatee: siege.adresse || siege.geo_adresse || '',
      coordonnees: siege.latitude && siege.longitude
        ? { lat: parseFloat(siege.latitude), lon: parseFloat(siege.longitude) }
        : null,
      source: 'annuaire_entreprises',
    };
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

module.exports = AnnuaireService;
