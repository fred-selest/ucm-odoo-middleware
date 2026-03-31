# syntax=docker/dockerfile:1

# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install Python and build tools needed for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies with cache mount for faster builds
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production && npm cache clean --force

# Runtime stage
FROM node:20-slim AS runtime

WORKDIR /app

# Install system deps + Python/ffmpeg for Whisper
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl sqlite3 gosu python3 python3-pip ffmpeg && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install openai-whisper --break-system-packages

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -m -r -u 1001 -g nodejs nodejs

# Copy dependencies from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application files
COPY --chown=nodejs:nodejs . .

# Create data and logs directories
RUN mkdir -p /tmp/ucm-odoo-data /app/logs && \
    chown -R nodejs:nodejs /tmp/ucm-odoo-data /app/logs

# Entrypoint script (s'exécute en root pour fixer les permissions du volume)
COPY --chown=root:root entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose ports
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:3000/health || exit 1

# Entrypoint root → fixe permissions → exec en nodejs
ENTRYPOINT ["/entrypoint.sh"]
