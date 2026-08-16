-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phoneE164" VARCHAR(16),
    "creditLimitCents" INTEGER NOT NULL DEFAULT 0,
    "defaultPromiseDays" INTEGER NOT NULL DEFAULT 7,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditMovement" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "saleId" UUID,
    "abonoId" UUID,
    "clientOperationId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerId_key" ON "Customer"("customerId");

-- CreateIndex
CREATE INDEX "Customer_ownerId_branchId_active_idx" ON "Customer"("ownerId", "branchId", "active");

-- CreateIndex
CREATE INDEX "CreditMovement_ownerId_branchId_customerId_createdAt_idx" ON "CreditMovement"("ownerId", "branchId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditMovement_clientOperationId_idx" ON "CreditMovement"("clientOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditMovement_saleId_type_key" ON "CreditMovement"("saleId", "type");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMovement" ADD CONSTRAINT "CreditMovement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMovement" ADD CONSTRAINT "CreditMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMovement" ADD CONSTRAINT "CreditMovement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditMovement" ADD CONSTRAINT "CreditMovement_clientOperationId_fkey" FOREIGN KEY ("clientOperationId") REFERENCES "ClientOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
