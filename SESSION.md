# Session de développement - UCM-Odoo Middleware

**Dates** : 10-11 Mars 2026
**Objectif** : Middleware CTI type Ringover entre UCM6300 et Odoo

---

## ✅ Tâches accomplies - 11 Mars 2026

### 1. Intégration UCM6300 HTTP API
- [x] Création `UcmHttpClient.js` - Authentification challenge/response MD5
- [x] Gestion cookie de session (10 min)
- [x] Reconnexion automatique avec backoff exponentiel
- [x] Support TLS/HTTPS avec validation certificats
- [x] Méthodes implémentées :
  - `connect()` - Authentification
  - `request(action, params)` - Requêtes API
  - `getSystemStatus()` - Statut système
  - `listExtensions()` - Liste extensions
  - `dialExtension()`, `dialOutbound()` - Appels
  - `hangup()`, `acceptCall()`, `refuseCall()` - Gestion appels
  - `callTransfer()` - Transfert

### 2. Intégration UCM6300 WebSocket
- [x] Création `UcmWebSocketClient.js` - Événements temps réel
- [x] Mapping événements UCM → format interne
- [x] Heartbeat (ping/pong) 30s
- [x] Reconnexion automatique
- [x] Événements supportés :
  - `call:incoming` - Appel entrant
  - `call:answered` - Décroché
  - `call:hangup` - Raccroché
  - `call:hold`, `call:unhold` - Mise en attente
  - `call:transfer` - Transfert

### 3. Mise à jour infrastructure
- [x] `config/index.js` - TLS + username/password UCM6300
- [x] `index.js` - Connexion HTTP + WebSocket
- [x] `application/CallHandler.js` - Gestion événements WebSocket
- [x] `presentation/api/router.js` - Healthcheck + statut
- [x] `.env` - Credentials UCM6300 :
  ```
  UCM_MODE=websocket
  UCM_HOST=192.168.10.100
  UCM_WEB_PORT=8089
  UCM_API_USER=fred_admin
  UCM_API_PASS=FtCQS3Zt2jqes1
  UCM_TLS_REJECT_UNAUTHORIZED=false
  ```
- [x] `docker-compose.override.yml` - Montage .env

### 4. Architecture finale

```
ucm-odoo-middleware/
├── src/
│   ├── index.js                          # Point d'entrée
│   ├── config/
│   │   ├── index.js                      # Configuration
│   │   └── swagger.js                    # Documentation API
│   ├── logger.js                         # Winston logs
│   ├── infrastructure/
│   │   ├── ucm/
│   │   │   ├── UcmHttpClient.js          # HTTP API (challenge/response) ✨
│   │   │   └── UcmWebSocketClient.js     # WebSocket événements ✨
│   │   ├── odoo/
│   │   │   └── OdooClient.js             # Client XML-RPC Odoo
│   │   ├── websocket/
│   │   │   └── WsServer.js               # Serveur WS agents
│   │   └── database/
│   │       ├── CallHistory.js            # Historique SQLite
│   │       └── schema.sql                # Schéma BDD
│   ├── application/
│   │   ├── CallHandler.js                # Orchestration appels
│   │   └── WebhookManager.js             # Tokens webhooks
│   └── presentation/
│       ├── api/
│       │   └── router.js                 # Routes API REST
│       └── admin/
│           └── index.html                # Interface admin
├── docker-compose.yml
├── docker-compose.override.yml
├── Dockerfile
├── package.json
├── .env                                  # ✨ Mis à jour
├── .env.example
├── README.md
└── SESSION.md                            # Ce fichier
```

---

## 📊 État actuel (11 Mars 2026 15:30)

| Composant | Statut | Détails |
|-----------|--------|---------|
| **Middleware** | ✅ UP | Port 3000 |
| **Odoo** | ✅ Connecté | uid:2 |
| **UCM HTTP API** | ✅ Authentifié | Cookie valide 10 min |
| **UCM WebSocket** | ✅ Connecté | `/websockify`, keep-alive 15s |
| **Webhooks HTTP** | ✅ Prêts | 2 tokens configurés |
| **Interface Admin** | ✅ Accessible | https://ucm.selest.info/admin |

---

## 🔧 Configuration UCM6300 appliquée

### API HTTPS
- ✅ **Enable API** : Activé
- ✅ **Username** : `fred_admin`
- ✅ **Password** : `FtCQS3Zt2jqes1`
- ✅ **IP Allowlist** : Désactivé
- ✅ **Port** : 8089

