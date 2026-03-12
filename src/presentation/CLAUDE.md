# presentation/ — Couche présentation

Deux éléments :

| Sous-dossier | Rôle |
|-------------|------|
| `api/router.js` | Routes Express REST + sessions admin |
| `admin/` | Interface web admin (HTML + JS vanilla + Bootstrap 5) |

## Sessions admin

- Header : `X-Session-Token: <uuid>`
- TTL : 8 heures
- Login via `POST /api/auth/login` (credentials Odoo)
- Certaines routes sont protégées (`requireSession` middleware), d'autres non

## Interface admin (port 3000)

- `/admin` → dashboard principal
- `/api-docs` → documentation OpenAPI Swagger
- `/health` → healthcheck JSON (sans auth)
