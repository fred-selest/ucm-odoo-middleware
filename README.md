# UCM ↔ CRM Middleware v2.1

Middleware CTI complet pour intégrer un PBX **Grandstream UCM6300** avec un CRM — style Ringover.

Supporte **Odoo** (XML-RPC) et **Dolibarr** (REST API) de façon interchangeable via une couche d'abstraction modulaire.

---

## Fonctionnalités

- **Connexion UCM6300** via API HTTPS + WebSocket (événements temps réel)
- **Authentification challenge/response** MD5 avec rafraîchissement automatique
- **Recherche de contacts CRM** en temps réel à chaque appel entrant
- **Création automatique de contacts** pour les numéros inconnus
- **Notifications WebSocket** aux agents (popup appel entrant)
- **Historique des appels** persisté en SQLite
- **Journal CRM** — chaque appel est enregistré dans la fiche contact
- **Click-to-Call** depuis l'interface admin
- **Transfert d'appel** entre extensions
- **Blacklist** numéros indésirables
- **DND** (Do Not Disturb) par poste
- **Statistiques** et graphiques journaliers
- **Interface admin** responsive (dark/light mode, mobile-friendly)
- **Multi-CRM** : Odoo ou Dolibarr selon `CRM_TYPE`
- **Docker** prêt pour la production

---

## Choisir entre Odoo et Dolibarr

### Tableau comparatif

| Critère | Odoo | Dolibarr |
|---------|------|----------|
| **Protocole** | XML-RPC | REST JSON |
| **Authentification** | Session (uid + API Key) | Stateless (DOLAPIKEY header) |
| **Contact** | `res.partner` — champ `name` unique | `llx_socpeople` — `lastname` + `firstname` séparés |
| **Téléphone** | `phone`, `mobile` | `phone_pro`, `phone_mobile`, `phone_perso` |
| **Entreprise** | Même modèle `res.partner` (`parent_id`) | Table séparée `llx_societe` (thirdparties) |
| **Journal appel** | Chatter `message_post()` | Agenda `POST /agendaevents` (AC_TEL) |
| **Note manuelle** | Chatter subtype `note` | Agenda `POST /agendaevents` (AC_NOTE) |
| **URL fiche** | `/web#model=res.partner&id=X` | `/contact/card.php?id=X` |
| **Complexité setup** | API Key dans les paramètres utilisateur | API Key + module REST à activer |

### Quand choisir Odoo

- Vous utilisez déjà Odoo (CRM, facturation, ventes…)
- Vous voulez le chatter intégré avec toutes les activités
- Vos contacts et sociétés sont dans le même modèle `res.partner`

### Quand choisir Dolibarr

- Vous utilisez Dolibarr comme ERP/CRM principal
- Vous préférez une API REST simple (pas de XML-RPC)
- Vous avez une séparation naturelle contacts / sociétés

---

## Installation

### Prérequis

- Docker & Docker Compose
- Grandstream UCM6300 (firmware 1.0.27+)
- **Odoo v14+** *ou* **Dolibarr 17+** (au choix)
- Node.js 20+ (développement local uniquement)

### 1. Configurer l'environnement

```bash
cp .env.example .env
nano .env
```

### 2. Démarrer

```bash
docker compose up -d
```

### 3. Accéder à l'interface

| Service | URL |
|---------|-----|
| Interface admin | `https://ucm.selest.info/admin` |
| Health check | `https://ucm.selest.info/health` |
| Documentation API | `https://ucm.selest.info/api-docs` |

---

## Configuration CRM

### Activer Odoo (défaut)

```bash
# .env
CRM_TYPE=odoo
ODOO_URL=https://odoo.mondomaine.fr
ODOO_DB=ma_base
ODOO_USERNAME=admin
ODOO_API_KEY=cle_api_odoo
```

**Obtenir la clé API Odoo :**
1. Odoo → **Paramètres → Utilisateurs → [votre utilisateur]**
2. Section **Clés API** → **Nouvelle clé**
3. Copier la clé générée

### Activer Dolibarr

```bash
# .env
CRM_TYPE=dolibarr
DOLIBARR_URL=https://dolibarr.mondomaine.fr
DOLIBARR_API_KEY=votre_cle_api_dolibarr
DOLIBARR_USER_ID=1        # ID utilisateur propriétaire des activités
DOLIBARR_ENTITY_ID=       # Laisser vide (sauf multi-société)
```

**Obtenir la clé API Dolibarr :**
1. Dolibarr → **Configuration → Utilisateurs → [votre utilisateur] → Modifier**
2. Section **API** → **Générer une clé API**
3. Copier la clé

