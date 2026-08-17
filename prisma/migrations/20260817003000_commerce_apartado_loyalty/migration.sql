-- AlterTable
ALTER TABLE "ProductStock" ADD COLUMN     "reserved" TEXT NOT NULL DEFAULT '0';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "apartadoId" UUID,
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promotionIds" JSONB,
ADD COLUMN     "reward" JSONB;

-- CreateTable
CREATE TABLE "Apartado" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "apartadoId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "depositCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "promiseDate" TIMESTAMP(3),
    "notes" VARCHAR(300),
    "actorUserId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "clientOperationId" UUID,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Apartado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApartadoLine" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "apartadoId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" VARCHAR(32) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,

    CONSTRAINT "ApartadoLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyConfig" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pointsPerHundredCents" INTEGER NOT NULL DEFAULT 100,
    "expiryDays" INTEGER NOT NULL DEFAULT 180,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyMovement" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "movementId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "pointsDelta" INTEGER NOT NULL,
    "saleId" UUID,
    "rewardId" UUID,
    "reason" VARCHAR(300),
    "expiresAt" TIMESTAMP(3),
    "clientOperationId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyReward" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "rewardId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" TEXT NOT NULL,
    "productId" UUID,
    "discountCents" INTEGER,
    "pointsCost" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "productId" UUID,
    "percentOffCents" INTEGER,
    "fixedOffCents" INTEGER,
    "buyQty" INTEGER,
    "getQty" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Apartado_apartadoId_key" ON "Apartado"("apartadoId");

-- CreateIndex
CREATE INDEX "Apartado_ownerId_branchId_status_createdAt_idx" ON "Apartado"("ownerId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Apartado_customerId_idx" ON "Apartado"("customerId");

-- CreateIndex
CREATE INDEX "ApartadoLine_ownerId_branchId_productId_idx" ON "ApartadoLine"("ownerId", "branchId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyConfig_ownerId_key" ON "LoyaltyConfig"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyMovement_movementId_key" ON "LoyaltyMovement"("movementId");

-- CreateIndex
CREATE INDEX "LoyaltyMovement_ownerId_branchId_customerId_occurredAt_idx" ON "LoyaltyMovement"("ownerId", "branchId", "customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "LoyaltyMovement_clientOperationId_idx" ON "LoyaltyMovement"("clientOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyReward_rewardId_key" ON "LoyaltyReward"("rewardId");

-- CreateIndex
CREATE INDEX "LoyaltyReward_ownerId_active_idx" ON "LoyaltyReward"("ownerId", "active");

-- CreateIndex
CREATE INDEX "Promotion_ownerId_active_idx" ON "Promotion"("ownerId", "active");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_apartadoId_fkey" FOREIGN KEY ("apartadoId") REFERENCES "Apartado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Apartado" ADD CONSTRAINT "Apartado_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Apartado" ADD CONSTRAINT "Apartado_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Apartado" ADD CONSTRAINT "Apartado_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Apartado" ADD CONSTRAINT "Apartado_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Apartado" ADD CONSTRAINT "Apartado_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Apartado" ADD CONSTRAINT "Apartado_clientOperationId_fkey" FOREIGN KEY ("clientOperationId") REFERENCES "ClientOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartadoLine" ADD CONSTRAINT "ApartadoLine_apartadoId_fkey" FOREIGN KEY ("apartadoId") REFERENCES "Apartado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartadoLine" ADD CONSTRAINT "ApartadoLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartadoLine" ADD CONSTRAINT "ApartadoLine_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartadoLine" ADD CONSTRAINT "ApartadoLine_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyConfig" ADD CONSTRAINT "LoyaltyConfig_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyMovement" ADD CONSTRAINT "LoyaltyMovement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyMovement" ADD CONSTRAINT "LoyaltyMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyMovement" ADD CONSTRAINT "LoyaltyMovement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyMovement" ADD CONSTRAINT "LoyaltyMovement_clientOperationId_fkey" FOREIGN KEY ("clientOperationId") REFERENCES "ClientOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
