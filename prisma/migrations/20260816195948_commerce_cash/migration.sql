-- CreateTable
CREATE TABLE "CashSession" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedById" UUID NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "openingFloatCents" INTEGER NOT NULL,
    "closedById" UUID,
    "closedAt" TIMESTAMP(3),
    "countedCents" INTEGER,
    "differenceCents" INTEGER,
    "openUniqueKey" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "movementId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" VARCHAR(60),
    "description" VARCHAR(300),
    "reason" VARCHAR(300),
    "actorUserId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "clientOperationId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashSession_sessionId_key" ON "CashSession"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CashSession_openUniqueKey_key" ON "CashSession"("openUniqueKey");

-- CreateIndex
CREATE INDEX "CashSession_ownerId_branchId_status_idx" ON "CashSession"("ownerId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_movementId_key" ON "CashMovement"("movementId");

-- CreateIndex
CREATE INDEX "CashMovement_ownerId_branchId_sessionId_createdAt_idx" ON "CashMovement"("ownerId", "branchId", "sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "CashMovement_clientOperationId_idx" ON "CashMovement"("clientOperationId");

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_clientOperationId_fkey" FOREIGN KEY ("clientOperationId") REFERENCES "ClientOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
