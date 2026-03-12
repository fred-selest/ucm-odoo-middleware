# config/ — Configuration

`index.js` charge le `.env` (racine du projet) et expose un objet `config` global.

## Variables d'environnement

### UCM6300
| Variable | Défaut | Description |
|----------|--------|-------------|
| `UCM_MODE` | `websocket` | `websocket` ou `webhook` |
| `UCM_HOST` | — | IP du PABX (ex: `192.168.10.100`) |
| `UCM_WEB_PORT` | `8089` | Port HTTPS/WS UCM |
| `UCM_API_USER` | — | Nom d'utilisateur API UCM |
| `UCM_API_PASS` | — | Mot de passe API UCM |
| `UCM_TLS_REJECT_UNAUTHORIZED` | `false` | Certificat auto-signé UCM |
| `UCM_WATCH_EXTENSIONS` | `""` | Extensions à surveiller (vide = toutes) |
| `UCM_RECONNECT_DELAY` | `3000` | Délai reconnexion initial (ms) |
| `UCM_RECONNECT_MAX_DELAY` | `60000` | Délai max reconnexion (ms) |
| `UCM_TIMEOUT` | `8000` | Timeout requêtes HTTP UCM (ms) |

### Odoo
| Variable | Défaut | Description |
|----------|--------|-------------|
| `ODOO_URL` | — | URL Odoo (ex: `https://xxx.odoo.com`) |
| `ODOO_DB` | — | Nom de la base Odoo |
| `ODOO_USERNAME` | — | Email de l'utilisateur API |
| `ODOO_API_KEY` | — | Clé API Odoo (pas le mot de passe) |
| `ODOO_TIMEOUT` | `8000` | Timeout XML-RPC (ms) |
| `CACHE_CONTACT_TTL` | `300` | Cache contacts (secondes) |

### Serveur
| Variable | Défaut | Description |
|----------|--------|-------------|
| `SERVER_PORT` | `3000` | Port HTTP |
| `WS_PATH` | `/ws` | Chemin WebSocket navigateur |
| `DB_PATH` | `/app/data/middleware.db` | Chemin SQLite |
| `DATA_RETENTION_DAYS` | `365` | Rétention historique appels |
| `LOG_LEVEL` | `info` | Niveau de log |
| `NODE_ENV` | `production` | Environnement Node |

## Config dynamique

La config peut être modifiée à chaud via l'API admin (`POST /api/config/ucm`, `POST /api/config/odoo`). Ces changements sont persistés dans `/app/data/config.json` et surchargent le `.env` pour la session courante.

`config.applyUcm(fields)` et `config.applyOdoo(fields)` appliquent les surcharges.

## swagger.js

Spec OpenAPI pour `/api-docs`. Documenter les nouvelles routes dans ce fichier.
