import { NextResponse } from 'next/server';
import { loadWarehouseStockCache, accurateClient } from '@/lib/accurate';
import { prisma } from '@/lib/prisma';

// ─── Auto-detect special warehouse names ──────────────────
function isSpecialWarehouse(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('gudang ed') ||
    lower.includes('retur') ||
    lower.includes('rusak')
  );
}

// ─── POST: Take a daily snapshot of special warehouse stock ─
export async function POST() {
  try {
    console.log('[Snapshot] Starting daily special warehouse snapshot...');

    // 1. Get warehouse list to find special warehouses
    const specialWarehouses: { id: number; name: string }[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const res = await accurateClient.get('/warehouse/list.do', {
        params: { 'sp.pageSize': 100, 'sp.page': page }
      });
      const list = res.data?.d || [];
      for (const w of list) {
        if (isSpecialWarehouse(w.name || '')) {
          specialWarehouses.push({ id: w.id, name: w.name });
        }
      }
      hasMore = list.length >= 100;
      page++;
    }

    if (specialWarehouses.length === 0) {
      return NextResponse.json({ message: 'No special warehouses found', snapshots: 0 });
    }

    // 2. Load warehouse stock cache
    const warehouseStockMap = await loadWarehouseStockCache();
    if (!warehouseStockMap) {
      return NextResponse.json({ error: 'No warehouse stock cache. Run Force Sync first.' }, { status: 400 });
    }

    // 3. Get item names
    const itemNames = new Map<string, string>();
    let itemPage = 1;
    let itemHasMore = true;
    while (itemHasMore) {
      const res = await accurateClient.get('/item/list.do', {
        params: { fields: 'no,name', 'sp.page': itemPage, 'sp.pageSize': 100 }
      });
      const items = res.data?.d || [];
      for (const i of items) itemNames.set(i.no, i.name || '');
      itemHasMore = items.length >= 100;
      itemPage++;
    }

    // 4. Create snapshot records
    const now = new Date();
    const snapshotRecords: any[] = [];
    const whIds = specialWarehouses.map(w => w.id);

    warehouseStockMap.forEach((whMap, itemNo) => {
      for (const wh of specialWarehouses) {
        const qty = whMap.get(wh.id);
        if (qty && qty !== 0) {
          snapshotRecords.push({
            warehouseId: wh.id,
            warehouseName: wh.name,
            itemNo,
            itemName: itemNames.get(itemNo) || '',
            quantity: qty,
            snapshotAt: now,
          });
        }
      }
    });

    // 5. Batch insert snapshots
    if (snapshotRecords.length > 0) {
      await prisma.specialWarehouseSnapshot.createMany({
        data: snapshotRecords,
      });
    }

    // 6. Fetch transfer history from Accurate to get accurate firstSeenAt dates
    // Map: "warehouseId-itemNo" -> earliest transfer date
    const transferDates = new Map<string, Date>();
    // Also collect per-transfer batches for FIFO aging
    const transferBatches: { warehouseId: number; itemNo: string; transferDate: Date; quantity: number; transferId: number }[] = [];
    let transfersFetched = 0;

    for (const wh of specialWarehouses) {
      try {
        let tPage = 1;
        let tHasMore = true;

        while (tHasMore) {
          const tRes = await accurateClient.get('/item-transfer/list.do', {
            params: {
              fields: 'id,transDate',
              'filter.toWarehouse.id': wh.id,
              'sp.page': tPage,
              'sp.pageSize': 100,
            }
          });

          const transfers = tRes.data?.d || [];
          if (transfers.length === 0) break;

          // Batch get details (max 5 concurrent to respect API limits)
          const batchSize = 5;
          for (let b = 0; b < transfers.length; b += batchSize) {
            const batch = transfers.slice(b, b + batchSize);
            const details = await Promise.all(
              batch.map(async (t: any) => {
                try {
                  const dRes = await accurateClient.get('/item-transfer/detail.do', {
                    params: { id: t.id }
                  });
                  return { detail: dRes.data?.d, transferId: t.id };
                } catch { return null; }
              })
            );

            for (const result of details) {
              if (!result || !result.detail) continue;
              const detail = result.detail;
              const transDate = new Date(detail.transDate);
              const items = detail.detailItem || [];

              for (const item of items) {
                const itemNo = item.item?.no || item.itemNo || '';
                if (!itemNo) continue;
                const qty = item.quantity || item.quantityInBase || 0;
                if (qty <= 0) continue;

                // Track earliest date (for firstSeen)
                const key = `${wh.id}-${itemNo}`;
                const existing = transferDates.get(key);
                if (!existing || transDate < existing) {
                  transferDates.set(key, transDate);
                }

                // Collect batch for FIFO aging
                transferBatches.push({
                  warehouseId: wh.id,
                  itemNo,
                  transferDate: transDate,
                  quantity: qty,
                  transferId: result.transferId,
                });
              }
            }
          }

          transfersFetched += transfers.length;
          tHasMore = transfers.length >= 100;
          tPage++;
        }
      } catch (err: any) {
        console.warn(`[Snapshot] Failed to fetch transfers for ${wh.name}:`, err.message);
      }
    }

    // 6b. Save transfer batches to DB (upsert to prevent duplicates)
    let batchesSaved = 0;
    for (const batch of transferBatches) {
      try {
        await prisma.specialWarehouseTransferBatch.upsert({
          where: {
            warehouseId_itemNo_transferId: {
              warehouseId: batch.warehouseId,
              itemNo: batch.itemNo,
              transferId: batch.transferId,
            }
          },
          create: batch,
          update: { quantity: batch.quantity, transferDate: batch.transferDate },
        });
        batchesSaved++;
      } catch (e: any) {
        // Skip duplicates or errors silently
      }
    }

    console.log(`[Snapshot] Fetched ${transfersFetched} transfers, saved ${batchesSaved} batches, found ${transferDates.size} item-warehouse date pairs`);

    // 7. Update firstSeen records with accurate dates from transfers
    const existingFirstSeen = await prisma.specialWarehouseFirstSeen.findMany({
      where: { warehouseId: { in: whIds } },
    });
    const existingMap = new Map<string, { id: number; firstSeenAt: Date }>();
    existingFirstSeen.forEach(r => existingMap.set(`${r.warehouseId}-${r.itemNo}`, { id: r.id, firstSeenAt: r.firstSeenAt }));

    // Upsert firstSeen: use transfer date if available, otherwise use now
    const upsertPromises: Promise<any>[] = [];
    const uniqueItemKeys = new Set(snapshotRecords.map(r => `${r.warehouseId}-${r.itemNo}`));

    for (const key of uniqueItemKeys) {
      const [whIdStr, ...itemNoParts] = key.split('-');
      const warehouseId = parseInt(whIdStr);
      const itemNo = itemNoParts.join('-'); // Handle item codes with dashes

      const transferDate = transferDates.get(key);
      const firstSeenDate = transferDate || now;

      const existing = existingMap.get(key);

      if (!existing) {
        // New item — create firstSeen
        upsertPromises.push(
          prisma.specialWarehouseFirstSeen.upsert({
            where: { warehouseId_itemNo: { warehouseId, itemNo } },
            create: {
              warehouseId,
              itemNo,
              firstSeenAt: firstSeenDate,
              lastSeenAt: now,
              isActive: true,
            },
            update: { lastSeenAt: now, isActive: true },
          })
        );
      } else if (transferDate && transferDate < existing.firstSeenAt) {
        // Existing but transfer date is earlier — backfill with more accurate date
        upsertPromises.push(
          prisma.specialWarehouseFirstSeen.update({
            where: { id: existing.id },
            data: { firstSeenAt: transferDate, lastSeenAt: now, isActive: true },
          })
        );
      } else {
        // Just update lastSeenAt
        upsertPromises.push(
          prisma.specialWarehouseFirstSeen.update({
            where: { id: existing.id },
            data: { lastSeenAt: now, isActive: true },
          })
        );
      }
    }

    // Execute all upserts in batches of 20
    for (let i = 0; i < upsertPromises.length; i += 20) {
      await Promise.all(upsertPromises.slice(i, i + 20));
    }

    // 8. Mark items that are no longer in warehouse as inactive
    const activeItemKeys = new Set(snapshotRecords.map(r => `${r.warehouseId}-${r.itemNo}`));
    const toDeactivate = existingFirstSeen.filter(
      r => r.isActive && !activeItemKeys.has(`${r.warehouseId}-${r.itemNo}`)
    );
    if (toDeactivate.length > 0) {
      await prisma.specialWarehouseFirstSeen.updateMany({
        where: { id: { in: toDeactivate.map(r => r.id) } },
        data: { isActive: false },
      });
    }

    const backfilled = [...uniqueItemKeys].filter(k => transferDates.has(k)).length;
    console.log(`[Snapshot] Done: ${snapshotRecords.length} snapshots, ${upsertPromises.length} firstSeen updates, ${backfilled} backfilled from transfers, ${toDeactivate.length} deactivated`);

    return NextResponse.json({
      message: 'Snapshot complete',
      snapshots: snapshotRecords.length,
      transfersFetched,
      backfilledDates: backfilled,
      newFirstSeen: upsertPromises.length,
      deactivated: toDeactivate.length,
      warehouses: specialWarehouses.map(w => w.name),
    });

  } catch (error: any) {
    console.error('[Snapshot] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─── GET: Retrieve snapshot history for movement chart ──────
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get('warehouseId');
    const days = parseInt(searchParams.get('days') || '30');

    const since = new Date();
    since.setDate(since.getDate() - days);

    const where: any = { snapshotAt: { gte: since } };
    if (warehouseId) where.warehouseId = parseInt(warehouseId);

    // Get snapshots grouped by date
    const snapshots = await prisma.specialWarehouseSnapshot.findMany({
      where,
      orderBy: { snapshotAt: 'asc' },
      select: {
        warehouseId: true,
        warehouseName: true,
        itemNo: true,
        quantity: true,
        snapshotAt: true,
      },
    });

    // Group by date
    const byDate = new Map<string, { date: string; totalQty: number; totalSKU: number; items: Set<string> }>();
    snapshots.forEach(s => {
      const dateKey = s.snapshotAt.toISOString().split('T')[0];
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, { date: dateKey, totalQty: 0, totalSKU: 0, items: new Set() });
      }
      const entry = byDate.get(dateKey)!;
      entry.totalQty += s.quantity;
      entry.items.add(s.itemNo);
    });

    const movement = Array.from(byDate.values()).map(d => ({
      date: d.date,
      totalQty: Math.round(d.totalQty),
      totalSKU: d.items.size,
    }));

    return NextResponse.json({ movement, totalSnapshots: snapshots.length });

  } catch (error: any) {
    console.error('[Snapshot GET] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
