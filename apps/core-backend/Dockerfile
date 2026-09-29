FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY scripts/patch-adminjs-exports.js scripts/patch-adminjs-exports.js
COPY apps/core-backend/package.json apps/core-backend/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server-db/package.json packages/server-db/package.json

RUN npm install

COPY . .

RUN npm run prisma:generate --workspace @slate/server-db
RUN npm run build --workspace @slate/core-backend
RUN chmod +x apps/core-backend/docker-entrypoint.sh

WORKDIR /app/apps/core-backend

EXPOSE 4000 50051

HEALTHCHECK --interval=5s --timeout=5s --start-period=30s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["./docker-entrypoint.sh"]
