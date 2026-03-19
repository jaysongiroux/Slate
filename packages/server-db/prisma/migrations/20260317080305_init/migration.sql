-- CreateEnum
CREATE TYPE "AuthIdentityType" AS ENUM ('PASSWORD', 'OIDC');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER');

-- CreateEnum
CREATE TYPE "AppConfigName" AS ENUM ('ACCOUNT_CREATION_ENABLED', 'PASSWORD_AUTH_ENABLED');

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
CREATE TABLE "workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_member" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "plainText" TEXT NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "acceptedRevision" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
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
CREATE TABLE "client_binding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "lastSeenRevision" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_config" (
    "name" "AppConfigName" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("name")
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
CREATE INDEX "workspace_ownerUserId_idx" ON "workspace"("ownerUserId");

-- CreateIndex
CREATE INDEX "workspace_id_idx" ON "workspace"("id");

-- CreateIndex
CREATE INDEX "workspace_createdAt_idx" ON "workspace"("createdAt");

-- CreateIndex
CREATE INDEX "workspace_member_workspaceId_userId_idx" ON "workspace_member"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "workspace_member_createdAt_idx" ON "workspace_member"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_member_workspaceId_userId_key" ON "workspace_member"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "document_workspaceId_acceptedRevision_idx" ON "document"("workspaceId", "acceptedRevision");

-- CreateIndex
CREATE INDEX "document_ownerUserId_idx" ON "document"("ownerUserId");

-- CreateIndex
CREATE INDEX "document_createdAt_idx" ON "document"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "document_workspaceId_path_key" ON "document"("workspaceId", "path");

-- CreateIndex
CREATE INDEX "attachment_workspaceId_idx" ON "attachment"("workspaceId");

-- CreateIndex
CREATE INDEX "attachment_documentId_idx" ON "attachment"("documentId");

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
CREATE INDEX "client_binding_workspaceId_idx" ON "client_binding"("workspaceId");

-- CreateIndex
CREATE INDEX "client_binding_clientId_idx" ON "client_binding"("clientId");

-- CreateIndex
CREATE INDEX "client_binding_updatedAt_idx" ON "client_binding"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "client_binding_workspaceId_clientId_key" ON "client_binding"("workspaceId", "clientId");

-- CreateIndex
CREATE INDEX "app_config_createdAt_idx" ON "app_config"("createdAt");

-- CreateIndex
CREATE INDEX "app_config_updatedAt_idx" ON "app_config"("updatedAt");

-- AddForeignKey
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_identity" ADD CONSTRAINT "auth_identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_enrollment" ADD CONSTRAINT "totp_enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_binding" ADD CONSTRAINT "client_binding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
