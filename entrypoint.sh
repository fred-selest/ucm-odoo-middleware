#!/bin/sh
# Copier la base de données dans un emplacement writable si elle existe sur le volume
if [ -f /app/data/middleware.db ]; then
  cp /app/data/middleware.db /tmp/middleware.db
  chmod 666 /tmp/middleware.db
  export DB_PATH=/tmp/middleware.db
  echo "✅ Database copied to /tmp/middleware.db"
fi

# Fix permissions sur les fichiers du volume montés par root
chown -R nodejs:nodejs /tmp/ucm-odoo-data /app/logs 2>/dev/null || true
chmod 664 /tmp/ucm-odoo-data/*.db 2>/dev/null || true

# Lancer l'app en tant que nodejs
exec gosu nodejs node src/index.js
