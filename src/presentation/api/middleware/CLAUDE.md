# presentation/api/middleware/ — Express Middlewares

## Fichiers

| Fichier | Rôle |
|---------|------|
| `auth.js` | Sessions UUID, TTL 8h, `requireSession` |
| `errorHandler.js` | Gestion centralisée des erreurs |
| `security.js` | Helmet, CORS, rate limiting |
| `validator.js` | Validation req.body/params/query |
| `requestLogger.js` | Log requêtes HTTP |
| `index.js` | Export barrel |

## Sessions (auth.js)

```javascript
// Créer session après login Odoo
const token = createSession(uid, username); // → UUID

// Vérifier session middleware
requireSession(req, res, next) // → 401 si invalide
```

Sessions stockées en mémoire (Map). TTL 8h.

## Error Handler (errorHandler.js)

```javascript
// Middleware terminal — catches all errors
errorHandler(err, req, res, next)

// Types d'erreurs:
// - AppError (métier) → statusCode configurable
// - ValidationError → 400
// - UnauthorizedError → 401
// - NotFoundError → 404
```

## Security (security.js)

- **Helmet** : headers sécurisés (X-Frame-Options, CSP, etc.)
- **Rate limiting** : 100 req/15min par IP
- **CORS** : origins configurable via `ALLOWED_ORIGINS`

## Validator (validator.js)

Validation Joi pour :
- `req.body` (POST/PUT)
- `req.params` (routes)
- `req.query` (filtres)

## Request Logger (requestLogger.js)

Log chaque requête : méthode, path, status, durée (ms).