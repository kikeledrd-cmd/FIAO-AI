-- CreateTable
CREATE TABLE "PilotEvent" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "branchId" UUID,
    "eventName" VARCHAR(80) NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PilotEvent_ownerId_eventName_occurredAt_idx" ON "PilotEvent"("ownerId", "eventName", "occurredAt");

-- CreateIndex
CREATE INDEX "PilotEvent_ownerId_occurredAt_idx" ON "PilotEvent"("ownerId", "occurredAt");

-- AddForeignKey
ALTER TABLE "PilotEvent" ADD CONSTRAINT "PilotEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "OwnerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotEvent" ADD CONSTRAINT "PilotEvent_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
