# ── Stage 1 : Build des dépendances natives ─────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Installer les outils de compilation pour sqlite3
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite-dev

# Copier les manifestes
COPY package.json package-lock.json* ./

# Installer TOUTES les dépendances (inclut dev pour compilation)
RUN npm ci --ignore-scripts && \
    npm rebuild sqlite3 && \
    npm cache clean --force

# ── Stage 2 : Production dependencies ────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Installer sqlite-dev pour les libs natives
RUN apk add --no-cache sqlite-dev

COPY package.json package-lock.json* ./

# Installer uniquement les dépendances de production
RUN npm install --omit=dev --ignore-scripts && \
    npm cache clean --force

# ── Stage 3 : Image finale (distroless-like) ─────────────────────────────────
FROM node:20-alpine AS runtime

# Métadonnées OCI
LABEL org.opencontainers.image.title="UCM ↔ Odoo Middleware" \
      org.opencontainers.image.description="CTI middleware for Grandstream UCM and Odoo integration" \
      org.opencontainers.image.source="https://github.com/${GITHUB_REPOSITORY}" \
      org.opencontainers.image.version="${VERSION:-latest}" \
      maintainer="contact@selest.info"

WORKDIR /app

# Dépendances système minimales
RUN apk add --no-cache \
    tini \
    curl \
    sqlite-libs \
    && rm -rf /var/cache/apk/*

# Copier les modules depuis le stage deps
COPY --from=deps /app/node_modules ./node_modules

# Copier le code applicatif
COPY src/ ./src/
COPY package.json ./

# Créer le répertoire de logs et données avec les bons droits
RUN mkdir -p /app/logs /app/data && \
    chown -R node:node /app

# Basculer sur l'utilisateur non-root
USER node

# Exposition du port HTTP/WS
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:3000/health || exit 1

# Utiliser tini comme PID 1
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "src/index.js"]

# ── Stage 4 : Development ────────────────────────────────────────────────────
FROM builder AS development

WORKDIR /app

# Installer nodemon pour le hot-reload
RUN npm install -g nodemon

# Copier tout le code
COPY . .

EXPOSE 3000

CMD ["nodemon", "--watch", "src", "--ext", "js,json", "src/index.js"]
