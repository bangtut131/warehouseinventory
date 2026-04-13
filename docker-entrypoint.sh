#!/bin/sh
set -e
echo "Running Prisma DB push (sync schema)..."
npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "Prisma db push failed, continuing anyway..."
echo "Starting application..."
exec node server.js
