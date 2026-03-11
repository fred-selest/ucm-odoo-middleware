#!/bin/sh
# Fix permissions sur les fichiers du volume montés par root
chown -R nodejs:nodejs /app/data /app/logs 2>/dev/null || true
chmod 664 /app/data/*.db 2>/dev/null || true
# Lancer l'app en tant que nodejs
exec su-exec nodejs node src/index.js
