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
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#7c5cdc',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ics_subscription_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "ics_subscription_userId_url_key" ON "ics_subscription"("userId", "url");

-- AddForeignKey
ALTER TABLE "calendar_connection" ADD CONSTRAINT "calendar_connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_subscription" ADD CONSTRAINT "calendar_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_subscription" ADD CONSTRAINT "calendar_subscription_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "calendar_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ics_subscription" ADD CONSTRAINT "ics_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
