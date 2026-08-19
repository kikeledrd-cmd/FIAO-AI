-- CreateTable
CREATE TABLE "AiAuditLog" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "actorRole" VARCHAR(16) NOT NULL,
    "commandText" VARCHAR(1000) NOT NULL,
    "transcription" VARCHAR(1000),
    "intentKind" VARCHAR(16) NOT NULL,
    "intentTool" VARCHAR(40) NOT NULL,
    "label" VARCHAR(20),
    "confirmationToken" UUID,
    "authorizationId" UUID,
    "resultJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiActionToken" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "tokenId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "intentTool" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "requiresOwnerPin" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAuditLog_ownerId_branchId_createdAt_idx" ON "AiAuditLog"("ownerId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAuditLog_actorUserId_idx" ON "AiAuditLog"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AiActionToken_tokenId_key" ON "AiActionToken"("tokenId");

-- CreateIndex
CREATE INDEX "AiActionToken_ownerId_branchId_createdAt_idx" ON "AiActionToken"("ownerId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "AiActionToken_actorUserId_consumedAt_idx" ON "AiActionToken"("actorUserId", "consumedAt");

-- AddForeignKey
ALTER TABLE "AiAuditLog" ADD CONSTRAINT "AiAuditLog_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAuditLog" ADD CONSTRAINT "AiAuditLog_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAuditLog" ADD CONSTRAINT "AiAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionToken" ADD CONSTRAINT "AiActionToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionToken" ADD CONSTRAINT "AiActionToken_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiActionToken" ADD CONSTRAINT "AiActionToken_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
