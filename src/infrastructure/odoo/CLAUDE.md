# infrastructure/odoo/ — Client Odoo XML-RPC

## ⚠️ AVERTISSEMENT CRITIQUE — NE PAS MODIFIER CES PATTERNS

Les formats et champs ci-dessous sont validés en production sur **Odoo 19 SaaS**. Toute modification risque de casser l'intégration silencieusement ou de provoquer des erreurs côté Odoo.

---

## OdooClient.js

Client XML-RPC pour Odoo 19 SaaS (`selest-informatique.odoo.com`).

### Authentification

```javascript
// Authentification par clé API (pas mot de passe)
uid = await client.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {})
// uid est mis en cache dans this._uid
// Re-auth automatique si "Access Denied" ou session expirée
```

### ⚠️ Recherche de contact — format IMPOSÉ

```javascript
// ✅ SEUL format valide pour rechercher un contact par téléphone
// Seul le champ 'phone' est utilisé — 'mobile' n'existe PAS en Odoo 19 SaaS

const variants = generatePhoneVariants(callerIdNum);
// Génère : '0679293871', '+33679293871', '0033679293871', avec espaces, points, tirets...

const domain = variants.flatMap(v => ['|', ['phone', 'like', v]]).slice(1);
// Exemple résultat :
// ['|', ['phone','like','0679293871'], '|', ['phone','like','+33679293871'], ...]
```

### ⚠️ Format `write` — ordre des arguments IMPOSÉ

```javascript
// ✅ CORRECT — args = [[contactId], valuesObject]
await execute_kw(db, uid, api_key, 'res.partner', 'write',
  [[contactId], { name: "Nouveau nom", phone: "0612345678" }]
)

// ❌ INTERDIT — cause TypeError "unhashable type: list" côté Odoo
await execute_kw(db, uid, api_key, 'res.partner', 'write',
  [[contactId, { name: "..." }]]
)
```

### ⚠️ Format `message_post` — TEXTE BRUT uniquement

```javascript
// ✅ CORRECT — plain text avec \n pour les sauts de ligne
await execute_kw(db, uid, api_key, 'res.partner', 'message_post',
  [[partnerId]],
  {
    body: "📞 Appel entrant — Décroché\nDurée : 2min 15s\nDe : 0679293871\nVers : poste 101",
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_note'
  }
)

// ❌ INTERDIT — Odoo 19 SaaS échappe le HTML via XML-RPC execute_kw
// "<p>texte</p>" s'affiche "&lt;p&gt;texte&lt;/p&gt;" dans le chatter
body: "<p>Appel entrant</p>"
body: "Ligne 1<br>Ligne 2"
body: "<b>Décroché</b>"
```

### ⚠️ Champs `res.partner` — liste validée

```
✅ Lecture : id, name, phone, email, parent_id, is_company
✅ Lecture : street, zip, city, country_id, function, comment, website
✅ Lecture : image_128  (base64 PNG — NE PAS utiliser /web/image/... URL)
✅ Écriture : name, phone, email, street, zip, city, function, comment

❌ 'mobile' — N'EXISTE PAS en Odoo 19 SaaS (pas dans res.partner standard)
❌ URL image : /web/image/res.partner/ID/image_128 — nécessite session Odoo active
```

### ⚠️ Image avatar — base64 uniquement

```javascript
// ✅ CORRECT — image_128 retourne une chaîne base64
const avatar = contact.image_128
  ? `data:image/png;base64,${contact.image_128}`
  : null;

// ❌ INTERDIT — cette URL n'est accessible que depuis une session Odoo active
const avatarUrl = `/web/image/res.partner/${id}/image_128`;
// → 401 Unauthorized depuis le middleware
```

---

## Méthodes publiques

| Méthode | Description |
|---------|-------------|
| `findContactByPhone(phone)` | Recherche par téléphone (cache 5min) — retourne `{ id, name, phone, email, company, odooUrl, avatar }` ou `null` |
| `getContactById(id)` | Contact complet avec tous les champs |
| `searchContactsByNameOrCompany(q, limit)` | Recherche textuelle (nom ou société) |
| `createContact(data)` | Crée un `res.partner` |
| `updateContact(id, data)` | Modifie un `res.partner` — utilise le format `[[id], data]` |
| `addContactNote(id, note)` | Poste une note dans le chatter (texte brut) |
| `getContactMessages(id, limit)` | Récupère l'historique chatter (`mail.message`) |
| `logCallActivity(partnerId, callData)` | Log auto d'un appel dans le chatter (fire-and-forget) |
| `invalidateCache(phone)` | Vide le cache (null = tout vider) |
| `ensureAuthenticated()` | Re-auth si `_uid` est null ou expiré |

## URL Odoo des fiches contact

```javascript
// Format validé pour les liens "Ouvrir dans Odoo"
const odooUrl = `${ODOO_URL}/odoo/contacts/${contact.id}`;
```

## Modèles Odoo utilisés

| Modèle | Usage |
|--------|-------|
| `res.partner` | Contacts — lecture, écriture, message_post |
| `mail.message` | Historique chatter — lecture uniquement |

## Gestion des erreurs

- `Access Denied` / `Session expired` → reset `_uid`, re-auth automatique
- Timeout (8s par défaut) → erreur propagée vers l'appelant
- Contact non trouvé → retourne `null` (pas d'exception)
