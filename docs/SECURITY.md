# Sécurité

> Historique des fixes sécurité + politique courante. Pour la vue d'ensemble du projet, voir le [README](../README.md).

## Politique courante

### Mesures actives

| Mesure | Implémentation | Emplacement |
|--------|----------------|-------------|
| TLS strict | `UCM_TLS_REJECT_UNAUTHORIZED=true` (défaut) | `src/config/index.js:122-125` |
| Rate-limit login | 10 req / 15 min par IP | `src/presentation/api/middleware/security.js:20-27` |
| Rate-limit API | 5000 req / 15 min global | `src/index.js:83-91` |
| Sessions bornées | Plafond 10 000 + 503 si saturé | `src/presentation/api/middleware/auth.js:7-25` |
| Sessions cleanup | Toutes les heures, `unref()` | `auth.js:83-86` |
| CORS whitelist | `config.app.allowedOrigins` | `src/container.js:74-79` |
| Sanitize input | Caractères non-imprimables filtrés | `middleware/security.js:99-129` |
| Validation entrées | `express-validator` par route | `middleware/validator.js` |
| Secret scan | GitHub Actions + gitleaks | `.github/workflows/secret-scan.yml` |
| Pas de tokens dans git | `.gitignore` (`.env`, `data/config.json`) + pre-commit |

### Variables sensibles

| Variable | Source | Notes |
|----------|--------|-------|
| `ODOO_API_KEY` | `.env` ou `data/config.json` | Jamais loggé |
| `DOLIBARR_API_KEY` | `.env` ou `data/config.json` | Jamais loggé |
| `WHISPER_API_KEY` | `data/config.json` (priorité) | Persistance via `applyWhisper()` |
| `API_SECRET_KEY` | `.env` | HMAC sessions |
| `UCM_API_PASS` | `.env` | Jamais loggé |
| `TELEGRAM_TOKEN` | `.env` | Pour alertes Telegram |

## Régression 2026-06 (détectée et corrigée)

### TLS `rejectUnauthorized` hardcodé à `false`

**Symptôme** : `SECURITY_FIXES.LOG` (mars 2026) annonce "TLS strict — Changed rejectUnauthorized to true". Code actuel avait `rejectUnauthorized: false` en dur dans `_setupAxios()`.

**Impact** : La variable d'env `UCM_TLS_REJECT_UNAUTHORIZED` (et `UCM_TLS_CA_CERT_CONTENT`) était silencieusement ignorée. Vulnérabilité MITM si UCM sur réseau non maîtrisé.

**Fix** (commit `b854907`) : consommer `config.ucm.tls.rejectUnauthorized` au lieu du hardcode.

```js
// Avant
const tlsOptions = { rejectUnauthorized: false };

// Après
const tlsOptions = { rejectUnauthorized: config.ucm.tls.rejectUnauthorized };
```

### Rate-limit `/api/auth/login` non testé

**Symptôme** : `authLimiter` (10 req/15min) était déjà appliqué sur `/api/auth/login`, mais aucun test ne le garantissait.

**Fix** (commit `b854907`) : tests de régression dans `tests/authLimiter.test.js`.

## Fixes originaux (mars 2026)

### Critiques appliqués ✅

| # | Fix | Statut |
|---|-----|--------|
| 1 | TLS strict (initial) | ✅ régressé puis re-fixé en 06/2026 |
| 2 | Rate limiting (100/15min sur /api/*) | ✅ |
| 3 | Input validation (express-validator) | ✅ |
| 4 | CORS whitelist | ✅ |
| 5 | Sessions HMAC (sha256 + API_SECRET_KEY) | ✅ |
| 6 | Logs : retrait des données sensibles | ✅ |
| 7 | Webhooks : timestamp (30d) + IP whitelist | ✅ |

### Hautes priorités appliquées ✅

| # | Fix |
|---|-----|
| 8 | N+1 queries : bulk UPDATE au lieu de loop |
| 9 | Timer leaks : `CallHandler.disconnect()` clear setInterval |
| 10 | WebSocket timers : `_clearTimers()` avant `connect()` |
| 11 | Connection pooling : keepAlive:true, maxSockets:50 |
| 12 | SQLite indexes (idx_calls_contact_phone, idx_calls_status_direction) |
| 13 | Cache invalidation : `createContact()` invalide cache |
| 14 | Health thresholds : mémoire (warn >200MB, alert >300MB) |
| 15 | Compression (threshold:1024) |

### Dépendances installées
- `express-rate-limit`
- `compression`
- `express-validator`

## Persistence clé API Whisper (cas particulier)

**Problème** : la clé API Whisper (Groq ou OpenAI) était perdue à chaque redémarrage.

**Cause** : `.env` chargé en premier, écrasait `data/config.json`.

**Solution appliquée dans `src/config/index.js`** :

```js
whisper: {
  // Priorité à ov.whisper (config.json) pour persistance
  apiKey: ov.whisper?.apiKey ?? process.env.WHISPER_API_KEY ?? '',
  apiUrl: ov.whisper?.apiUrl ?? process.env.WHISPER_API_URL ?? '...',
  // ...
}
```

Et dans `applyWhisper()` :

```js
// Ne jamais écraser apiKey avec une valeur vide/null/undefined
if (k === 'apiKey' && (v === '' || v === null || v === undefined)) {
  logger.warn('Config Whisper: tentative écrasement apiKey par valeur vide - IGNORÉ');
  continue;
}
```

## Session 2026-06 (P0 + P1)

### Sécurité runtime

| Item | Commit |
|------|--------|
| TLS hardcoded false → config | `b854907` |
| Rate-limit login (tests régression) | `b854907` |
| Sessions bornées (anti-OOM) | `eecc26f` |
| SQL injection updateCallsForPhone | `eecc26f` |

### Gitleaks CI

Workflow `.github/workflows/secret-scan.yml` bloque tout push contenant des tokens / clés API. Le repo étant public, c'est la dernière barrière avant exposition.

⚠️ **Note** : si le 1er push déclenche des findings sur les tokens déjà dans l'historique, révoquer les tokens sur GitHub avant de merger.