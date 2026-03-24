# presentation/api/ — Routes REST

## router.js

Crée le routeur Express avec injection des dépendances :
```javascript
createRouter({ ucmHttpClient, ucmWsClient, crmClient, wsServer, callHandler, webhookManager, callHistory, sireneService, annuaireService, googlePlacesService, spamScoreService })
```

## Routes principales

### Appels
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/calls/history` | Historique paginé (filtres: status, direction, exten, caller, startDate, endDate, search, limit, offset) |
| GET | `/api/calls/active` | Appels en cours (depuis `callHandler._activeCalls`) |
| POST | `/api/calls/dial` | Click-to-call (`{ phone, exten, contactId }`) |
| POST | `/api/calls/sync-cdr` | Sync CDR UCM (query: startTime, endTime — défaut: aujourd'hui) |
| GET | `/api/calls/:uniqueId` | Détail d'un appel |
| POST | `/api/calls/:uniqueId/link-contact` | Associer un contact Odoo à un appel |

### Contacts Odoo
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/odoo/contacts/:id` | Fiche contact complète |
| GET | `/api/odoo/contacts/:id/history` | Appels du contact (par numéro de téléphone) |
| GET | `/api/odoo/contacts/:id/messages` | Historique chatter |
| POST | `/api/odoo/contacts/:id/notes` | Ajouter note chatter (texte brut) |
| POST | `/api/odoo/contacts` | Créer contact |
| PUT | `/api/odoo/contacts/:id` | Modifier contact |
| GET | `/api/odoo/search` | Chercher contacts (param `q`, min 2 chars) |

### Enrichissement contacts
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/sirene/enrich` | Enrichissement SIRENE (cascade : INSEE → Annuaire → Google Places) |
| GET | `/api/annuaire/search?q=...` | Recherche Annuaire Entreprises |
| POST | `/api/webhook/odoo/partner` | Webhook Odoo (auto-enrichissement à la création/modification) |

### Blacklist et spam
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/blacklist` | Liste des numéros bloqués (query: limit, offset, active) |
| POST | `/api/blacklist` | Ajouter un numéro (`{ phoneNumber, reason }`) |
| DELETE | `/api/blacklist/:phone` | Retirer un numéro |
| GET | `/api/blacklist/check/:phone` | Vérifier si un numéro est bloqué |
| POST | `/api/blacklist/import` | Import en masse (`{ numbers: [...], source }`) |
| POST | `/api/blacklist/import-spam-fr` | Importer 23 préfixes démarchage ARCEP |
| GET | `/api/spam/check/:phone` | Score spam Tellows (1-9) |

### Système
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/status` | Status système (sans auth) |
| GET | `/health` | Healthcheck (sans auth, HTTP 200/503) |
| GET | `/api/logs` | Derniers logs (param `limit`, max 300) |
| POST | `/api/cache/clear` | Vider cache contacts (param `phone` optionnel) |
| POST | `/api/ws/broadcast` | Broadcast WS test |

## Tampon de logs

```javascript
// Chaque message Winston est capturé dans LOG_BUFFER (300 entrées max)
logger.on('data', (info) => {
  LOG_BUFFER.push({ ts, level, msg });
});
// Accessible via GET /api/logs
```

## Versioning des assets JS

```javascript
// Cache-busting automatique sur les fichiers JS admin
const BUILD_VERSION = Date.now();
// Injecté dans les URLs : app.js?v=1741819027000
```
