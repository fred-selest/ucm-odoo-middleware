# ── Stage 1 : dépendances de production ────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copier uniquement les manifestes pour profiter du cache Docker
COPY package.json package-lock.json* ./

# Installer uniquement les dépendances de prod
RUN npm install --omit=dev --ignore-scripts \
 && npm cache clean --force


# ── Stage 2 : image finale ──────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Métadonnées
LABEL maintainer="contact@selest.info" \
      description="UCM ↔ Odoo CTI Middleware"

# Sécurité : ne pas tourner en root
# node:alpine crée déjà l'utilisateur 'node' (uid 1000)
WORKDIR /app

# Dépendances système minimales
RUN apk add --no-cache \
    tini \
    curl

# Copier les modules depuis le stage deps
COPY --from=deps /app/node_modules ./node_modules

# Copier le code applicatif
COPY src/ ./src/
COPY package.json ./

# Créer le répertoire de logs avec les bons droits
RUN mkdir -p /app/logs && chown -R node:node /app

# Basculer sur l'utilisateur non-root
USER node

# Exposition du port HTTP/WS
EXPOSE 3000

# Healthcheck : interroge l'endpoint /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1

# Utiliser tini comme PID 1 pour une gestion propre des signaux
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "src/index.js"]