**Activer le module REST Dolibarr :**
1. **Configuration → Modules → Outils → API (REST)** → Activer
2. Vérifier que l'utilisateur a les droits : Contacts + Agenda + Tiers

### Changer de CRM sans redémarrer

Via l'API admin (authentifié) :

```bash
# Reconfigurer Dolibarr
curl -X POST https://ucm.selest.info/api/config/dolibarr \
  -H "X-Session-Token: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://dolibarr.fr","apiKey":"clé","userId":1}'

# Reconfigurer Odoo
curl -X POST https://ucm.selest.info/api/config/odoo \
  -H "X-Session-Token: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://odoo.fr","db":"prod","username":"admin","apiKey":"clé"}'
```

> **Note :** Changer `CRM_TYPE` au runtime nécessite un redémarrage du container. Les autres paramètres (URL, clé) sont appliqués immédiatement.

---

## Configuration UCM6300

### Étape 1 : Activer l'API

1. Se connecter : `https://IP_UCM:8089`
2. **API Configuration → API Settings**
3. Cocher **Enable API**
4. Sauvegarder

### Étape 2 : Mode WebSocket (recommandé)

```bash
UCM_MODE=websocket
UCM_HOST=192.168.10.100
UCM_WEB_PORT=8089
UCM_API_USER=admin
UCM_API_PASS=mot_de_passe
```

### Étape 3 : Mode Webhook (fallback)

Créer un token dans l'interface admin → **Clients Webhook → Nouveau client**, puis configurer les Action URLs dans l'UCM :

| Action | URL |
|--------|-----|
| Ring | `https://ucm.selest.info/webhook/TOKEN?event=ring&caller=$F1&exten=$F2&uniqueid=$F3` |
| Answer | `https://ucm.selest.info/webhook/TOKEN?event=answer&caller=$F1&exten=$F2&uniqueid=$F3` |
| Hangup | `https://ucm.selest.info/webhook/TOKEN?event=hangup&caller=$F1&exten=$F2&uniqueid=$F3&duration=$F4` |

---

## Variables d'environnement

### CRM

| Variable | Description | Défaut |
|----------|-------------|--------|
| `CRM_TYPE` | CRM à utiliser : `odoo` ou `dolibarr` | `odoo` |

### Odoo

| Variable | Description | Exemple |
|----------|-------------|---------|
| `ODOO_URL` | URL de l'instance Odoo | `https://odoo.mondomaine.fr` |
| `ODOO_DB` | Nom de la base de données | `production` |
| `ODOO_USERNAME` | Identifiant utilisateur | `admin` |
| `ODOO_API_KEY` | Clé API générée dans Odoo | `abc123...` |
| `ODOO_TIMEOUT` | Timeout HTTP (ms) | `8000` |

### Dolibarr

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DOLIBARR_URL` | URL de l'instance Dolibarr | `https://dolibarr.mondomaine.fr` |
| `DOLIBARR_API_KEY` | Clé API générée dans Dolibarr | `xyz789...` |
| `DOLIBARR_USER_ID` | ID utilisateur propriétaire des activités | `1` |
| `DOLIBARR_ENTITY_ID` | Entité multi-société (laisser vide si non utilisé) | `` |
| `DOLIBARR_TIMEOUT` | Timeout HTTP (ms) | `8000` |

### UCM6300

| Variable | Description | Défaut |
|----------|-------------|--------|
| `UCM_MODE` | `websocket` ou `webhook` | `websocket` |
| `UCM_HOST` | IP ou hostname de l'UCM | `localhost` |
| `UCM_WEB_PORT` | Port web HTTPS de l'UCM | `8089` |
| `UCM_API_USER` | Utilisateur API UCM | `admin` |
| `UCM_API_PASS` | Mot de passe API UCM | — |
| `UCM_WATCH_EXTENSIONS` | Extensions à surveiller (virgule) | (toutes) |
| `UCM_TLS_REJECT_UNAUTHORIZED` | Valider le certificat TLS | `true` |

### Serveur

| Variable | Description | Défaut |
|----------|-------------|--------|
| `SERVER_PORT` | Port HTTP du middleware | `3000` |
| `API_SECRET_KEY` | Clé secrète sessions admin | — |
| `CACHE_CONTACT_TTL` | Durée cache contacts (secondes) | `300` |
| `LOG_LEVEL` | Niveau de log | `info` |
| `LOG_OUTPUT` | Sortie logs : `console`, `file`, `both` | `both` |

### Notifications Telegram (optionnel)

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token du bot Telegram |
| `TELEGRAM_CHAT_ID` | ID du chat de supervision |

