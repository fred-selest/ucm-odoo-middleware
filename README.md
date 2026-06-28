# UCM ↔ Odoo Middleware

Middleware CTI (Computer Telephony Integration) entre un PBX **Grandstream UCM6300** et **Odoo 19** (ou Dolibarr), avec dashboard d'administration temps réel.

> **Documentation complémentaire** :
> - [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — choix techniques, container DI, conventions
> - [`docs/ROADMAP.md`](docs/ROADMAP.md) — versions passées et backlog
> - [`docs/SECURITY.md`](docs/SECURITY.md) — politique sécurité et historique des fixes

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [API](#api)
- [Module Odoo](#module-odoo)
- [Développement](#développement)
- [Observabilité](#observabilité)
- [Changelog](#changelog)
- [Licence](#licence)

## Fonctionnalités

- **Événements d'appels en temps réel** — WebSocket UCM ou webhook, notification instantanée vers les navigateurs
- **Enrichissement CRM** — Recherche automatique du contact Odoo/Dolibarr à chaque appel entrant, avec photo
- **Historique des appels** — Base SQLite locale, filtres, pagination, export
- **Dashboard admin** — Interface web responsive (Bootstrap 5) : appels live, stats, graphiques, gestion agents
- **Click-to-call** — Lancer un appel depuis l'interface vers n'importe quel numéro
- **Multi-CRM** — Architecture modulaire avec factory pattern : Odoo (XML-RPC) ou Dolibarr (REST API)
- **Blacklist** — Blocage de numéros indésirables + scoring spam Tellows
- **Supervision** — Health checks automatiques (30s), alertes après 3 échecs consécutifs
- **API REST documentée** — Swagger UI sur `/api-docs`
- **Enrichissement SIRENE INSEE** + **Google Places** + **Whisper transcription**
- **WebSocket broadcast** — Diffusion temps réel vers les agents connectés
- **Métriques Prometheus** — Endpoint `/metrics` (CPU, mémoire, compteurs appels, requêtes HTTP)

## Architecture

```
┌─────────────────┐   WebSocket/HTTP   ┌──────────────────────────┐   XML-RPC    ┌───────────┐
│  Grandstream    │ ◄────────────────► │  Middleware Node.js      │ ───────────► │  Odoo 19  │
│  UCM6300        │                    │  (Express, port 3000)    │              │  (SaaS)   │
└─────────────────┘                    └──────────┬───────────────┘              └───────────┘
                                                   │                              ┌───────────┐
                                            WebSocket /ws                    ou ► │ Dolibarr  │
                                                   │                              └───────────┘
                                        ┌──────────▼───────────┐
                                        │  Navigateurs agents  │
                                        │  (Dashboard admin)   │
                                        └──────────────────────┘
```

Pour les détails (Clean Architecture, container DI, choix techniques), voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Prérequis

- **Node.js** ≥ 20
- **Docker** + Docker Compose (déploiement recommandé)
- Un PBX **Grandstream UCM6xxx** accessible en HTTP/WebSocket (ou CloudUCM)
- Un compte **Odoo** avec clé API (ou Dolibarr avec `DOLAPIKEY`)
- *(Optionnel)* Clé API INSEE SIRENE pour enrichissement entreprises

## Installation

### Docker (recommandé)

```bash
git clone https://github.com/fred-selest/ucm-odoo-middleware.git
cd ucm-odoo-middleware
cp .env.example .env
# Éditer .env avec vos paramètres UCM et Odoo

docker network create proxy-net
docker compose build && docker compose up -d
curl http://localhost:3000/health
```

### Sans Docker

```bash
npm install
cp .env.example .env
# Éditer .env
npm start
```

## Configuration

Toute la configuration se fait via `.env` (voir `.env.example`). Variables principales :

| Variable | Description | Défaut |
|----------|-------------|--------|
| `UCM_MODE` | Mode de connexion : `websocket` ou `webhook` (recommandé) | `webhook` |
| `UCM_HOST` | Adresse IP ou hostname du PBX | — |
| `UCM_WEB_PORT` | Port API web du UCM | `8089` |
| `UCM_WEB_USER` / `UCM_WEB_PASSWORD` | Identifiants API UCM | — |
| `ODOO_URL` / `ODOO_DB` / `ODOO_USERNAME` / `ODOO_API_KEY` | Connexion Odoo | — |
| `CRM_TYPE` | `odoo` ou `dolibarr` | `odoo` |
| `SERVER_PORT` | Port HTTP du serveur | `3000` |
| `CACHE_CONTACT_TTL` | TTL cache contacts (secondes) | `300` |
| `INSEE_SIRENE_API_KEY` | Clé API SIRENE (optionnel) | — |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` |
| `UCM_TLS_REJECT_UNAUTHORIZED` | Vérification stricte du cert TLS UCM | `true` |
| `UCM_TLS_CA_CERT_CONTENT` | CA custom (PEM sur une ligne) si UCM auto-signé | vide |

## API

Documentation interactive sur `/api-docs` (Swagger UI). Endpoints principaux :

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/health` | Non | Santé du service |
| GET | `/metrics` | Non | Métriques Prometheus |
| POST | `/api/auth/login` | Non | Obtenir un token de session |
| GET | `/api/calls/history` | Oui | Historique paginé + filtres |
| GET | `/api/calls/active` | Oui | Appels en cours |
| POST | `/api/calls/dial` | Oui | Click-to-call |
| GET | `/api/contacts` | Oui | Recherche contacts CRM |
| GET | `/api/stats/today` | Oui | Statistiques du jour |
| GET | `/api/agents/status` | Oui | Statut des agents |
| GET / POST / DELETE | `/api/blacklist` | Oui | Gestion blacklist |
| GET | `/api/recordings` | Oui | Enregistrements |

**Authentification** : header `X-Session-Token` obtenu via `/api/auth/login` (TTL 8h).

## Module Odoo

Le dossier `odoo_addons/ucm_connector/` contient un module Odoo optionnel qui ajoute :
- Champs VoIP sur `res.partner` et `res.users`
- Modèles pour les logs d'appels, statuts agents, files d'attente
- Vues et wizard de configuration

## Développement

```bash
npm run dev       # Lancer avec nodemon (watch)
npm run lint      # ESLint 9 (flat config)
npm test          # Tests Jest (16 suites, 172 cas)
```

### CI / GitHub Actions

| Workflow | Rôle |
|----------|------|
| `.github/workflows/ci.yml` | Lint + tests sur Node 20 + check syntaxe |
| `.github/workflows/secret-scan.yml` | Détection de tokens / clés API avec gitleaks |

Toute PR doit passer ces deux checks avant merge.

### Pré-commit checklist

```bash
npm run lint && npm test
```

### Piège docker-compose : bind mounts `ro`

⚠️ `docker-compose.yml` liste les fichiers source montés en `:ro`. Tout nouveau fichier ajouté à `src/` **doit** être ajouté à la liste des volumes, sinon les modifications sont ignorées tant que l'image Docker n'est pas reconstruite. Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#docker-compose--bind-mounts-ro).

## Observabilité

### Health check

```bash
curl http://localhost:3000/health
```

Réponse :
```json
{
  "ucmHttp": "connected",
  "ucmWebSocket": "disabled",
  "odoo": "connected",
  "database": "healthy",
  "websocket": "connected",
  "uptime": 123.45,
  "memory": {"heapTotal": 36, "heapUsed": 22, "rss": 90},
  "consecutiveFailures": 0
}
```

### Métriques Prometheus

```bash
curl http://localhost:3000/metrics
```

Métriques exposées (préfixe `ucm_`) :
- **Appels** : `ucm_calls_total{direction,status}`, `ucm_call_duration_seconds`, `ucm_active_calls`
- **HTTP** : `ucm_http_requests_total{method,route,status_code}`, `ucm_http_request_duration_seconds`
- **Sessions** : `ucm_sessions_active`, `ucm_sessions_login_total{result}`
- **Cache** : `ucm_cache_hits_total`
- **Process** : CPU, mémoire, FDs, heap (collectDefaultMetrics)

Compatible avec n'importe quel scrape Prometheus standard.

## Changelog

### v2.1.2 — 2026-04-18
- Fix responsive : cards colonne droite (`< 992px`)

### v2.1.1 — 2026-04-17
- Fix timestamps ISO uniformes + heures affichées correctes
- Fix superpositions mobile

### v2.1.0 — 2026-03-28
- Améliorations complètes du middleware (multi-CRM, health checks, refactoring)

### Maintenance 2026-06 (session hors release)

15 commits appliqués (sécurité + dette + observabilité + tooling) :

| Catégorie | Items |
|-----------|-------|
| **Sécurité** | TLS strict (régression), rate-limit login, sessions bornées, SQL injection, gitleaks CI |
| **Dette** | Sessions bound, retry auth dedup, dep `crypto` inutile, logs DEBUG, TTL `_activeCalls` |
| **Couverture** | OdooClient XML-RPC parser (20 cas), CrmFactory + adapters (28 cas) |
| **Refacto** | Container DI (god bootstrap 236 → 100 LOC), ESLint 9 + flat config |
| **Ops** | Migrations DB versionnées, Prometheus `/metrics` |

Historique détaillé dans [`docs/ROADMAP.md`](docs/ROADMAP.md) et [`docs/SECURITY.md`](docs/SECURITY.md).

## Licence

MIT — [Selest Informatique](https://selest.info)