-- CreateTable
CREATE TABLE IF NOT EXISTS "SpecialWarehouseSnapshot" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "warehouseName" TEXT,
    "itemNo" TEXT NOT NULL,
    "itemName" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialWarehouseSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SpecialWarehouseFirstSeen" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "itemNo" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SpecialWarehouseFirstSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SpecialWarehouseSnapshot_warehouseId_itemNo_idx" ON "SpecialWarehouseSnapshot"("warehouseId", "itemNo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SpecialWarehouseSnapshot_snapshotAt_idx" ON "SpecialWarehouseSnapshot"("snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SpecialWarehouseFirstSeen_warehouseId_itemNo_key" ON "SpecialWarehouseFirstSeen"("warehouseId", "itemNo");
