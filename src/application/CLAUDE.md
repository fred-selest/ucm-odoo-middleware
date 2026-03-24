# application/ — Couche applicative

Orchestre le traitement des appels. Ne contient pas de code réseau directement.

## CallHandler.js

**Rôle** : Reçoit les événements UCM, enrichit avec Odoo, persiste en SQLite, notifie le navigateur.

### Flux d'un appel entrant

```
UCM WS event (ringing)
    ↓
_onIncoming()
    ├── filtre trunk SIP (SLI-TRK-* → ignoré)
    ├── blacklist check (callHistory.isBlacklisted — exact + préfixes *)
    ├── spam score Tellows (spamScoreService.check — score >= 7 → auto-blacklist)
    ├── filtre numéro interne (1-5 chiffres → pas de lookup Odoo)
    ├── odooClient.findContactByPhone(callerIdNum)
    ├── auto-création contact si inconnu (Inconnu +33...)
    ├── callHistory.createCall(...)
    ├── callHistory.updateCallContact(uniqueId, contact)
    └── wsServer.notifyExtension(exten, 'call:incoming', { ...enriched, spamInfo })
        + wsServer.notifyExtension(exten, 'contact', { uniqueId, contact })

UCM WS event (inuse/answered)
    ↓
_onAnswered()
    ├── callHistory.updateCallAnswered(uniqueId)
    ├── callHistory.setAgentOnCall(exten, uniqueId)
    └── wsServer.notifyExtension(exten, 'call:answered', enriched)

UCM WS event (idle/hangup)
    ↓
_onHangup()
    ├── calcul durée
    ├── callHistory.updateCallHangup(uniqueId, duration)
    ├── callHistory.setAgentAvailable(exten, duration)
    ├── odooClient.logCallActivity(contact.id, {...})  ← fire-and-forget
    └── wsServer.notifyExtension(exten, 'call:hangup', enriched)
```

### Polling HTTP (fallback)

- Intervalle : 3 secondes
- Appelle `listBridgedChannels()` et `listUnBridgedChannels()` sur UCM HTTP
- Détecte les appels si le WS UCM ne les remonte pas
- **Important** : ne pas vérifier `isAuthenticated()` avant d'appeler `_doPoll()` — la re-auth est gérée automatiquement par `request()`

### Filtre numéro interne

```javascript
_isInternalNumber(number) {
  return /^\d{1,5}$/.test(number.replace(/\D/g, ''));
}
// Exemples : '101' → interne, '0612345678' → externe
```

Les numéros internes ne sont jamais envoyés à Odoo pour lookup.

### État interne

- `_activeCalls` : Map `uniqueId → callInfo enrichi` (effacé au raccroché)
- `_polledCalls` : Map `uniqueId → callInfo` pour le polling HTTP

## WebhookManager.js

Gère les tokens webhook pour les UCM qui ne supportent pas le WebSocket.
Les événements arrivent via `GET /webhook/:token?event=...&caller=...&exten=...`.
Émet les mêmes événements `call:incoming`, `call:answered`, `call:hangup` que `UcmWsClient`.
