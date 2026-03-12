# infrastructure/database/ — SQLite

## Fichiers

- `Database.js` — connexion SQLite (singleton), méthodes `run`, `get`, `all`
- `CallHistory.js` — CRUD complet sur toutes les tables
- `schema.sql` — schéma de référence (appliqué au démarrage)

## Schéma

### Table `calls` — historique des appels

| Colonne | Type | Description |
|---------|------|-------------|
| `unique_id` | TEXT UNIQUE | Identifiant UCM (ou généré) |
| `caller_id_num` | TEXT | Numéro appelant |
| `caller_id_name` | TEXT | Nom appelant (si fourni par UCM) |
| `exten` | TEXT | Extension de destination |
| `agent_exten` | TEXT | Extension qui a décroché |
| `direction` | TEXT | `inbound`, `outbound`, `internal` |
| `status` | TEXT | `ringing` → `answered`/`missed` → `hangup` |
| `started_at` | DATETIME | Début de sonnerie (UTC) |
| `answered_at` | DATETIME | Décroché |
| `hung_up_at` | DATETIME | Raccroché |
| `duration` | INTEGER | Durée en secondes (depuis `answered_at`) |
| `contact_id` | INTEGER | ID Odoo `res.partner` |
| `contact_name/phone/email/odoo_url` | TEXT | Snapshot contact Odoo |
| `notes` | TEXT | Note manuelle |
| `tags` | TEXT | JSON array de tags |

**Attention** : `started_at` est stocké en UTC depuis `CURRENT_TIMESTAMP`. Pour l'affichage, ajouter `'Z'` : `new Date(started_at.replace(' ','T') + 'Z')`.

### Table `agent_status`

Statut temps-réel des postes téléphoniques.

| Statut | Déclencheur |
|--------|-------------|
| `on_call` | `_onAnswered()` |
| `available` | `_onHangup()` |
| `pause`, `offline`, `busy` | Via API REST |

### Table `blacklist`

Numéros bloqués. `isBlacklisted(phone)` est appelé à chaque appel entrant.

### Table `active_calls`

Appels en cours (snapshot pour le monitoring). Nettoyé à chaque raccroché.

### Table `daily_stats`

Agrégats journaliers. Mis à jour sur chaque changement de statut d'appel.

## Méthodes CallHistory clés

```javascript
// Insertion standard (depuis événement UCM temps-réel)
createCall({ uniqueId, callerIdNum, callerIdName, exten, agentExten, direction })
// → status initial = 'ringing'

// Insertion depuis CDR UCM (historique, inclut dates/statut complets)
createCallFromCdr(cdrRecord)
// → INSERT OR IGNORE (pas de doublon sur unique_id)
// → Détermine direction : interne(1-5 chiffres)/entrant/sortant
// → Mappe disposition ANSWERED→'hangup', NO ANSWER/BUSY→'missed'

// Mise à jour du cycle de vie
updateCallAnswered(uniqueId)      // status='answered', answered_at=NOW
updateCallHangup(uniqueId, duration) // status='hangup'/'missed', hung_up_at=NOW
updateCallContact(uniqueId, contact) // contact_id, contact_name, etc.

// Requêtes
getCalls({ limit, offset, status, direction, exten, callerIdNum, startDate, endDate, search })
getStats('today'|'yesterday'|'week'|'month')
getStatsByExtension(days)
getTopCallers(limit, days)
```

## Timezone

L'UCM retourne les dates CDR en heure locale (UTC+1 en France). Les dates temps-réel SQLite sont en UTC (`CURRENT_TIMESTAMP`). La conversion pour l'affichage est faite côté navigateur en ajoutant `'Z'` ou `'T'` selon le contexte.
