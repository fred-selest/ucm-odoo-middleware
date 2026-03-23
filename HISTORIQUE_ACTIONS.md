# Historique des Actions - Récapitulatif

**Date de génération** : 17 mars 2026
**Heure** : 21:35 UTC
**Dernière MAJ** : 18 mars 2026 08:10 UTC

---

## Projets Actifs

### 1. UCM ↔ Odoo Middleware (`/opt/stacks/ucm-odoo-middleware`)

**Statut** : ✅ OPÉRATIONNEL

| Information | Valeur |
|-------------|--------|
| Conteneur | `ucm_odoo_middleware` |
| Statut | Up (healthy) |
| Port exposé | 3000 |
| Connexion UCM | ✅ HTTP API + WebSocket (UCM6300) |
| GitHub | github.com/fred-selest/ucm-odoo-middleware |

**Fonctionnalités** :
- Connexion HTTP API + WebSocket au PBX Grandstream UCM6300
- Recherche automatique de contacts dans Odoo
- Journal d'appels avec filtres, pagination, stats et export CSV
- Synchronisation historique avec chatter Odoo + photo contact
- Click-to-call, statuts agents, notes/tags
- Diffusion WebSocket temps réel vers les agents
- Interface d'administration web avec Swagger (/api-docs)
- Historique des appels en base SQLite

**Corrections du 17 mars 2026 — Bugs dead code** :
- `router.js` : 7 routes récupérées (contacts, stats/today, stats/summary, api/calls, agents enrichi)
- `UcmHttpClient.js` : 11 méthodes récupérées (recordings + queues)
- `CallHistory.js` : 4 méthodes récupérées (updateCallsForPhone, cacheContact, searchContacts, getUniqueContacts)
- Queues router monté sur `/api/queues`

**Dashboard admin — nouveautés du 17 mars 2026** :
- Nouvel onglet **Dashboard** (entre Live et Historique)
  - 6 KPI cards : total, décroché, manqué, taux, durée moy., durée totale
  - Graphique horaire (barres) + donut décroché/manqué
  - Panel agents (statut temps réel)
  - Appels récents depuis la BDD
  - Enregistrements récents
- `dashboard.js` réécrit : utilise `apiFetch()` (auth token automatique)

**Endpoints actifs (tous testés 17/03/2026)** :

| Catégorie | Routes |
|-----------|--------|
| Public | `GET /health`, `GET /status`, `POST /api/odoo/test` |
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` |
| Historique | `GET /api/calls`, `GET /api/calls/history`, `GET /api/calls/missed`, `GET /api/calls/active` |
| Stats | `GET /api/stats?period=`, `GET /api/stats/today`, `GET /api/stats/summary`, `GET /api/stats/extensions`, `GET /api/stats/hourly`, `GET /api/stats/top-callers` |
| Contacts | `GET /api/contacts`, `GET /api/odoo/search`, `GET /api/odoo/contacts/:id`, `POST /api/contacts/sync-partner`, `POST /api/contacts/sync` |
| Blacklist | `GET/POST/DELETE /api/blacklist`, `GET /api/blacklist/check/:phone` |
| UCM | `GET /api/extensions`, `POST /api/calls/sync-cdr` |
| Agents | `GET /api/agents/status`, `GET/PUT /api/agents/:exten/status`, `GET /api/agents/:exten/active-calls` |
| Queues | `GET /api/queues` (⚠️ fred_admin sans permission UCM queues) |
| Recordings | `GET /api/recordings` |
| Config | `GET /api/config`, `POST /api/config/ucm`, `POST /api/config/odoo` |
| WebSocket | `GET /api/ws/clients`, `POST /api/ws/broadcast` |
| Webhooks | `GET/POST/DELETE /api/webhooks` |

**Données en base** :
- 213 appels total historique (17/03/2026)
- 22 appels aujourd'hui (9% répondu)

---

### 2. Odoo VoIP — FreeSWITCH WebRTC Gateway

#### 2a. Sip-proxy (`/opt/stacks/odoo-voip-ucm`)

**Statut** : ✅ OPÉRATIONNEL (forward → FreeSWITCH)

| Information | Valeur |
|-------------|--------|
| Conteneur | `odoo_voip_sip_proxy` |
| Port exposé | 3001 |
| Fonction | Proxy SIP WebSocket : navigateur → FreeSWITCH:5066 |

#### 2b. FreeSWITCH WebRTC Gateway (`/opt/stacks/freeswitch-webrtc`)

**Statut** : ✅ RUNNING — UCM trunk enregistré

| Information | Valeur |
|-------------|--------|
| Conteneur | `freeswitch_webrtc` |
| Réseau | bridge + proxy-net |
| Ports | 5060 UDP/TCP, 5080 UDP/TCP, 5066 TCP (WS), 7443 TCP (WSS), 16384-16484 UDP (RTP) |
| Domain | `sip.selest.info` |
| Extension Odoo | 1000 / `wC3~SS~018dn9` |
| Compte trunk UCM | `ucmtrunk` / `SelestTrunk2026!` |

**Architecture finale (reverse trunk sans VPN)** :
```
Odoo VoIP (SIP.js browser)
    ↓ wss://sip.selest.info/ws  (via NPM SSL)
