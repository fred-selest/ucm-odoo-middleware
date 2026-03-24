# admin/js/ — Modules JavaScript frontend

Vanilla JS, pas de build step. Chargés directement dans `index.html`. Cache-buste automatique (`?v=BUILD_VERSION`).

## app.js — Logique principale

- `startApp()` : appelé après login réussi
- `fetchStatus()` : polling `/status` toutes les **5s** → met à jour les indicateurs
- `loadFullJournal(page)` : charge `/api/calls/history` avec les filtres actifs
- `fetchAgentStatus()` : charge `/api/agents/status`
- Sync CDR : `document.getElementById('syncCdrBtn').onclick` → `POST /api/calls/sync-cdr`
- Export CSV : `exportCsvBtn` → génère un `.csv` depuis `jData`

## auth.js — Authentification

- `sessionToken` stocké dans `localStorage`
- `checkAuth()` → vérifie `GET /api/auth/me` au chargement
- `loginForm` → `POST /api/auth/login` → stocke le token
- `logoutBtn` → `POST /api/auth/logout` → vide le token

## websocket.js — WebSocket

```javascript
// Connexion auto
connectWs()  // wss://host/ws

// Au connect : subscription automatique via /status (watchExtensions ou '*')
subscribeToExtensions()

// Dispatch des messages reçus
ws.onmessage = ({ data }) => {
  if (msg.type === 'call:incoming') { addCallRow(); showIncomingCallPopup(); }
  if (msg.type === 'call:answered') { updateCallRow(); }
  if (msg.type === 'call:hangup')   { updateCallRow(); loadCallHistory(); loadFullJournal(); }
  if (msg.type === 'contact')       { updateCallContact(); }
  if (msg.type === 'agent:status_changed') { fetchAgentStatus(); }
}
```

## calls.js — Tableau d'appels

- `addCallRow(call, status)` : insère une ligne dans `#callBody`
- `updateCallRow(call, status)` : met à jour une ligne existante
- `updateCallContact(data)` : met à jour le badge contact dans une ligne
- `showIncomingCallPopup(call)` : affiche `#modalIncomingCall` avec les infos de l'appel + badge spam si `call.spamInfo`
- `loadCallHistory()` : charge les 50 derniers appels depuis `/api/calls/history?limit=50`
- `callRows` : Map `uniqueId → <tr>` pour les mises à jour rapides

## contacts.js — Gestion contacts

- `openContactOrCreate(phone)` : ouvre la fiche si contact trouvé, sinon modal de création
- `openQuickContact(contactId)` : charge et affiche `#modalQuickContact`
  - Avatar (base64), informations, historique appels, notes chatter
- `saveQuickNote()` : `POST /api/odoo/contacts/:id/notes` (texte brut)
- `openEditContactModal()` : formulaire de modification → `PUT /api/odoo/contacts/:id`
- `openCreateContactModal(phone)` : pré-remplit le numéro → `POST /api/odoo/contacts`

## blacklist.js — Blacklist et spam

- `loadBlacklist()` : charge et affiche la liste (préfixes marqués avec badge "préfixe")
- `addToBlacklist(phone, reason)` / `removeFromBlacklist(phone)` : CRUD blacklist
- `blockFromJournal(phone)` : bloquer depuis le journal d'appels
- `blockFromContact()` : bloquer depuis la popup contact
- `blockCurrentCaller()` : bloquer depuis le popup d'appel entrant
- `importSpamFR()` : importe les 23 préfixes démarchage ARCEP
- `checkSpamScore(phone)` : vérifie le score Tellows, propose de bloquer si >= 7

## journal.js — Journal d'appels complet

- `loadFullJournal(page)` : historique paginé avec filtres
- Bouton bloquer (icône rouge) à côté de chaque numéro
- Export CSV, sync CDR UCM

## ui.js — Utilitaires

```javascript
apiFetch(url, options)   // fetch avec X-Session-Token automatique
esc(str)                 // échappement HTML (sécurité XSS)
phoneLink(phone)         // génère <code class="phone-link" data-phone="...">
showToast(msg, type)     // notification Bootstrap toast
```

## Variables globales importantes

```javascript
let jPage = 1;           // Page courante du journal complet
let jData = [];          // Données du journal (pour export CSV)
const callRows = {};     // Map uniqueId → <tr> (appels temps-réel)
let incomingCallModal;   // Instance Bootstrap Modal (remontée de fiche)
let currentIncomingCall; // Appel actuellement affiché dans le popup
```

## ⚠️ Points d'attention

- `apiFetch` ajoute automatiquement `X-Session-Token` — ne pas utiliser `fetch()` directement pour les routes protégées
- `esc()` doit être utilisé sur **toutes les données** insérées en HTML (contre XSS)
- Le son d'appel (`playIncomingCallSound`) utilise Web Audio API — peut être bloqué si pas d'interaction utilisateur préalable
