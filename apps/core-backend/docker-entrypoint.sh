#!/bin/sh
set -e

cd /app

npm run prisma:migrate:deploy --workspace @slate/server-db

exec npm run start --workspace @slate/core-backend
