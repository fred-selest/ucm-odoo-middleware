'use strict';

const config = require('../../config');
const logger = require('../../logger');

/**
 * Service de recherche via Google Places API (New).
 *
 * Complète l'enrichissement SIRENE/Annuaire avec les données que
 * les sources publiques françaises ne fournissent pas : téléphone,
 * site web, horaires d'ouverture, note Google.
 *
 * Endpoint : POST https://places.googleapis.com/v1/places:searchText
 * Coût : ~0.017$/req (200$/mois de crédit gratuit Google).
 */
class GooglePlacesService {
  constructor() {
    this._baseUrl = 'https://places.googleapis.com/v1/places:searchText';
    this._cache = new Map();
    this._maxCacheSize = 500;
    this._cacheTtl = 86400000; // 24h (données stables)
  }

  get isConfigured() {
    return !!config.google?.placesApiKey;
  }

  /**
   * Recherche une entreprise par nom (+ ville optionnelle pour précision).
   * @param {string} name - Nom de l'entreprise
   * @param {string} [city] - Ville pour affiner la recherche
   * @returns {{ phone, phoneIntl, website, address, name, types, rating, userRatingsTotal } | null}
   */
  async search(name, city) {
    if (!this.isConfigured) throw new Error('Clé API Google Places non configurée');
    if (!name || name.trim().length < 2) throw new Error('Nom trop court');

    const query = city ? `${name.trim()} ${city.trim()}` : name.trim();
    const cacheKey = `places:${query.toLowerCase()}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const fieldMask = [
      'places.displayName',
      'places.formattedAddress',
      'places.nationalPhoneNumber',
      'places.internationalPhoneNumber',
      'places.websiteUri',
      'places.types',
      'places.rating',
      'places.userRatingCount',
    ].join(',');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(this._baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': config.google.placesApiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify({
          textQuery: query,
          languageCode: 'fr',
          maxResultCount: 1,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Google Places HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = await res.json();
      const place = data.places?.[0];
      if (!place) return null;

      const result = {
        phone: place.nationalPhoneNumber || null,
        phoneIntl: place.internationalPhoneNumber || null,
        website: GooglePlacesService._cleanUrl(place.websiteUri),
        address: place.formattedAddress || null,
        name: place.displayName?.text || null,
        types: place.types || [],
        rating: place.rating || null,
        userRatingsTotal: place.userRatingCount || null,
        source: 'google_places',
      };

      this._addToCache(cacheKey, result);
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Nettoie une URL : supprime les paramètres UTM et tracking.
   */
  static _cleanUrl(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      const toRemove = [...u.searchParams.keys()].filter(k =>
        k.startsWith('utm_') || k.startsWith('fbclid') || k.startsWith('gclid')
      );
      for (const k of toRemove) u.searchParams.delete(k);
      // Si plus aucun paramètre, retirer le '?' résiduel
      let clean = u.toString();
      if (clean.endsWith('?')) clean = clean.slice(0, -1);
      return clean;
    } catch {
      return url;
    }
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

module.exports = GooglePlacesService;
