# UCM ↔ Odoo Middleware v2.0

Middleware CTI complet pour intégrer Grandstream UCM6300 avec Odoo, similaire à Ringover.

## 🚀 Fonctionnalités

- ✅ **Connexion UCM6300** via API HTTPS + WebSocket
- ✅ **Authentification challenge/response** avec rafraîchissement auto
- ✅ **Webhooks HTTP** pour les événements d'appel
- ✅ **Recherche de contacts Odoo** en temps réel
- ✅ **Notifications WebSocket** aux agents
- ✅ **Historique des appels** avec SQLite
- ✅ **Click-to-Call** depuis l'interface
- ✅ **Gestion des contacts** (créer, modifier, historique)
- ✅ **Enregistrements d'appels**
- ✅ **Interface admin** complète
- ✅ **Docker** prêt pour la production

## 📋 Prérequis

- Docker & Docker Compose
- Grandstream UCM6300 (firmware 1.0.27+)
- Odoo (v14+)
- Node.js 20+ (pour développement local)

## 🔧 Installation

### 1. Cloner/copier le projet

```bash
cd /opt/stacks/ucm-odoo-middleware
```

### 2. Configurer les variables d'environnement

```bash
cp .env.example .env
nano .env
```

### 3. Démarrer avec Docker

```bash
docker compose up -d
```

### 4. Accéder à l'interface

- **Admin** : https://ucm.selest.info/admin
- **API** : https://ucm.selest.info/api
- **Health** : https://ucm.selest.info/health

## ⚙️ Configuration UCM6300

### Étape 1 : Activer l'API

1. Connecte-toi à l'UCM : `https://IP_UCM:8089`
2. `API Configuration` → `API Settings`
3. ✅ Coche **Enable API**
4. Sauvegarde

### Étape 2 : Créer un token webhook

1. Va sur l'admin middleware
2. Section **Clients Webhook** → **Nouveau client**
3. Copie le token généré

### Étape 3 : Configurer les Action URLs

Dans `API Configuration` → `Action URL` :

| Action | URL |
|--------|-----|
| Ring | `https://ucm.selest.info/webhook/TOKEN?event=ring&caller=$F1&exten=$F2&uniqueid=$F3` |
| Answer | `https://ucm.selest.info/webhook/TOKEN?event=answer&caller=$F1&exten=$F2&uniqueid=$F3` |
| Hangup | `https://ucm.selest.info/webhook/TOKEN?event=hangup&caller=$F1&exten=$F2&uniqueid=$F3&duration=$F4` |

## 📁 Structure du projet

```
ucm-odoo-middleware/
├── src/
│   ├── domain/              # Entités métier
│   │   ├── Call.js
│   │   ├── Contact.js
│   │   └── Agent.js
│   ├── infrastructure/      # Clients externes
│   │   ├── ucm/
│   │   │   ├── UcmHttpClient.js
│   │   │   └── UcmWebSocketClient.js
│   │   ├── odoo/
│   │   │   └── OdooClient.js
│   │   ├── websocket/
│   │   │   └── WsServer.js
│   │   └── database/
│   │       ├── CallHistory.js
│   │       └── schema.sql
│   ├── application/         # Logique métier
│   │   ├── CallHandler.js
│   │   └── WebhookManager.js
│   ├── presentation/        # Interface
│   │   ├── api/
│   │   │   └── router.js
│   │   ├── admin/
│   │   │   └── index.html
│   │   └── websocket/
│   │       └── wsRoutes.js
│   ├── config/
│   │   ├── index.js
│   │   └── swagger.js
│   ├── logger.js
│   └── index.js
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
└── README.md
```

## 🔌 API Endpoints

### Authentification
- `POST /api/auth/login` - Connexion Odoo
- `POST /api/auth/logout` - Déconnexion
- `GET /api/auth/me` - Vérifier session

### Appels
- `GET /api/calls/history` - Historique
- `GET /api/calls/active` - Appels en cours
- `POST /api/calls/dial` - Click-to-Call
- `GET /api/calls/missed` - Appels manqués

### Contacts Odoo
- `GET /api/odoo/contacts/:id` - Détails contact
- `GET /api/odoo/contacts/:id/history` - Historique appels
- `POST /api/odoo/contacts` - Créer contact
- `PUT /api/odoo/contacts/:id` - Modifier contact
- `GET /api/odoo/search?q=` - Recherche

### Webhooks
- `GET /api/webhooks` - Liste tokens
- `POST /api/webhooks` - Créer token
- `DELETE /api/webhooks/:token` - Supprimer

### Config
- `GET /api/config` - Configuration actuelle
- `POST /api/config/ucm` - Modifier config UCM
- `POST /api/config/odoo` - Modifier config Odoo

## 🐳 Docker

### Démarrer
```bash
docker compose up -d
```

### Voir les logs
```bash
docker compose logs -f
```

### Redémarrer
```bash
docker compose restart
```

### Arrêter
```bash
docker compose down
```

## 🧪 Tests

```bash
# Tests unitaires
npm test

# Test d'un webhook
curl "http://localhost:3000/webhook/TOKEN?event=ring&caller=0612345678&exten=1001&uniqueid=test123"

# Test recherche Odoo
curl http://localhost:3000/api/odoo/search?q=Dupont -H "X-Session-Token: TOKEN"
```

## 📊 Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `UCM_MODE` | Mode de connexion (webhook/websocket) | `webhook` |
| `UCM_HOST` | IP/hostname UCM | `localhost` |
| `UCM_WEB_PORT` | Port web UCM | `8089` |
| `UCM_WEB_USER` | Utilisateur web UCM | `admin` |
| `UCM_WEB_PASSWORD` | Mot de passe web UCM | - |
| `ODOO_URL` | URL Odoo | - |
| `ODOO_DB` | Base de données Odoo | - |
| `ODOO_USERNAME` | Utilisateur Odoo | - |
| `ODOO_API_KEY` | Clé API Odoo | - |
| `SERVER_PORT` | Port HTTP | `3000` |
| `DB_PATH` | Chemin SQLite | `/app/data/middleware.db` |
| `LOG_LEVEL` | Niveau de log | `info` |

## 🔒 Sécurité

- Sessions avec tokens (8h de validité)
- Mots de passe jamais exposés
- HTTPS requis en production
- Firewall rules recommandées
- Rate limiting sur l'API

## 📝 Logs

Les logs sont dans :
- `logs/middleware-YYYY-MM-DD.log`
- Console Docker

Niveaux : error, warn, info, debug

## 🆘 Support

En cas de problème :

1. Vérifie les logs : `docker compose logs`
2. Teste la connectivité UCM : `curl -k https://IP_UCM:8089/api`
3. Teste Odoo : `curl https://ODOO_URL`
4. Vérifie le healthcheck : `curl http://localhost:3000/health`

## 📄 Licence

MIT - Selest Informatique 2026