---

## Structure du projet

```
ucm-odoo-middleware/
├── src/
│   ├── application/
│   │   ├── CallHandler.js          # Orchestration appels (CRM-agnostique)
│   │   └── WebhookManager.js       # Gestion tokens webhook UCM
│   ├── infrastructure/
│   │   ├── crm/                    # ← Couche CRM modulaire
│   │   │   ├── CrmClientInterface.js   # Contrat abstrait (interface)
│   │   │   ├── CrmFactory.js           # Sélection adaptateur selon CRM_TYPE
│   │   │   └── adapters/
│   │   │       ├── OdooAdapter.js      # Adaptateur Odoo (délègue à OdooClient)
│   │   │       └── DolibarrAdapter.js  # Adaptateur Dolibarr (REST)
│   │   ├── odoo/
│   │   │   └── OdooClient.js       # Client XML-RPC Odoo (bas niveau)
│   │   ├── ucm/
│   │   │   ├── UcmHttpClient.js    # API HTTPS UCM6300
│   │   │   ├── UcmWsClient.js      # WebSocket UCM6300
│   │   │   └── UcmEventParser.js   # Parsing événements UCM
│   │   ├── database/
│   │   │   ├── CallHistory.js      # Historique SQLite
│   │   │   └── schema.sql
│   │   ├── websocket/
│   │   │   └── WsServer.js         # Serveur WebSocket agents
│   │   └── monitoring/
│   │       └── HealthAgent.js      # Supervision + alertes Telegram
│   ├── presentation/
│   │   ├── api/
│   │   │   └── router.js           # Routes Express
│   │   └── admin/
│   │       ├── index.html          # Interface admin SPA
│   │       ├── css/                # Modules CSS (theme/components/layout/responsive)
│   │       └── js/                 # Modules JS (app/calls/journal/stats/transfer/blacklist…)
│   ├── config/
│   │   └── index.js                # Config centralisée (UCM + CRM + Dolibarr + serveur)
│   └── index.js                    # Bootstrap (utilise CrmFactory)
├── docs/
│   └── DOLIBARR_API.md             # Référence complète API Dolibarr
├── data/
│   ├── middleware.db                # Base SQLite (générée au démarrage)
│   └── config.json                 # Overrides de config persistés
├── logs/
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── README.md
```

---

## API Endpoints

### Authentification (public)
| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/auth/login` | Connexion (retourne X-Session-Token) |
| `POST` | `/api/auth/logout` | Déconnexion |
| `GET` | `/api/auth/me` | Vérifier session courante |
| `GET` | `/health` | État global du middleware |
| `GET` | `/status` | Statut détaillé (UCM, CRM, WebSocket) |

### Contacts CRM
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/odoo/search?q=` | Recherche par nom/société |
| `GET` | `/api/odoo/contacts/:id` | Détail contact |
| `GET` | `/api/odoo/contacts/:id/history` | Historique appels du contact |
| `GET` | `/api/odoo/contacts/:id/messages` | Journal CRM du contact |
| `POST` | `/api/odoo/contacts` | Créer un contact |
| `PUT` | `/api/odoo/contacts/:id` | Modifier un contact |
| `POST` | `/api/odoo/contacts/:id/notes` | Ajouter une note CRM |

> Les routes `/api/odoo/…` fonctionnent quelle que soit la valeur de `CRM_TYPE`.

### Appels
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/calls/active` | Appels en cours |
| `GET` | `/api/calls/history` | Historique paginé |
| `GET` | `/api/calls/missed` | Appels manqués |
| `POST` | `/api/calls/dial` | Click-to-Call |
| `POST` | `/api/calls/sync-cdr` | Synchroniser CDR depuis l'UCM |
| `POST` | `/api/calls/:id/transfer` | Transfert d'appel |

### Agents
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/agents/status` | Statut de tous les agents |
| `POST` | `/api/agents/:exten/dnd` | Activer/désactiver DND |

### Configuration
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/config` | Configuration complète (UCM + CRM) |
| `POST` | `/api/config/ucm` | Modifier la config UCM |
| `POST` | `/api/config/odoo` | Modifier la config Odoo |
| `POST` | `/api/config/dolibarr` | Modifier la config Dolibarr |

### Blacklist
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/blacklist` | Liste des numéros bloqués |
| `POST` | `/api/blacklist` | Bloquer un numéro |
| `DELETE` | `/api/blacklist/:phone` | Débloquer |