Nginx Proxy Manager  →  freeswitch_webrtc:5066
    ↑ SIP Register Trunk (UCM → FreeSWITCH port 5060)
Grandstream UCM6300 (SIP trunk sortant)
```

**Fichiers** :
- `docker-compose.yml` — Bridge network + proxy-net + ports exposés
- `Dockerfile` — Image safarov/freeswitch + entrypoint custom
- `entrypoint.sh` — Copie configs custom + patchs (ACL, WS binding, ESL, signalwire)
- `conf/vars.xml` — Domain, IPs, codecs, RTP range
- `conf/1000.xml` — Extension Odoo (user_context=default)
- `conf/ucm-trunk.xml` — Compte trunk UCM (user id=ucmtrunk, user_context=from_ucm)
- `conf/ucm-gateway.xml` — Gateway sortant vers UCM (register=false / NOREG)
- `conf/dialplan-ucm.xml` — Appels sortants Odoo → UCM via gateway
- `conf/dialplan-inbound.xml` — Contexte public : transfère vers default
- `conf/dialplan-from-ucm.xml` — Contexte from_ucm : appels entrants UCM → extension 1000

**UCM config** :
- VoIP Trunk > Register Trunk : server=`62.171.187.65`, port=5060, user=`ucmtrunk`, pass=`SelestTrunk2026!`
- Statut FreeSWITCH : `ucmtrunk` REGISTERED ✅

**Config Odoo VoIP** :
- Fournisseur : `ws_server = wss://sip.selest.info/ws`, `pbx_ip = sip.selest.info`
- Utilisateur 2 : `voip_username = 1000`, `voip_secret = wC3~SS~018dn9`

**Patchs appliqués dans entrypoint.sh** :
- `mod_signalwire` désactivé (pas de cert SSL Debian, bloque le démarrage)
- ESL : bind `::` → `127.0.0.1` (IPv6 absent en mode bridge)
- WS binding : `:5066` → `0.0.0.0:5066` (accès multi-interfaces)
- ACL `apply-inbound-acl` : supprimée (WebRTC clients auth par password SIP)

**Problème en cours** : Odoo affiche "408 Request Timeout" lors du SIP REGISTER.
- FreeSWITCH reçoit les REGISTER SIP via WebSocket et répond 401 ✅ (prouvé Python direct et via sip-proxy)
- Via NPM WSS complet (sip.selest.info:443), le 401 ne revient pas au client ✗
- Le problème est dans le proxy NPM : les WebSocket frames passent en aller mais pas en retour
- En cours d'investigation : NPM → FreeSWITCH direct (bypass sip-proxy)

**Ports à ouvrir chez Contabo** :
- 5060 UDP + TCP (SIP)
- 5080 UDP + TCP (SIP externe)
- 16384-16484 UDP (RTP audio)

---

### 3. Telecom CDR Dashboard (`/opt/stacks/telecom-cdr`)

**Statut** : ✅ OPÉRATIONNEL

| Information | Valeur |
|-------------|--------|
| Conteneur | `selest_webapp` |
| Port exposé | 5000 (localhost uniquement) |
| Base de données | SQLite |

---

### 4. Agent Dolibarr (`/home/fred/dolibarr-agent`)

**Statut** : ✅ OPÉRATIONNEL — processus Node.js actif sur port 4000

| Information | Valeur |
|-------------|--------|
| Processus | `node server.js` (démarrage manuel) |
| Port | 4000 |
| Fichiers clés | `server.js`, `agent.js`, `.env` |

**Variables `.env`** :
```
DOLIBARR_PASSWORD=Admin2026!
MIDDLEWARE_URL=http://localhost:3000
MIDDLEWARE_USER=contact@selest.info
```
