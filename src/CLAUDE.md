# src/ — Code source principal

Point d'entrée : `index.js`

## Démarrage (`index.js`)

Ordre d'initialisation :
1. `UcmHttpClient` → authentification HTTP UCM (challenge/response MD5)
2. `UcmWsClient` → connexion WebSocket UCM + subscription `ExtensionStatus`
3. `OdooClient` → authentification XML-RPC
4. `CallHistory` → connexion SQLite + création schéma
5. `WsServer` → démarrage serveur WebSocket navigateur
6. `CallHandler` → binding des événements UCM + démarrage polling HTTP
7. `HealthAgent` → supervision toutes les 30s
8. Express → routes REST + interface admin

## logger.js

Winston configuré avec :
- Niveau : `LOG_LEVEL` (env, défaut `info`)
- Sorties : console + fichier (selon `LOG_OUTPUT`)
- Événement `data` émis sur chaque log → tampon en mémoire dans `router.js` (300 entrées) pour l'affichage live dans l'admin

```javascript
// Pour lire les logs depuis le router :
logger.on('data', (info) => { ... })
```
