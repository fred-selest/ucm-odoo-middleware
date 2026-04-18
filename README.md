# UCM ↔ Odoo Middleware

Middleware CTI (Computer Telephony Integration) entre un PBX **Grandstream UCM6300** et **Odoo 19** (ou Dolibarr), avec dashboard d'administration temps réel.

## Fonctionnalités

- **Événements d'appels en temps réel** — WebSocket UCM ou webhook, avec notification instantanée vers les navigateurs
- **Enrichissement CRM** — Recherche automatique du contact Odoo/Dolibarr à chaque appel entrant, avec photo
- **Historique des appels** — Base SQLite locale, filtres, pagination, export
- **Dashboard admin** — Interface web responsive (Bootstrap 5) : appels live, stats, graphiques, gestion agents
- **Click-to-call** — Lancer un appel depuis l'interface vers n'importe quel numéro
- **Multi-CRM** — Architecture modulaire avec factory pattern : Odoo (XML-RPC) ou Dolibarr (REST API)
- **Blacklist** — Blocage de numéros indésirables
- **Supervision** — Health checks automatiques (30s), alertes après 3 échecs consécutifs
- **API REST documentée** — Swagger UI sur `/api-docs`
- **WebSocket broadcast** — Diffusion temps réel vers les agents connectés

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

### Structure du code (Clean Architecture)

```
src/
├── index.js                      # Bootstrap, cycle de vie, shutdown graceful
├── config/                       # Configuration .env + overrides runtime
├── infrastructure/
│   ├── ucm/                      # Clients UCM (WebSocket + HTTP API)
│   ├── crm/                      # Factory + adaptateurs (Odoo, Dolibarr)
│   ├── odoo/                     # Client XML-RPC Odoo
│   ├── dolibarr/                 # Client REST Dolibarr
│   ├── database/                 # SQLite (CallHistory, schema)
│   ├── websocket/                # Serveur WS pour les navigateurs
│   ├── monitoring/               # HealthAgent (supervision 30s)
│   └── lookup/                   # Enrichissement SIRENE INSEE
├── application/
│   ├── CallHandler.js            # Orchestration : incoming → answered → hangup
│   ├── ContactSyncService.js     # Cache contacts + sync CRM
│   └── WebhookManager.js         # Fallback webhook pour anciens UCM
└── presentation/
    ├── api/                      # Routes Express, auth session, Swagger
    └── admin/                    # SPA : HTML, CSS, JS (Bootstrap 5)
```

## Modes de connexion UCM

### Mode Webhook (recommandé)

Le PBX envoie les événements d'appels au middleware via des requêtes HTTP POST.
Aucun accès réseau direct au PBX n'est nécessaire côté middleware — c'est le UCM qui contacte le middleware.

**Prérequis** : le UCM doit pouvoir joindre le middleware en HTTP (configurer l'URL webhook dans l'interface PBX).

### Mode WebSocket

Le middleware se connecte au WebSocket du PBX pour recevoir les événements en temps réel. Plus réactif que le webhook mais nécessite un accès réseau direct au PBX.

**Prérequis** : accès réseau direct au port WebSocket du UCM (généralement 8089). En réseau local ou via VPN.

### CloudUCM (UCM hébergé par Grandstream)

Si votre UCM est un **CloudUCM** (hébergé dans le cloud Grandstream), le mode **WebSocket fonctionne directement** sans VPN car le PBX est accessible sur Internet. Il suffit de renseigner l'adresse publique du CloudUCM dans `UCM_HOST`.

Le mode webhook fonctionne également avec CloudUCM — dans ce cas, configurez l'URL publique du middleware comme cible webhook dans l'interface CloudUCM.

## Enrichissement SIRENE (INSEE)

Le middleware intègre l'API **SIRENE INSEE v3.11** pour enrichir les fiches clients avec les données légales des entreprises françaises : dénomination, adresse, code APE, forme juridique, catégorie d'entreprise.

### Endpoints SIRENE (accès public, sans authentification)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/sirene/search?q=nom&limit=5` | Recherche par nom d'entreprise |
| GET | `/api/sirene/siren/:siren` | Fiche par SIREN (9 chiffres) |
| GET | `/api/sirene/siret/:siret` | Fiche par SIRET (14 chiffres) |

### Obtenir une clé API INSEE

