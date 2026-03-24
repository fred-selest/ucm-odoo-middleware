'use strict';

const logger = require('../../logger');

/**
 * Service de vérification du score spam via Tellows (gratuit).
 *
 * Interroge https://www.tellows.de/basic/num/{phone}?json=1
 * Score : 1 (fiable) → 9 (spam confirmé).
 * Seuil de blocage configurable (défaut: 7).
 */
class SpamScoreService {
  constructor(blockThreshold = 7) {
    this._baseUrl = 'https://www.tellows.de/basic/num';
    this._blockThreshold = blockThreshold;
    this._cache = new Map();
    this._maxCacheSize = 1000;
    this._cacheTtl = 3600000; // 1h (les scores évoluent)
  }

  /**
   * Vérifie le score spam d'un numéro.
   * @param {string} phoneNumber - Numéro au format international (+33...) ou national (0...)
   * @returns {{ score, searches, comments, location, country, callerType, isSpam } | null}
   */
  async check(phoneNumber) {
    if (!phoneNumber || phoneNumber.length < 6) return null;

    const cacheKey = `spam:${phoneNumber}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const url = `${this._baseUrl}/${encodeURIComponent(phoneNumber)}?json=1`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;

      const text = await res.text();
      // Tellows appends "Partner Data not correct" after JSON
      const jsonStr = text.replace(/}[^}]*$/, '}');
      const data = JSON.parse(jsonStr);
      const t = data.tellows;
      if (!t) return null;

      const score = parseInt(t.score, 10) || 0;
      const callerTypes = t.callerTypes?.caller || [];
      const result = {
        score,
        searches: parseInt(t.searches, 10) || 0,
        comments: parseInt(t.comments, 10) || 0,
        location: t.location || null,
        country: t.country || null,
        callerType: callerTypes[0]?.name || null,
        isSpam: score >= this._blockThreshold,
        source: 'tellows',
      };

      this._addToCache(cacheKey, result);
      return result;
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.warn('Tellows: erreur vérification', { phone: phoneNumber, error: err.message });
      }
      return null;
    } finally {
      clearTimeout(timeout);
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

module.exports = SpamScoreService;
