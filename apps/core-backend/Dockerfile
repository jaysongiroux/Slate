FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/core-backend/package.json apps/core-backend/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server-db/package.json packages/server-db/package.json

RUN npm install

COPY . .

RUN npm run prisma:generate --workspace @slate/server-db
RUN npm run build --workspace @slate/core-backend

WORKDIR /app/apps/core-backend

EXPOSE 4000 50051

CMD ["npm", "run", "start"]
