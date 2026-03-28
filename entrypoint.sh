#!/bin/sh
# Fix permissions sur les fichiers du volume montés par root
chown -R nodejs:nodejs /tmp/ucm-odoo-data /app/logs 2>/dev/null || true
chmod 664 /tmp/ucm-odoo-data/*.db 2>/dev/null || true
# Lancer l'app en tant que nodejs
exec gosu nodejs node src/index.js
