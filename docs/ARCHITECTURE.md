# Architecture

> Choix techniques et détails d'implémentation. Pour la vue d'ensemble, voir le [README](../README.md).

## Clean Architecture

Le code suit une Clean Architecture à 3 couches :

```
src/
├── index.js          # Cycle de vie (boot, listen, connect, shutdown)
├── container.js      # Câblage DI — instancie tous les services + Express
├── logger.js         # Winston avec rotation daily
├── config/           # Configuration (.env + overrides runtime)
├── infrastructure/   # Adapters techniques (I/O, réseau, DB, cache)
├── application/      # Orchestration métier (use cases)
└── presentation/     # Interface externe (Express routes + SPA admin)
```

Règles de dépendance : `presentation → application → infrastructure`. Pas l'inverse.

## Container DI (`container.js`)

`buildContainer()` retourne un objet `c` avec **tous les services câblés** :

```js
const c = await buildContainer();
c.app.use('/', c.apiRouter);
await new Promise((res) => c.httpServer.listen(3000, res));
```

Bénéfices :
- `index.js` = pure lifecycle (lisible en 1 min)
- `container.js` = wiring DI explicite, facile à mocker pour les tests
- Ajout d'un service = 1 ligne dans `container.js`

## Infrastructure layer

| Module | Rôle |
|--------|------|
| `ucm/UcmHttpClient` | API HTTP Grandstream (auth challenge/response MD5) |
| `ucm/UcmWsClient` | WebSocket UCM (événements temps réel) |
| `ucm/UcmWebSocketClient` | WebSocket secondaire (legacy) |
| `crm/CrmFactory` | Sélection dynamique Odoo ou Dolibarr via `CRM_TYPE` |
| `crm/adapters/OdooAdapter` | XML-RPC via `OdooClient` |
| `crm/adapters/DolibarrAdapter` | REST API Dolibarr |
| `database/Database` | SQLite singleton + auto-init schema |
| `database/migrations` | Migrations versionnées (table `_migrations`) |
| `database/CallHistory` | CRUD appels + stats + blacklist |
| `lookup/SireneService` | API SIRENE INSEE (enrichissement entreprises) |
| `lookup/GooglePlacesService` | API Google Places (téléphone + site) |
| `lookup/SpamScoreService` | Scoring Tellows anti-spam |
| `transcription/WhisperService` | Transcription audio (mode local CLI ou API OpenAI/Groq) |
| `websocket/WsServer` | Serveur WebSocket navigateur |
| `monitoring/HealthAgent` | Health check 30s |
| `monitoring/metrics` | Prometheus (`prom-client`) |
| `odoo/OdooClient` | Client XML-RPC bas niveau |

## Application layer

| Module | Rôle |
|--------|------|
| `CallHandler` | Orchestration incoming/answered/hangup |
| `ContactSyncService` | Sync contacts (résolution post-CDR) |
| `WebhookManager` | Réception webhooks UCM (mode fallback) |
| `NotificationService` | Alertes Telegram/Email/Web Push |
| `CdrSyncService` | Sync périodique CDR depuis UCM |

## Presentation layer

| Module | Rôle |
|--------|------|
| `api/router.js` | Routes Express principales (~2100 LOC) |
| `api/queues.routes.js` | Routes files d'attente |
| `api/middleware/auth.js` | Sessions en mémoire (X-Session-Token) |
| `api/middleware/security.js` | Rate limiting + sanitization |
| `api/middleware/validator.js` | Validation `express-validator` |
| `api/middleware/errorHandler.js` | Gestion d'erreurs centralisée |
| `api/middleware/requestLogger.js` | Logs HTTP structurés |
| `admin/js/*.js` | SPA admin (Bootstrap 5, ES6 modules) |

## Modes de connexion UCM

| Mode | Quand | Prérequis |
|------|-------|-----------|
| `webhook` (recommandé) | UCM envoie les événements via HTTP | Le UCM doit joindre le middleware |
| `websocket` | Middleware se connecte au WS du UCM | Accès direct UCM (réseau local ou VPN) |
| CloudUCM | UCM hébergé par Grandstream | WebSocket fonctionne directement (Internet) |

## Flux d'un appel entrant (mode webhook)

```
UCM ─HTTP POST─→ /api/webhooks
                    ↓
              WebhookManager
                    ↓ emit 'call:incoming'
              CallHandler._onIncoming
                    ↓
              OdooClient.findContactByPhone  (cache → Odoo XML-RPC)
                    ↓
              CallHistory.createCall          (SQLite)
                    ↓
              WsServer.notifyExtension
                    ↓
              Browser (dashboard admin) ◀── live update
```

## Conventions code

### JavaScript

- **Modules** :
  - Middleware : CommonJS (`require()`, `'use strict'`)
  - Dolibarr Agent / Telegram Bot (hors middleware) : ES Modules
- **Async/Await** : toujours, jamais `.then()`. Logger les erreurs avec contexte.

### Python (hors scope — pour mémoire)

`telecom-cdr` (autre projet) utilise `from __future__ import annotations` + type hints.

### Tests (Jest)

- Fichiers : `tests/*.test.js`
- Mocks : `tests/setup.js` (logger) + `tests/__mocks__/constants.js`
- Commande : `npm test`

## docker-compose : bind mounts `ro`

⚠️ **Piège connu** : `docker-compose.yml` liste les fichiers source montés en `:ro`. Tout nouveau fichier ajouté à `src/` **doit** être ajouté à la liste des volumes, sinon les modifications sont ignorées tant que l'image Docker n'est pas reconstruite.

```yaml
volumes:
  - ./src/index.js:/app/src/index.js:ro
  - ./src/container.js:/app/src/container.js:ro
  - ./src/logger.js:/app/src/logger.js:ro
  - ./src/infrastructure/database/Database.js:/app/src/infrastructure/database/Database.js:ro
  # ... etc
```

## Migrations DB

Système versionné : table `_migrations(version, description, applied_at)` + module `migrations.js`.

```js
// migrations.js
const MIGRATIONS = [
  {
    version: '0002_calls_transcription',
    description: 'Ajout colonne transcription pour Whisper',
    sql: 'ALTER TABLE calls ADD COLUMN transcription TEXT',
  },
  // Prochaines migrations ici
];
```

`applyMigrations(db)` :
1. Crée `_migrations` si besoin
2. Lit les versions déjà appliquées
3. Pour chaque migration non trackée : exécute le SQL + insère dans `_migrations`
4. Gère le cas "duplicate column" (legacy) sans bloquer