### Statistiques
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/stats?period=today` | KPIs du jour |
| `GET` | `/api/stats/hourly` | Distribution horaire |
| `GET` | `/api/stats/extensions` | Stats par extension |

---

## Architecture CRM — Règle de parité

> **Règle absolue :** toute fonction ajoutée dans `OdooAdapter` doit être implémentée dans `DolibarrAdapter` dans le même commit, et vice-versa.

### Ajouter une nouvelle fonctionnalité CRM

1. **Déclarer le contrat** dans `CrmClientInterface.js` :
```javascript
async maNouvelleFonction(param) {
  throw new Error(`${this.crmType}: maNouvelleFonction() non implémenté`);
}
```

2. **Implémenter dans OdooAdapter** (via OdooClient ou directement) :
```javascript
async maNouvelleFonction(param) {
  return this._client.maNouvelleFonction(param);
}
```

3. **Implémenter dans DolibarrAdapter** (endpoint REST Dolibarr) :
```javascript
async maNouvelleFonction(param) {
  // POST/GET /api/index.php/...
  return this._req('GET', '/endpoint', { param });
}
```

4. Si l'équivalent Dolibarr n'existe pas encore, utiliser un fallback explicite :
```javascript
async maNouvelleFonction(param) {
  logger.warn('Dolibarr: maNouvelleFonction() non supporté pour ce CRM');
  return null;
}
```

### Méthodes de l'interface CRM

| Méthode | Odoo | Dolibarr |
|---------|------|----------|
| `authenticate()` | XML-RPC `/xmlrpc/2/common` | `GET /status` |
| `findContactByPhone(phone)` | `res.partner.search_read` | `GET /contacts?sqlfilters=` + `GET /thirdparties?sqlfilters=` |
| `searchContacts(query, limit)` | `res.partner.search_read` | `GET /contacts` + `GET /thirdparties` |
| `getContactById(id)` | `res.partner.search_read` | `GET /contacts/{id}` |
| `getContactFull(id)` | `res.partner.search_read` (champs étendus) | `GET /contacts/{id}` + `GET /thirdparties/{socid}` |
| `createContact(data)` | `res.partner.create` | `POST /contacts` |
| `updateContact(id, data)` | `res.partner.write` | `PUT /contacts/{id}` |
| `logCallActivity(id, callData)` | `res.partner.message_post` | `POST /agendaevents` (AC_TEL) |
| `getContactMessages(id, limit)` | `mail.message.search_read` | `GET /agendaevents?sqlfilters=` |
| `addContactNote(id, note)` | `message_post` subtype note | `POST /agendaevents` (AC_NOTE) |

---

## Docker

```bash
# Démarrer
docker compose up -d

# Voir les logs en temps réel
docker compose logs -f

# Redémarrer après config
docker compose restart

# Reconstruire après modification du code
docker compose up -d --build

# Arrêter
docker compose down
```

---

## Tests rapides

```bash
# Healthcheck
curl https://ucm.selest.info/health

# Test connexion CRM (sans auth)
curl -X POST https://ucm.selest.info/api/odoo/test \
  -H "Content-Type: application/json" \
  -d '{"phone":"0612345678"}'

# Test webhook UCM
curl "https://ucm.selest.info/webhook/TOKEN?event=ring&caller=0612345678&exten=101&uniqueid=test"
```

---

## Logs

```bash
# Docker
docker compose logs -f ucm_odoo_middleware

# Fichiers (dans le container ou volume monté)
tail -f logs/middleware-$(date +%Y-%m-%d).log
```

Niveaux : `error`, `warn`, `info`, `debug`

---

## Dépannage

| Symptôme | Cause probable | Solution |
|----------|---------------|----------|
| CRM non connecté au démarrage | Clé API invalide ou réseau | Vérifier `CRM_TYPE`, URL et clé API |
| Contact non trouvé | Numéro pas au bon format | Vérifier la normalisation (+33 ↔ 0X) |
| Activité non créée dans Dolibarr | Module Agenda désactivé ou droits insuffisants | Activer Module Agenda + droits utilisateur |
| UCM non connecté | IP/Port/Password UCM incorrect | Tester `curl -k https://IP_UCM:8089/api` |
| Popup appel entrant absent | WebSocket non connecté | Vérifier `/status` → champ `websocket.clients` |

---

## Documentation

| Fichier | Contenu |
|---------|---------|
| `docs/DOLIBARR_API.md` | Référence complète API REST Dolibarr (endpoints, champs, sqlfilters, exemples) |
| `https://ucm.selest.info/api-docs` | Swagger UI — tous les endpoints du middleware |

---

## Licence

MIT — Selest Informatique 2026
