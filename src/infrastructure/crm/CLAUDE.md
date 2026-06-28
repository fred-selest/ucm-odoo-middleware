# infrastructure/crm/ — Factory pattern CRM

## Architecture

```
CrmFactory.create() → OdooAdapter | DolibarrAdapter
                    ↳ CrmClientInterface (contrat commun)
```

## Fichiers

| Fichier | Rôle |
|---------|------|
| `CrmFactory.js` | Factory — choisit l'adapter selon `CRM_TYPE` |
| `CrmClientInterface.js` | Interface abstraite — contrat que tous les adapters respectent |
| `adapters/OdooAdapter.js` | XML-RPC → Odoo 19 |
| `adapters/DolibarrAdapter.js` | REST → Dolibarr |

## CrmFactory.js

```javascript
const crmClient = CrmFactory.create();  // selon CRM_TYPE
```

**Variable d'environnement :**
- `CRM_TYPE=odoo|dolibarr` (défaut: `odoo`)

## Interface normalisée (CrmClientInterface)

### Contact normalisé
```javascript
{
  id, name, phone, email, company, companyId, isCompany,
  function, street, zip, city, country, website, comment,
  crmUrl, avatar
}
```

### CallActivityData
```javascript
{ direction, status, duration, callerIdNum, exten, timestamp }
```

## OdooAdapter

- Auth: XML-RPC `execute_kw`
- Contact lookup: `res.partner` — champ `phone` uniquement (⚠️ Odoo 19 SaaS rule)
- Write format: `[[id], {fields}]` (⚠️ Odoo 19 SaaS rule)
- `message_post`: texte brut uniquement

## DolibarrAdapter

- Auth: API token via `DOLAPIKEY`
- Endpoints: `/api/index.php/...`

## ⚠️ Règles Odoo 19 SaaS

1. **Recherche contacts** : champ `phone` uniquement (jamais `mobile`)
2. **`write` sur `res.partner`** : `[[id], {fields}]` — dict séparé, pas imbriqué
3. **`message_post`** : texte brut uniquement (pas de HTML)
4. **Avatar** : base64 via `image_128` (pas d'URL)