# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Runtime stage
FROM node:20-alpine AS runtime

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl sqlite

# Create non-root user
RUN addgroup -g 1001 nodejs && \
    adduser -S -u 1001 nodejs

# Copy dependencies from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application files
COPY --chown=nodejs:nodejs . .

# Create data and logs directories
RUN mkdir -p /app/data /app/logs && \
    chown -R nodejs:nodejs /app/data /app/logs

# Switch to non-root user
USER nodejs

# Expose ports
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:3000/health || exit 1

# Start application
CMD ["node", "src/index.js"]
