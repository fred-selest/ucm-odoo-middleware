# UCM ↔ Odoo Middleware — Guide IA

Middleware Node.js qui écoute les événements d'appels du PABX Grandstream UCM6300, recherche les contacts dans Odoo 19 SaaS, et pousse des notifications temps-réel au navigateur.

## Stack

- **Runtime** : Node.js 20 (Docker, port 3000, container `ucm_odoo_middleware`)
- **PABX** : Grandstream UCM6300 — IP `192.168.10.100`, port `8089` (HTTPS + WS)
- **Odoo** : `https://selest-informatique.odoo.com` / db `selest-informatique`
- **BDD** : SQLite (`/app/data/middleware.db`)
- **Déploiement** : `docker compose build --no-cache && docker compose up -d --force-recreate`

## Architecture en 3 mots

```
UCM6300 → CallHandler → WsServer → navigateur
                ↕
           OdooClient (XML-RPC)
           CallHistory (SQLite)
```

## Répertoires

```
src/
├── config/           Variables d'environnement et config runtime
├── application/      CallHandler (orchestration), WebhookManager
├── infrastructure/
│   ├── ucm/          Clients UCM (WebSocket + HTTP)
│   ├── odoo/         Client XML-RPC Odoo — ⚠️ NE PAS MODIFIER LES CHAMPS QUI FONCTIONNENT
│   ├── websocket/    Serveur WS pour le navigateur
│   ├── database/     SQLite : schéma, CRUD, CDR sync
│   └── monitoring/   HealthAgent (supervision 30s)
└── presentation/
    ├── api/          Routes Express REST
    └── admin/        Interface admin (HTML + JS vanilla)
```

## ⚠️ Variables Odoo — NE PAS TOUCHER

Ces formats sont validés en production sur Odoo 19 SaaS. Toute modification casse l'intégration.

### 1. Recherche de contacts — champ `phone` uniquement

```javascript
// ✅ CORRECT — uniquement le champ 'phone'
['phone', 'like', '0679293871']

// ❌ INTERDIT — 'mobile' n'existe PAS en Odoo 19 SaaS
['mobile', 'like', '...']
```

### 2. Format `write` sur `res.partner`

```javascript
// ✅ CORRECT
execute_kw(db, uid, key, 'res.partner', 'write', [[contactId], {name: "..."}])

// ❌ INTERDIT — cause "unhashable type: list"
execute_kw(db, uid, key, 'res.partner', 'write', [[contactId, {...}]])
```

### 3. Format `message_post` — texte brut uniquement

```javascript
// ✅ CORRECT — Odoo 19 SaaS échappe le HTML envoyé via XML-RPC
body: "📞 Appel entrant — Décroché\nDurée : 2min\nDe : 0679293871"

// ❌ INTERDIT — balises affichées littéralement (&lt;p&gt;)
body: "<p>Appel entrant</p>"
body: "Ligne 1<br>Ligne 2"
```

### 4. Avatar — base64 uniquement (pas d'URL)

```javascript
// ✅ CORRECT
image_128  // retourne base64 → data:image/png;base64,...

// ❌ INTERDIT — nécessite session Odoo inaccessible depuis le middleware
`/web/image/res.partner/${id}/image_128`
```

### 5. Champs validés sur `res.partner`

```
✅ id, name, phone, email
✅ parent_id (retourne [company_id, company_name] ou false)
✅ is_company, street, zip, city, country_id
✅ function, comment, website, image_128
❌ mobile (n'existe PAS)
```

## Déploiement

```bash
# Rebuild complet obligatoire (restart ne prend pas le nouveau image)
sg docker -c "docker compose build --no-cache && docker compose up -d --force-recreate"

# Logs temps réel
sg docker -c "docker logs -f ucm_odoo_middleware"
```

## Logs clés à surveiller

- `UCM WS: souscription ExtensionStatus OK` → WS UCM opérationnel
- `Appel entrant` → call détecté
- `Odoo: contact trouvé` → recherche Odoo réussie
- `HealthAgent: Aucun appel depuis` → warning normal hors heures de bureau
