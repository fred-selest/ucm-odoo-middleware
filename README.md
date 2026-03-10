# UCM ↔ Odoo Middleware

Middleware Node.js qui fait le lien entre un **IPBX Grandstream UCM** et **Odoo**. Il capte les événements téléphoniques (appel entrant, décroché, raccroché) et recherche automatiquement le contact correspondant dans Odoo pour l'afficher aux agents en temps réel.

---

## Fonctionnalités

- **Deux modes de connexion UCM** :
  - **AMI** (Asterisk Manager Interface) — port 5039 TLS, nécessite un accès réseau direct ou VPN
  - **WebSocket** — port 8089 HTTPS, fonctionne sans VPN (idéal pour les clients distants)
- **Action URL / Webhook** — le middleware peut recevoir des événements UCM via simple requête HTTP GET, sans aucune infrastructure réseau particulière
- **Recherche de contact Odoo** — identification automatique du correspondant par numéro de téléphone, avec prise en charge de tous les formats (local, international, espaces, points…)
- **Diffusion WebSocket** — les informations d'appel sont poussées en temps réel vers les agents connectés
- **Interface d'administration** — tableau de bord web pour surveiller l'activité et configurer tous les paramètres sans redémarrer
- **Configuration persistante** — les réglages effectués via l'interface sont sauvegardés et survivent aux redémarrages
- **Multi-clients webhook** — chaque client UCM dispose de son propre token sécurisé

---

## Architecture

```
Grandstream UCM
  ├── AMI (TLS:5039)  ──────────────────────┐
  ├── WebSocket (HTTPS:8089)  ───────────────┤
  └── Action URL (HTTP GET)  ────────────────┤
                                             ▼
                                   ┌─────────────────┐
                                   │   Middleware     │
                                   │   Node.js        │
                                   │                  │
                                   │  CallHandler     │
                                   │  OdooClient      │
                                   │  WsServer        │
                                   └────────┬─────────┘
                                            │
                          ┌─────────────────┴─────────────────┐
                          ▼                                     ▼
                   Odoo (XML-RPC)                    Agents (WebSocket)
                   Recherche contact                 Popups d'appel
```

---

## Installation

### Prérequis

- Docker et Docker Compose
- Réseau Docker partagé `proxy-net` (ou adapter `docker-compose.yml`)
- Instance Odoo avec une clé API

### Configuration

Copiez le fichier d'exemple et renseignez vos paramètres :

```bash
cp .env.example .env
nano .env
```

Variables principales :

| Variable | Description | Défaut |
|---|---|---|
| `UCM_MODE` | Mode de connexion : `ami` ou `websocket` | `ami` |
| `UCM_HOST` | Adresse IP ou hostname de l'UCM | `localhost` |
| `UCM_AMI_PORT` | Port AMI (TLS) | `5039` |
| `UCM_AMI_USERNAME` | Nom d'utilisateur AMI | `admin` |
| `UCM_AMI_SECRET` | Secret AMI | — |
| `UCM_WEB_PORT` | Port interface web UCM (mode WebSocket) | `8089` |
| `UCM_WEB_USER` | Utilisateur interface web UCM | — |
| `UCM_WEB_PASSWORD` | Mot de passe interface web UCM | — |
| `ODOO_URL` | URL de l'instance Odoo | — |
| `ODOO_DB` | Nom de la base de données Odoo | — |
| `ODOO_USERNAME` | Email du compte Odoo | — |
| `ODOO_API_KEY` | Clé API Odoo | — |
| `SERVER_PORT` | Port HTTP du middleware | `3000` |

### Démarrage

```bash
docker compose up -d
```

---

## Interface d'administration

Accessible sur `http://localhost:3000/admin` (ou via votre domaine).

Authentification avec les identifiants Odoo (email + mot de passe).

**Fonctionnalités de l'interface :**

- Statut de la connexion UCM et Odoo en temps réel
- Journal d'appels avec identification des contacts
- Recherche manuelle d'un contact par numéro de téléphone
- Configuration UCM et Odoo sans redémarrage
- Gestion des clients webhook (création, URLs à copier dans l'UCM, test de connectivité)
- Logs en direct avec filtrage par niveau

---

## Mode Webhook (Action URL)

Ce mode permet à l'UCM d'envoyer les événements d'appel au middleware via de simples requêtes HTTP GET. Aucun VPN ni ouverture de port vers le réseau interne n'est nécessaire — c'est l'UCM qui initie la connexion vers le middleware exposé sur Internet.

### Configuration dans l'UCM

1. Dans l'interface admin du middleware, créez un **client webhook** et copiez les trois URLs générées
2. Dans l'UCM, allez dans **Paramètres → Intégration → Action URL**
3. Collez les URLs dans les champs correspondants :
   - **Appel entrant (Ring)** → URL Ring
   - **Décroché (Answer)** → URL Answer
   - **Raccroché (Hangup)** → URL Hangup

Les URLs utilisent les variables UCM standard : `${CALLERID(num)}`, `${EXTEN}`, `${UNIQUEID}`, `${CALLERID(name)}`.

---

## API WebSocket (agents)

Les agents se connectent en WebSocket sur `ws(s)://votre-domaine/ws`.

**Messages reçus :**

```json
{ "type": "call:incoming", "data": { "callerIdNum": "0388...", "exten": "101", "uniqueId": "..." } }
{ "type": "call:answered", "data": { ... } }
{ "type": "call:hangup",   "data": { "duration": 42, ... } }
{ "type": "contact",       "data": { "uniqueId": "...", "contact": { "name": "...", "phone": "...", "email": "...", "odooUrl": "..." } } }
```

**Souscription à des extensions spécifiques :**

```json
{ "type": "subscribe", "extensions": ["101", "102"] }
```

---

## API REST - Recherche de contacts

### Recherche par numéro de téléphone

```bash
curl -X POST http://localhost:3000/api/odoo/test \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: votre-token" \
  -d '{"phone": "0388588621"}'
```

### Recherche par nom ou société

```bash
# Recherche simple
curl "http://localhost:3000/api/odoo/search?q=Dupont" \
  -H "X-Session-Token: votre-token"

# Avec limite de résultats
curl "http://localhost:3000/api/odoo/search?q=Selest&limit=10" \
  -H "X-Session-Token: votre-token"
```

**Réponse :**

```json
{
  "ok": true,
  "query": "Dupont",
  "count": 3,
  "data": [
    {
      "id": 42,
      "name": "Jean Dupont",
      "phone": "0388588621",
      "mobile": "0612345678",
      "email": "jean.dupont@example.com",
      "company": "Selest",
      "isCompany": false,
      "function": "Directeur",
      "street": "1 rue de la Paix",
      "city": "Strasbourg",
      "odooUrl": "https://odoo.example.com/odoo/contacts/42"
    }
  ]
}
```

---

## Licence

MIT

---

*Développé pour connecter les environnements téléphoniques Grandstream UCM aux instances Odoo.*
