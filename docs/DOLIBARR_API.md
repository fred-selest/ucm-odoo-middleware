# Documentation API REST Dolibarr — UCM-Middleware

> Version Dolibarr supportée : **17.0+**
> Ce document couvre tous les endpoints REST utilisés par l'adaptateur `DolibarrAdapter.js`.

---

## Sommaire

1. [Authentification](#1-authentification)
2. [Contacts (socpeople)](#2-contacts-socpeople--llx_socpeople)
3. [Entreprises (thirdparties)](#3-entreprises-thirdparties--llx_societe)
4. [Activités / Journal (agendaevents)](#4-activités--journal-agendaevents--llx_actioncomm)
5. [Syntaxe sqlfilters](#5-syntaxe-sqlfilters)
6. [Codes erreur](#6-codes-erreur)
7. [Configuration dans le middleware](#7-configuration-dans-le-middleware)
8. [Variables d'environnement](#8-variables-denvironnement)
9. [Exemples de requêtes](#9-exemples-de-requêtes)

---

## 1. Authentification

### Protocole

Dolibarr utilise une authentification **stateless** par clé API.
Il n'y a pas de session à créer : chaque requête porte la clé API dans un header.

```http
DOLAPIKEY: votre_clé_api_ici
Content-Type: application/json
Accept: application/json
```

### Générer une clé API

1. Se connecter à Dolibarr en tant qu'administrateur
2. Aller dans **Configuration → Utilisateurs → [votre utilisateur] → Modifier**
3. Section **API** → Cliquer sur **Générer une clé API**
4. Copier la clé générée

### Validation de la clé (health check)

```http
GET /api/index.php/status
DOLAPIKEY: votre_clé
```

**Réponse 200 :**
```json
{
  "success": { "code": 200, "message": "Dolibarr is running" },
  "version": "17.0.1"
}
```

**Réponse 401 :** Clé invalide ou module API non activé.

### Multi-entité (optionnel)

Pour les installations Dolibarr multi-sociétés :
```http
DOLAPIKEY: votre_clé
DOLAPIENTITY: 2
```

---

## 2. Contacts (socpeople) — `llx_socpeople`

> Un **contact** Dolibarr est une personne physique, éventuellement liée à une entreprise (thirdparty).

### 2.1 Lister les contacts

```http
GET /api/index.php/contacts
DOLAPIKEY: votre_clé
```

**Paramètres de query :**

| Paramètre | Type | Description |
|-----------|------|-------------|
| `limit` | int | Nombre de résultats (défaut : 100, max : 500) |
| `page` | int | Page 0-indexée pour la pagination |
| `sqlfilters` | string | Filtres SQL avancés (voir §5) |
| `sortfield` | string | Champ de tri (ex: `t.rowid`, `t.lastname`) |
| `sortorder` | string | `ASC` ou `DESC` |
| `thirdparty_ids` | string | Filtrer par IDs d'entreprises (virgule-séparé) |

**Exemple — Recherche par téléphone professionnel :**
```http
GET /api/index.php/contacts?sqlfilters=((t.phone:like:'%0612345678%') OR (t.phone_mobile:like:'%0612345678%') OR (t.phone_perso:like:'%0612345678%'))&limit=5
```

**Exemple — Recherche par nom :**
```http
GET /api/index.php/contacts?sqlfilters=((t.lastname:like:'%Dupont%') OR (t.firstname:like:'%Jean%'))&limit=20
```

### 2.2 Récupérer un contact par ID

```http
GET /api/index.php/contacts/{id}
DOLAPIKEY: votre_clé
```

### 2.3 Récupérer un contact par email

```http
GET /api/index.php/contacts/email/{email}
DOLAPIKEY: votre_clé
```

### 2.4 Créer un contact

```http
POST /api/index.php/contacts
DOLAPIKEY: votre_clé
Content-Type: application/json

{
  "lastname":   "Dupont",
  "firstname":  "Jean",
  "phone_pro":  "0123456789",
  "phone_mobile": "0612345678",
  "email":      "jean.dupont@example.com",
  "poste":      "Directeur commercial",
  "address":    "12 rue de la Paix",
  "zip":        "75001",
  "town":       "Paris",
  "country_id": 1,
  "socid":      42,
  "note_public": "Contact créé depuis UCM-Middleware",
  "statut":     1
}
```

**Réponse 200 :** `{ "id": 123 }` — ID du contact créé.

> ⚠️ `statut: 1` est requis pour que le contact soit actif.

### 2.5 Modifier un contact

```http
PUT /api/index.php/contacts/{id}
DOLAPIKEY: votre_clé
Content-Type: application/json

{
  "phone_pro":  "0987654321",
  "email":      "nouveau@example.com"
}
```

**Réponse 200 :** `{ "id": 123 }`

### 2.6 Supprimer un contact

```http
DELETE /api/index.php/contacts/{id}
DOLAPIKEY: votre_clé
```

### 2.7 Champs d'un contact (JSON)

| Champ API | Colonne DB | Type | Description |
|-----------|------------|------|-------------|
| `id` | `rowid` | int | Identifiant technique |
| `lastname` | `name` | varchar(50) | Nom de famille |
| `firstname` | `firstname` | varchar(50) | Prénom |
| `civility_id` | `civilite` | varchar(6) | Civilité (`MR`, `MME`, `DR`…) |
| `phone_pro` | `phone` | varchar(30) | **Téléphone professionnel** ← champ principal |
| `phone_mobile` | `phone_mobile` | varchar(30) | Téléphone mobile |
| `phone_perso` | `phone_perso` | varchar(30) | Téléphone personnel |
| `fax` | `fax` | varchar(30) | Fax |
| `email` | `email` | varchar(255) | Email |
| `poste` | `poste` | varchar(80) | Poste / Fonction |
| `address` | `address` | varchar(255) | Adresse postale |
| `zip` | `cp` | varchar(25) | Code postal |
| `town` | `ville` | varchar(255) | Ville |
| `country_id` | `fk_pays` | int | ID pays (table `llx_c_country`) |
| `country_code` | — | varchar(3) | Code pays ISO (ex: `FR`) |
| `socid` | `fk_soc` | int | **ID de l'entreprise liée** (thirdparty) |
| `statut` | `statut` | tinyint | 0=inactif, 1=actif |
| `note_public` | `note` (partiel) | text | Notes publiques |
| `note_private` | `note` (partiel) | text | Notes privées |
| `photo` | — | string | Nom du fichier photo |
| `birthday` | `birthday` | date | Date de naissance |
| `default_lang` | `default_lang` | varchar(6) | Langue par défaut |

> **Important :** Le champ `phone_pro` dans l'API correspond à la colonne `phone` dans la base de données. Les filtres sqlfilters utilisent `t.phone` (pas `t.phone_pro`).

---

## 3. Entreprises (thirdparties) — `llx_societe`

> Une **thirdparty** est une entité (client, fournisseur, prospect). Elle peut avoir des contacts (`socpeople`) liés via `socid`.

### 3.1 Lister les thirdparties

```http
GET /api/index.php/thirdparties
DOLAPIKEY: votre_clé
```

**Paramètres :**

| Paramètre | Type | Description |
|-----------|------|-------------|
| `limit` | int | Nombre de résultats |
| `page` | int | Page 0-indexée |
| `sqlfilters` | string | Filtres avancés |
| `sortfield` | string | Champ de tri (ex: `t.nom`) |
| `sortorder` | string | `ASC` ou `DESC` |
| `mode` | int | 1=clients uniquement, 2=prospects |

**Exemple — Recherche par téléphone :**
```http
GET /api/index.php/thirdparties?sqlfilters=(t.phone:like:'%0123456789%')&limit=5
```

**Exemple — Recherche par nom :**
```http
GET /api/index.php/thirdparties?sqlfilters=(t.nom:like:'%Acme%')&limit=20&sortfield=t.nom&sortorder=ASC
```

### 3.2 Récupérer une thirdparty par ID

```http
GET /api/index.php/thirdparties/{id}
DOLAPIKEY: votre_clé
```

### 3.3 Créer une thirdparty

```http
POST /api/index.php/thirdparties
DOLAPIKEY: votre_clé
Content-Type: application/json

{
  "name":     "Acme Corporation",
  "phone":    "0123456789",
  "email":    "contact@acme.fr",
  "address":  "123 avenue des Champs",
  "zip":      "75008",
  "town":     "Paris",
  "country_id": 1,
  "client":   1,
  "code_client": "-1"
}
```

> `code_client: "-1"` demande à Dolibarr de générer automatiquement le code client.

### 3.4 Champs d'une thirdparty (JSON)

| Champ API | Colonne DB | Type | Description |
|-----------|------------|------|-------------|
| `id` | `rowid` | int | Identifiant |
| `name` | `nom` | varchar(60) | **Nom de l'entreprise** |
| `status` | `status` | tinyint | 0=cessée, 1=active |
| `client` | `client` | tinyint | 0=non, 1=client, 2=prospect, 3=client+prospect |
| `fournisseur` | `fournisseur` | tinyint | 0=non, 1=fournisseur |
| `phone` | `phone` | varchar(20) | Téléphone |
| `fax` | `fax` | varchar(20) | Fax |
| `email` | `email` | varchar(128) | Email |
| `url` | `url` | varchar(255) | Site web |
| `address` | `address` | varchar(255) | Adresse |
| `zip` | `zip` | varchar(10) | Code postal |
| `town` | `town` | varchar(50) | Ville |
| `country_id` | `fk_pays` | int | ID pays |
| `country_code` | — | varchar(3) | Code ISO pays |
| `siren` | `siren` | varchar(128) | SIREN (IDProf1) |
| `siret` | `siret` | varchar(128) | SIRET (IDProf2) |
| `tva_intra` | `tva_intra` | varchar(20) | Numéro TVA intracommunautaire |
| `code_client` | `code_client` | varchar(24) | Code client (`-1` = auto) |
| `note_public` | `note_public` | text | Notes publiques |
| `note_private` | `note_private` | text | Notes privées |
| `logo` | `logo` | varchar(255) | Fichier logo |
| `parent` | `parent` | int | ID entreprise parente |

---

## 4. Activités / Journal (agendaevents) — `llx_actioncomm`

> L'endpoint API est `/agendaevents` (pas `/actioncomm`).
> Ce module est utilisé pour journaliser les appels téléphoniques et les notes.

### 4.1 Créer une activité (appel téléphonique)

```http
POST /api/index.php/agendaevents
DOLAPIKEY: votre_clé
Content-Type: application/json

{
  "type_code":    "AC_TEL",
  "label":        "📞 Appel entrant — Décroché (0612345678 → poste 101)",
  "datep":        1710400800,
  "datep2":       1710400860,
  "fulldayevent": 0,
  "percentage":   100,
  "fk_contact":   123,
  "socid":        42,
  "note":         "Appel entrant depuis UCM6300.\nDurée: 60s\nPoste: 101",
  "userownerid":  1,
  "userassigned": [{"id": 1}]
}
```

> ⚠️ `userownerid` est **obligatoire**.
> `datep` et `datep2` sont des **timestamps Unix** (secondes depuis epoch), pas des ISO strings.

### 4.2 Créer une note

```http
POST /api/index.php/agendaevents
DOLAPIKEY: votre_clé
Content-Type: application/json

{
  "type_code":    "AC_NOTE",
  "label":        "Note ajoutée depuis UCM-Middleware",
  "datep":        1710400800,
  "fulldayevent": 0,
  "percentage":   100,
  "fk_contact":   123,
  "note":         "Texte de la note...",
  "userownerid":  1,
  "userassigned": [{"id": 1}]
}
```

### 4.3 Lister les activités d'un contact

```http
GET /api/index.php/agendaevents?sqlfilters=(t.fk_contact:=:123)&sortfield=t.datep&sortorder=DESC&limit=15
DOLAPIKEY: votre_clé
```

### 4.4 Champs d'un agendaevent (JSON)

| Champ API | Type | Requis | Description |
|-----------|------|--------|-------------|
| `type_code` | string | **OUI** | Code type d'événement |
| `label` | string | non | Titre / libellé |
| `datep` | int (Unix) | non | Date/heure de début |
| `datep2` / `datef` | int (Unix) | non | Date/heure de fin |
| `fulldayevent` | int (0/1) | non | Événement toute la journée |
| `percentage` | int (0-100) | non | % de complétion (100 = terminé) |
| `fk_contact` | int | non | ID contact lié (llx_socpeople) |
| `socid` / `fk_soc` | int | non | ID entreprise liée |
| `note` | string | non | Description / notes détaillées |
| `userownerid` | int | **OUI** | ID du propriétaire (utilisateur Dolibarr) |
| `userassigned` | array | non | `[{"id": 1}, {"id": 2}]` |
| `location` | string | non | Lieu |
| `priority` | int | non | Priorité |
| `fk_project` | int | non | ID projet lié |

### 4.5 Codes `type_code` standards

| Code | Description |
|------|-------------|
| `AC_TEL` | Appel téléphonique |
| `AC_FAX` | Fax |
| `AC_EMAIL` | Email envoyé |
| `AC_NOTE` | Note interne |
| `AC_MEETING` | Réunion / rendez-vous |
| `AC_OTH` | Autre |
| `AC_OTH_AUTO` | Autre (automatique) |

> Pour créer des types personnalisés : **Configuration → Listes → Types d'actions**.

---

## 5. Syntaxe sqlfilters

Les filtres SQL sont passés en query string et permettent des recherches avancées.

### Format de base

```
(t.nom_colonne:operateur:'valeur')
```

> Le préfixe `t.` est **obligatoire** pour les colonnes de la table principale.

### Opérateurs disponibles

| Opérateur | Signification | Exemple |
|-----------|--------------|---------|
| `=` | Égalité exacte | `(t.statut:=:1)` |
| `!=` | Différent | `(t.statut:!=:0)` |
| `<` | Inférieur | `(t.datec:<:'2024-01-01')` |
| `>` | Supérieur | `(t.datec:>:'2023-01-01')` |
| `<=` | Inférieur ou égal | `(t.rowid:<=:100)` |
| `>=` | Supérieur ou égal | `(t.rowid:>=:50)` |
| `like` | LIKE SQL (sensible casse) | `(t.nom:like:'%Dupont%')` |
| `notlike` | NOT LIKE | `(t.nom:notlike:'%test%')` |
| `in` | Dans une liste | `(t.rowid:in:'1,2,3')` |
| `notin` | Pas dans la liste | `(t.statut:notin:'0,2')` |
| `is` | IS NULL | `(t.fk_soc:is:null)` |
| `isnot` | IS NOT NULL | `(t.fk_soc:isnot:null)` |

### Combinaisons AND / OR

```
# AND (parenthèses imbriquées, même niveau)
((t.client:=:1) AND (t.statut:=:1))

# OR
((t.phone:like:'%0612%') OR (t.phone_mobile:like:'%0612%'))

# Combiné
(((t.phone:like:'%0612%') OR (t.phone_mobile:like:'%0612%')) AND (t.statut:=:1))
```

### Exemples pratiques

```bash
# Recherche contact par téléphone (3 champs)
sqlfilters=((t.phone:like:'%0612345678%') OR (t.phone_mobile:like:'%0612345678%') OR (t.phone_perso:like:'%0612345678%'))

# Recherche contact par nom partiel
sqlfilters=((t.lastname:like:'%Dupont%') OR (t.firstname:like:'%Jean%'))

# Recherche entreprise par téléphone
sqlfilters=(t.phone:like:'%0123456789%')

# Recherche entreprise par nom
sqlfilters=(t.nom:like:'%Acme%')

# Activités d'un contact
sqlfilters=(t.fk_contact:=:123)

# Activités de type appel téléphonique
sqlfilters=((t.fk_contact:=:123) AND (t.code:like:'%AC_TEL%'))
```

> ⚠️ **URL-encoder** toujours les sqlfilters : les `%`, `(`, `)`, `'`, `:` doivent être encodés si passés dans une URL directe. `axios` le fait automatiquement avec `params:`.

### Erreurs fréquentes avec sqlfilters

| Erreur | Cause | Solution |
|--------|-------|----------|
| HTTP 404 sur `/thirdparties` | Syntaxe incorrecte ou colonne inexistante | Vérifier le nom de colonne dans la table |
| Résultats vides | Valeur mal encadrée par `'` | Toujours utiliser `'valeur'` (guillemets simples) |
| Pas de résultat sur téléphone | Format numéro différent | Utiliser `like` avec `%` des deux côtés |

---

## 6. Codes erreur

| HTTP | Signification | Action |
|------|--------------|--------|
| 200 | Succès | — |
| 400 | Requête invalide (champ manquant ou syntaxe) | Vérifier le payload |
| 401 | Clé API invalide ou module API désactivé | Regénérer la clé ou activer le module |
| 403 | Permission insuffisante | Vérifier les droits de l'utilisateur |
| 404 | Ressource non trouvée ou sqlfilters invalides | Vérifier l'ID ou la syntaxe |
| 500 | Erreur serveur Dolibarr | Consulter les logs Dolibarr |

### Activer le module API dans Dolibarr

1. **Configuration → Modules → Outils → API (REST)**
2. Activer le module
3. Vérifier que l'utilisateur a les droits sur les modules concernés (Contacts, Agenda)

---

## 7. Configuration dans le middleware

### Variables config

```javascript
// src/config/index.js
config.crm = {
  type: 'dolibarr'   // ou 'odoo'
};

config.dolibarr = {
  url:      'https://dolibarr.mondomaine.fr',  // URL sans slash final
  apiKey:   'abc123xyz',                       // Clé API générée dans Dolibarr
  userId:   1,                                 // ID utilisateur propriétaire des activités
  entityId: null,                              // null ou ID entité (multi-société)
  timeout:  8000,                              // Timeout HTTP en ms
  cacheContactTtl: 300,                        // Cache contacts en secondes
};
```

### Mapping des méthodes CRM

| Méthode interface | Dolibarr | Odoo |
|------------------|----------|------|
| `authenticate()` | `GET /status` | XML-RPC `/xmlrpc/2/common` |
| `findContactByPhone(phone)` | `GET /contacts?sqlfilters=...` + `GET /thirdparties?sqlfilters=...` | `res.partner.search_read()` |
| `searchContacts(query, limit)` | `GET /contacts?sqlfilters=(lastname\|firstname)` + `GET /thirdparties?sqlfilters=(nom)` | `res.partner.search_read()` |
| `getContactById(id)` | `GET /contacts/{id}` | `res.partner.search_read([['id','=',id]])` |
| `getContactFull(id)` | `GET /contacts/{id}` + `GET /thirdparties/{socid}` | `res.partner.search_read()` (champs étendus) |
| `createContact(data)` | `POST /contacts` | `res.partner.create()` |
| `updateContact(id, data)` | `PUT /contacts/{id}` | `res.partner.write()` |
| `logCallActivity(id, data)` | `POST /agendaevents` (`AC_TEL`) | `res.partner.message_post()` |
| `getContactMessages(id, limit)` | `GET /agendaevents?sqlfilters=(fk_contact:=:id)` | `mail.message.search_read()` |
| `addContactNote(id, note)` | `POST /agendaevents` (`AC_NOTE`) | `res.partner.message_post()` subtype `note` |

---

## 8. Variables d'environnement

Ajouter dans le fichier `.env` :

```bash
# ─── Sélection du CRM ────────────────────────────────────────────────────────
CRM_TYPE=dolibarr          # 'odoo' (défaut) ou 'dolibarr'

# ─── Dolibarr ────────────────────────────────────────────────────────────────
DOLIBARR_URL=https://dolibarr.mondomaine.fr
DOLIBARR_API_KEY=votre_cle_api_dolibarr
DOLIBARR_USER_ID=1         # ID utilisateur Dolibarr propriétaire des activités
DOLIBARR_ENTITY_ID=        # Vide si pas multi-entité, sinon l'ID numérique
DOLIBARR_TIMEOUT=8000      # Timeout HTTP en ms

# ─── Cache (partagé Odoo/Dolibarr) ──────────────────────────────────────────
CACHE_CONTACT_TTL=300      # Durée cache contacts en secondes
```

---

## 9. Exemples de requêtes

### Recherche complète par téléphone (axios)

```javascript
const axios = require('axios');

const client = axios.create({
  baseURL: 'https://dolibarr.mondomaine.fr/api/index.php',
  headers: {
    'DOLAPIKEY':    'votre_cle_api',
    'Content-Type': 'application/json',
  },
});

// Recherche dans contacts
const contacts = await client.get('/contacts', {
  params: {
    sqlfilters: "((t.phone:like:'%0612345678%') OR (t.phone_mobile:like:'%0612345678%') OR (t.phone_perso:like:'%0612345678%'))",
    limit:      5,
    sortfield:  't.rowid',
    sortorder:  'DESC',
  }
});

// Recherche dans thirdparties
const companies = await client.get('/thirdparties', {
  params: {
    sqlfilters: "(t.phone:like:'%0612345678%')",
    limit:      5,
  }
});
```

### Créer un appel téléphonique dans le journal

```javascript
await client.post('/agendaevents', {
  type_code:    'AC_TEL',
  label:        '📞 Appel entrant — Décroché (0612345678 → poste 101)',
  datep:        Math.floor(Date.now() / 1000),
  datep2:       Math.floor(Date.now() / 1000) + 90,  // 90 secondes de durée
  fulldayevent: 0,
  percentage:   100,
  fk_contact:   123,
  socid:        42,
  note:         'Direction : Entrant\nStatut : Décroché\nDurée : 1min 30s',
  userownerid:  1,
  userassigned: [{ id: 1 }],
});
```

### Créer un contact (nom complet → lastname + firstname)

```javascript
const name = 'Jean Dupont';
const parts = name.trim().split(/\s+/);
const lastname  = parts.pop();      // 'Dupont'
const firstname = parts.join(' ');  // 'Jean'

await client.post('/contacts', {
  lastname,
  firstname,
  phone_pro:   '0123456789',
  email:       'jean.dupont@example.com',
  poste:       'Directeur',
  socid:       42,     // lier à une thirdparty
  statut:      1,      // actif
});
```

### URL d'accès direct à une fiche dans Dolibarr

```javascript
// Contact (socpeople)
const contactUrl = `https://dolibarr.mondomaine.fr/contact/card.php?id=${contactId}`;

// Entreprise (thirdparty)
const companyUrl = `https://dolibarr.mondomaine.fr/societe/card.php?socid=${thirdpartyId}`;
```

---

## Notes importantes

### Différences Odoo vs Dolibarr

| Aspect | Odoo | Dolibarr |
|--------|------|----------|
| Protocole | XML-RPC | REST JSON |
| Auth | Session UID + API Key | Stateless DOLAPIKEY |
| Nom contact | `name` (un seul champ) | `lastname` + `firstname` |
| Téléphone | `phone`, `mobile` | `phone_pro`, `phone_mobile`, `phone_perso` |
| Entreprise | `parent_id` (res.partner) | `socid` (llx_societe séparée) |
| Journal appel | `message_post()` sur res.partner | `POST /agendaevents` AC_TEL |
| URL fiche | `/web#model=res.partner&id=X` | `/contact/card.php?id=X` |
| Pagination | `offset` + `limit` | `page` (0-indexé) + `limit` |
| Date activité | ISO string | **Unix timestamp (int)** |

### Pré-requis côté Dolibarr

1. **Module API REST activé** : Configuration → Modules → Outils → API (REST)
2. **Module Agenda activé** : pour les activités téléphoniques
3. **Module Contacts activé** : pour la gestion des contacts
4. **Droits utilisateur** : l'utilisateur lié à la clé API doit avoir les droits :
   - Contacts : lecture + écriture
   - Agenda : lecture + écriture
   - Tiers (Thirdparties) : lecture + écriture

### Tester l'API avec curl

```bash
# Vérifier la connexion
curl -H "DOLAPIKEY: votre_cle" https://dolibarr.mondomaine.fr/api/index.php/status

# Lister les contacts
curl -H "DOLAPIKEY: votre_cle" \
  "https://dolibarr.mondomaine.fr/api/index.php/contacts?limit=5"

# Recherche par téléphone
curl -H "DOLAPIKEY: votre_cle" \
  --data-urlencode "sqlfilters=(t.phone:like:'%0612345678%')" \
  "https://dolibarr.mondomaine.fr/api/index.php/contacts" -G
```

### Explorer l'API interactive (Swagger UI)

Dolibarr expose une interface Swagger à l'adresse :
```
https://dolibarr.mondomaine.fr/api/index.php/explorer
```

Elle liste tous les endpoints disponibles avec la possibilité de les tester en direct.
