-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "AuthIdentityType" AS ENUM ('PASSWORD', 'OIDC');

-- CreateEnum
CREATE TYPE "AppConfigName" AS ENUM ('ACCOUNT_CREATION_ENABLED', 'PASSWORD_AUTH_ENABLED', 'STORAGE_BACKEND', 'STORAGE_FILESYSTEM_ROOT', 'STORAGE_S3_CONFIG', 'STORAGE_S3_ENDPOINT', 'STORAGE_S3_BUCKET', 'STORAGE_S3_ACCESS_KEY_ID', 'STORAGE_S3_SECRET_ACCESS_KEY');

-- CreateEnum
CREATE TYPE "EmbeddingProvider" AS ENUM ('OPENAI', 'OLLAMA', 'OPENAI_COMPATIBLE', 'ANTHROPIC');

-- CreateEnum
CREATE TYPE "ChatProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'OLLAMA', 'OPENAI_COMPATIBLE');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedUsername" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "plainText" TEXT NOT NULL,
    "crdtState" BYTEA,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "embedded" BOOLEAN NOT NULL DEFAULT false,
    "serverSeq" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "processedKey" TEXT,
    "hash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AuthIdentityType" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_provider_config" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "issuerUrl" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'openid profile email',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oidc_provider_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_auth_request" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oidc_auth_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totp_enrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretBase32" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "totp_enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_cursor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "lastServerSeq" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_cursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_config" (
    "name" "AppConfigName" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "ai_config" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "embeddingProvider" "EmbeddingProvider",
    "embeddingModel" TEXT,
    "embeddingEndpoint" TEXT,
    "embeddingApiKey" TEXT,
    "chatProvider" "ChatProvider",
    "chatModel" TEXT,
    "chatEndpoint" TEXT,
    "chatApiKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "heading" TEXT,
    "embedding" vector(1536),
    "embeddingModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_normalizedUsername_key" ON "user"("normalizedUsername");

-- CreateIndex
CREATE INDEX "user_normalizedUsername_idx" ON "user"("normalizedUsername");

-- CreateIndex
CREATE INDEX "user_email_idx" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_isAdmin_idx" ON "user"("isAdmin");

-- CreateIndex
CREATE INDEX "document_userId_serverSeq_idx" ON "document"("userId", "serverSeq");

-- CreateIndex
CREATE INDEX "document_createdAt_idx" ON "document"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "document_userId_path_key" ON "document"("userId", "path");

-- CreateIndex
CREATE INDEX "attachment_userId_idx" ON "attachment"("userId");

-- CreateIndex
CREATE INDEX "attachment_documentId_idx" ON "attachment"("documentId");

-- CreateIndex
CREATE INDEX "attachment_status_idx" ON "attachment"("status");

-- CreateIndex
CREATE INDEX "attachment_userId_hash_idx" ON "attachment"("userId", "hash");

-- CreateIndex
CREATE INDEX "attachment_createdAt_idx" ON "attachment"("createdAt");

-- CreateIndex
CREATE INDEX "auth_identity_userId_idx" ON "auth_identity"("userId");

-- CreateIndex
CREATE INDEX "auth_identity_createdAt_idx" ON "auth_identity"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identity_provider_providerSubject_key" ON "auth_identity"("provider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX "oidc_provider_config_providerId_key" ON "oidc_provider_config"("providerId");

-- CreateIndex
CREATE INDEX "oidc_provider_config_providerId_idx" ON "oidc_provider_config"("providerId");

-- CreateIndex
CREATE INDEX "oidc_provider_config_enabled_idx" ON "oidc_provider_config"("enabled");

-- CreateIndex
CREATE INDEX "oidc_provider_config_createdAt_idx" ON "oidc_provider_config"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "oidc_auth_request_state_key" ON "oidc_auth_request"("state");

-- CreateIndex
CREATE INDEX "oidc_auth_request_providerId_idx" ON "oidc_auth_request"("providerId");

-- CreateIndex
CREATE INDEX "oidc_auth_request_expiresAt_idx" ON "oidc_auth_request"("expiresAt");

-- CreateIndex
CREATE INDEX "oidc_auth_request_createdAt_idx" ON "oidc_auth_request"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "totp_enrollment_userId_key" ON "totp_enrollment"("userId");

-- CreateIndex
CREATE INDEX "totp_enrollment_userId_idx" ON "totp_enrollment"("userId");

-- CreateIndex
CREATE INDEX "totp_enrollment_createdAt_idx" ON "totp_enrollment"("createdAt");

-- CreateIndex
CREATE INDEX "device_cursor_userId_idx" ON "device_cursor"("userId");

-- CreateIndex
CREATE INDEX "device_cursor_clientId_idx" ON "device_cursor"("clientId");

-- CreateIndex
CREATE INDEX "device_cursor_updatedAt_idx" ON "device_cursor"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "device_cursor_userId_clientId_key" ON "device_cursor"("userId", "clientId");

-- CreateIndex
CREATE INDEX "app_config_createdAt_idx" ON "app_config"("createdAt");

-- CreateIndex
CREATE INDEX "app_config_updatedAt_idx" ON "app_config"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_config_userId_key" ON "ai_config"("userId");

-- CreateIndex
CREATE INDEX "ai_config_userId_idx" ON "ai_config"("userId");

-- CreateIndex
CREATE INDEX "document_chunk_userId_idx" ON "document_chunk"("userId");

-- CreateIndex
CREATE INDEX "document_chunk_documentId_idx" ON "document_chunk"("documentId");

-- CreateIndex
CREATE INDEX "conversation_userId_idx" ON "conversation"("userId");

-- CreateIndex
CREATE INDEX "message_conversationId_idx" ON "message"("conversationId");

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_identity" ADD CONSTRAINT "auth_identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_enrollment" ADD CONSTRAINT "totp_enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_cursor" ADD CONSTRAINT "device_cursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_config" ADD CONSTRAINT "ai_config_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