1. Créer une application sur [portail-api.insee.fr](https://portail-api.insee.fr)
2. Souscrire à l'API Sirene (gratuit)
3. Ajouter la clé API dans `.env` :

   ```env
   INSEE_SIRENE_API_KEY=votre-clé-api
   ```

> **Note** : l'API SIRENE ne contient pas de numéros de téléphone (retirés par l'INSEE, RGPD). L'enrichissement se fait par nom d'entreprise, SIREN ou SIRET.

## Prérequis

- **Node.js** ≥ 20
- **Docker** + Docker Compose (déploiement recommandé)
- Un PBX **Grandstream UCM6xxx** accessible en HTTP/WebSocket (ou CloudUCM)
- Un compte **Odoo** avec clé API (ou Dolibarr avec DOLAPIKEY)
- *(Optionnel)* Clé API INSEE SIRENE pour l'enrichissement entreprises

## Installation

### Docker (recommandé)

```bash
# Cloner le repo
git clone https://github.com/fred-selest/ucm-odoo-middleware.git
cd ucm-odoo-middleware

# Configurer l'environnement
cp .env.example .env
# Éditer .env avec vos paramètres UCM et Odoo

# Créer le réseau Docker (si pas déjà fait)
docker network create proxy-net

# Lancer
docker compose build && docker compose up -d

# Vérifier
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

Toute la configuration se fait via le fichier `.env` (voir `.env.example`).

| Variable | Description | Défaut |
|----------|-------------|--------|
| `UCM_MODE` | Mode de connexion UCM : `websocket` ou `webhook` | `webhook` |
| `UCM_HOST` | Adresse IP ou hostname du PBX | — |
| `UCM_WEB_PORT` | Port API web du UCM | `8089` |
| `UCM_WEB_USER` | Utilisateur API UCM | — |
| `UCM_WEB_PASSWORD` | Mot de passe API UCM | — |
| `ODOO_URL` | URL de l'instance Odoo | — |
| `ODOO_DB` | Nom de la base Odoo | — |
| `ODOO_USERNAME` | Email utilisateur Odoo | — |
| `ODOO_API_KEY` | Clé API Odoo | — |
| `SERVER_PORT` | Port du serveur HTTP | `3000` |
| `CACHE_CONTACT_TTL` | Cache contacts en secondes | `300` |
| `INSEE_SIRENE_API_KEY` | Clé API INSEE pour enrichissement SIRENE | — |
| `LOG_LEVEL` | Niveau de log (debug, info, warn, error) | `info` |

## API

Documentation interactive disponible sur `/api-docs` (Swagger UI).

### Endpoints principaux

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/health` | Non | Santé du service |
| POST | `/api/auth/login` | Non | Obtenir un token de session |
| GET | `/api/calls/history` | Oui | Historique paginé + filtres |
| GET | `/api/calls/active` | Oui | Appels en cours |
| POST | `/api/calls/dial` | Oui | Click-to-call |
| GET | `/api/contacts` | Oui | Recherche contacts CRM |
| GET | `/api/stats/today` | Oui | Statistiques du jour |
| GET | `/api/agents/status` | Oui | Statut des agents |
| GET/POST/DELETE | `/api/blacklist` | Oui | Gestion blacklist |
| GET | `/api/recordings` | Oui | Enregistrements |

**Authentification** : header `X-Session-Token` obtenu via `/api/auth/login` (TTL 8h).

## Développement

```bash
npm run dev       # Lancer avec nodemon (watch)
npm run lint      # ESLint
npm test          # Tests Jest
```

## Module Odoo

Le dossier `odoo_addons/ucm_connector/` contient un module Odoo optionnel qui ajoute :
- Champs VoIP sur `res.partner` et `res.users`
- Modèles pour les logs d'appels, statuts agents, files d'attente
- Vues et wizard de configuration

## Changelog

### v2.1.2 — 2026-04-18
- **Fix responsive** : les cards de la colonne droite (Click-to-Call, Recherche, Agents) n'apparaissent plus intercalées entre les lignes du journal d'appels sur mobile/tablette/paysage. La règle `overflow: hidden` sur `.live-journal-card` couvre désormais toutes les largeurs `< 992px` (au lieu de `< 768px` seulement).

### v2.1.1 — 2026-04-17
- Fix timestamps ISO uniformes + heures affichées correctes
- Fix superpositions mobile (tentative initiale, couvrait < 768px uniquement)

### v2.1.0 — 2026-03-28
- Améliorations complètes du middleware (multi-CRM, health checks, refactoring)

## Licence

MIT — [Selest Informatique](https://selest.info)
