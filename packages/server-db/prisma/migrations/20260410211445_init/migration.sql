CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "AuthIdentityType" AS ENUM ('PASSWORD', 'OIDC');

-- CreateEnum
CREATE TYPE "AppConfigName" AS ENUM ('ACCOUNT_CREATION_ENABLED', 'PASSWORD_AUTH_ENABLED', 'STORAGE_BACKEND', 'STORAGE_FILESYSTEM_ROOT', 'STORAGE_S3_CONFIG', 'STORAGE_S3_ENDPOINT', 'STORAGE_S3_BUCKET', 'STORAGE_S3_ACCESS_KEY_ID', 'STORAGE_S3_SECRET_ACCESS_KEY', 'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET');

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
    "content" JSONB NOT NULL DEFAULT '{}',
    "markdown" TEXT NOT NULL DEFAULT '',
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "embedded" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
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
CREATE TABLE "folder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("id")
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
    "embedding" vector(4096),
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

-- CreateTable
CREATE TABLE "calendar_connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "accountIdentifier" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalCalendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7c5cdc',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ics_subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7c5cdc',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ics_subscription_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "document_userId_updatedAt_idx" ON "document"("userId", "updatedAt");

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
CREATE INDEX "folder_userId_updatedAt_idx" ON "folder"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "folder_userId_path_key" ON "folder"("userId", "path");

-- CreateIndex
CREATE INDEX "setting_userId_updatedAt_idx" ON "setting"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "setting_userId_key_key" ON "setting"("userId", "key");

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

-- CreateIndex
CREATE INDEX "calendar_connection_userId_idx" ON "calendar_connection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connection_userId_provider_accountIdentifier_key" ON "calendar_connection"("userId", "provider", "accountIdentifier");

-- CreateIndex
CREATE INDEX "calendar_subscription_userId_idx" ON "calendar_subscription"("userId");

-- CreateIndex
CREATE INDEX "calendar_subscription_connectionId_idx" ON "calendar_subscription"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_subscription_userId_connectionId_externalCalendarI_key" ON "calendar_subscription"("userId", "connectionId", "externalCalendarId");

-- CreateIndex
CREATE INDEX "ics_subscription_userId_idx" ON "ics_subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ics_subscription_userId_urlHash_key" ON "ics_subscription"("userId", "urlHash");

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
ALTER TABLE "folder" ADD CONSTRAINT "folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setting" ADD CONSTRAINT "setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "calendar_connection" ADD CONSTRAINT "calendar_connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_subscription" ADD CONSTRAINT "calendar_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_subscription" ADD CONSTRAINT "calendar_subscription_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "calendar_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ics_subscription" ADD CONSTRAINT "ics_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