### Authentification
```
Challenge: 0000001034408791
Token: MD5(challenge + password)
Cookie: sid2098382197-... (valable 10 min)
```

---

## ✅ Problème résolu (11 Mars 2026)

### WebSocket UCM6300 - Résolu

**Symptôme** :
```
UCM WS: connexion en cours {url:"wss://192.168.10.100:8089/ws"}
UCM WS: erreur {error:"Unexpected server response: 400"}
```

**Causes possibles** :
1. Endpoint WebSocket incorrect (`/ws` peut-être différent)
2. Authentification WebSocket requise (cookie nécessaire)
3. WebSocket non supporté sur cette version UCM6300
4. Configuration API incomplète dans l'UCM

**Solutions à tester** :
1. Vérifier dans l'UCM : `Integrations` → `API Configuration` → `WebSocket Settings`
2. Tester avec cookie d'authentification
3. Utiliser webhooks HTTP à la place (fallback)

---

## 📋 Actions pour prochaine session

### 1. Résoudre WebSocket (priorité haute)
- [ ] Vérifier endpoint WebSocket dans doc UCM6300
- [ ] Tester avec authentification cookie
- [ ] Ou configurer webhooks HTTP

### 2. Configurer webhooks HTTP (fallback)
- [ ] Créer token webhook dans middleware
- [ ] Configurer Action URLs dans UCM6300 :
  - Ring : `https://ucm.selest.info/webhook/TOKEN?event=ring&caller=$F1&exten=$F2&uniqueid=$F3`
  - Answer : `https://ucm.selest.info/webhook/TOKEN?event=answer&caller=$F1&exten=$F2&uniqueid=$F3`
  - Hangup : `https://ucm.selest.info/webhook/TOKEN?event=hangup&caller=$F1&exten=$F2&uniqueid=$F3&duration=$F4`

### 3. Tests fonctionnels
- [ ] Passer un appel → Vérifier popup contact
- [ ] Click-to-call → Vérifier appel sortant
- [ ] Recherche contact → Vérifier affichage Odoo
- [ ] Créer contact → Vérifier persistence Odoo

---

## 📝 Notes importantes

### Fichiers clés
- **SESSION.md** : À relire en priorité
- **.env** : Credentials UCM + Odoo
- **data/config.json** : Config persistante (créé automatiquement)
- **logs/middleware-YYYY-MM-DD.log** : Logs applicatifs

### Commandes utiles
```bash
# Redémarrer middleware
docker compose -f /opt/stacks/ucm-odoo-middleware/docker-compose.yml restart

# Voir logs
docker logs ucm_odoo_middleware_dev -f

# Tester healthcheck
curl https://ucm.selest.info/health

# Tester API UCM
curl -sk -X POST "https://192.168.10.100:8089/api" \
  -H "Content-Type: application/json" \
  -d '{"request":{"action":"challenge","user":"fred_admin","version":"1.0"}}'

# Tester WebSocket (si wscat installé)
wscat -c "wss://192.168.10.100:8089/ws"
```

### Credentials (NE PAS COMMITER)
```
UCM6300:
  Host: 192.168.10.100:8089
  User: fred_admin
  Pass: FtCQS3Zt2jqes1

Odoo:
  URL: https://selest-informatique.odoo.com
  DB: selest-informatique
  User: contact@selest.info
  API Key: f0b18bc8cd6ef0dc17a7098b6226155273d3b09a
```

---

## 🎯 Résumé pour reprise

**Ce qui marche** :
- ✅ Middleware démarré et stable
- ✅ Odoo connecté et fonctionnel
- ✅ UCM HTTP API authentifiée (commandes possibles)
- ✅ Webhooks HTTP configurés (2 tokens)
- ✅ Interface admin accessible

**Ce qui reste à faire** :
- ❌ WebSocket UCM6300 (échec 400) → Utiliser webhooks HTTP en attendant
- ❌ Tests appels entrants/sortants
- ❌ Validation flux complet avec contacts Odoo

**Première action à la reprise** :
1. Relire ce fichier SESSION.md
2. Configurer webhooks HTTP dans UCM6300 (plus rapide que déboger WebSocket)
3. Tester un appel entrant

---

**Dernière mise à jour** : 11 Mars 2026 00:45 UTC+1
**Prochaine session** : À planifier
