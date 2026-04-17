#!/bin/sh
# Fix permissions sur le répertoire data (volume monté en root)
chown -R nodejs:nodejs /app/data 2>/dev/null || true
chmod 755 /app/data 2>/dev/null || true

# Fix permissions sur les fichiers du volume montés par root
chown -R nodejs:nodejs /app/logs 2>/dev/null || true

# Lancer l'app en tant que nodejs
exec gosu nodejs node src/index.js
