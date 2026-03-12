# presentation/admin/ — Interface admin

Dashboard web accessible sur `/admin`.

## Stack frontend

- **JavaScript** : vanilla (pas de framework)
- **CSS** : Bootstrap 5 + Bootstrap Icons
- **Temps-réel** : WebSocket natif (`/ws`)
- **Auth** : token dans `localStorage` (`sessionToken`), envoyé en header `X-Session-Token`

## index.html — Structure

```
┌─────────────────────────────────────────────────┐
│ Barre de statut : UCM / Odoo / Appels / Clients  │
├──────────────┬──────────────────────────────────┤
│  Panel gauche │  Panel droit                     │
│  - Journal   │  - Agents                        │
│    d'appels  │  - Stats                         │
│  (temps-réel)│  - Config UCM/Odoo               │
├──────────────┴──────────────────────────────────┤
│  Journal complet avec filtres + Sync UCM + CSV   │
├──────────────────────────────────────────────────┤
│  Logs en direct                                  │
└──────────────────────────────────────────────────┘
```

**Modals** :
- `modalIncomingCall` → remontée de fiche (popup appel entrant)
- `modalQuickContact` → fiche contact rapide (avatar, historique, note)
- `modalCreateContact` → créer contact Odoo
- `modalEditContact` → modifier contact Odoo
- `modalDial` → click-to-call

## js/ — Modules JavaScript

| Fichier | Rôle |
|---------|------|
| `app.js` | Init, polling `/status`, logs, config, stats, CDR sync |
| `auth.js` | Login/logout, gestion `sessionToken` dans `localStorage` |
| `websocket.js` | Connexion WS, subscription extensions, dispatch messages |
| `calls.js` | Tableau appels temps-réel, popup appel entrant, historique |
| `contacts.js` | Fiche contact rapide, création/modification, historique |
| `ui.js` | Helpers : `apiFetch`, `esc`, `toast`, `phoneLink`, etc. |

## Flux d'une remontée de fiche

```
WS message { type: 'call:incoming', data: {...} }
    ↓
websocket.js : ws.onmessage
    ↓
calls.js : addCallRow(data, 'incoming')
           showIncomingCallPopup(data)
    ↓
Modal #modalIncomingCall affiché avec :
  - callerIdNum → #incomingCallerPhone
  - contact.name → #incomingCallerName
  - contact.avatar → #incomingAvatar (base64)
  - contact.odooUrl → #incomingOdooLink

WS message { type: 'contact', data: { uniqueId, contact } }
    ↓
calls.js : updateCallContact(data)
    ↓
Mise à jour du badge contact dans le tableau (si la fiche est déjà affichée)
```

## Bouton "Sync UCM"

Déclenche `POST /api/calls/sync-cdr` (sans paramètres = aujourd'hui 00:00 → maintenant).
Affiche un résumé : N appels importés, M déjà présents.
Rafraîchit le journal complet après sync.

## Numéros cliquables

`phoneLink(phone)` génère `<code class="phone-link" data-phone="...">`.
Event delegation sur `document` dans `contacts.js` :
```javascript
document.addEventListener('click', e => {
  const el = e.target.closest('.phone-link');
  if (el) openContactOrCreate(el.dataset.phone);
});
```
