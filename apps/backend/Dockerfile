FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY . .

RUN npm run prisma:generate --workspace @slate/backend
RUN npm run build --workspace @slate/backend

WORKDIR /app/apps/backend

EXPOSE 4000 50051

CMD ["npm", "run", "start"]
