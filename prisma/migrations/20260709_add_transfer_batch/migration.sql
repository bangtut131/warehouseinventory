-- CreateTable: SpecialWarehouseTransferBatch for FIFO aging
CREATE TABLE IF NOT EXISTS "SpecialWarehouseTransferBatch" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "itemNo" TEXT NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "transferId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialWarehouseTransferBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SpecialWarehouseTransferBatch_warehouseId_itemNo_idx" ON "SpecialWarehouseTransferBatch"("warehouseId", "itemNo");
CREATE INDEX IF NOT EXISTS "SpecialWarehouseTransferBatch_transferDate_idx" ON "SpecialWarehouseTransferBatch"("transferDate");
CREATE UNIQUE INDEX IF NOT EXISTS "SpecialWarehouseTransferBatch_warehouseId_itemNo_transferId_key" ON "SpecialWarehouseTransferBatch"("warehouseId", "itemNo", "transferId");
