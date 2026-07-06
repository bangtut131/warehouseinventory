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

    // 6. Update firstSeen records
    const existingFirstSeen = await prisma.specialWarehouseFirstSeen.findMany({
      where: { warehouseId: { in: whIds } },
    });
    const existingMap = new Map<string, boolean>();
    existingFirstSeen.forEach(r => existingMap.set(`${r.warehouseId}-${r.itemNo}`, true));

    // New items: create firstSeen
    const newItems = snapshotRecords.filter(r => !existingMap.has(`${r.warehouseId}-${r.itemNo}`));
    if (newItems.length > 0) {
      await Promise.all(
        newItems.map(item =>
          prisma.specialWarehouseFirstSeen.upsert({
            where: {
              warehouseId_itemNo: { warehouseId: item.warehouseId, itemNo: item.itemNo },
            },
            create: {
              warehouseId: item.warehouseId,
              itemNo: item.itemNo,
              firstSeenAt: now,
              lastSeenAt: now,
              isActive: true,
            },
            update: { lastSeenAt: now, isActive: true },
          })
        )
      );
    }

    // Mark items that are no longer in warehouse as inactive
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

    console.log(`[Snapshot] Done: ${snapshotRecords.length} records, ${newItems.length} new, ${toDeactivate.length} deactivated`);

    return NextResponse.json({
      message: 'Snapshot complete',
      snapshots: snapshotRecords.length,
      newItems: newItems.length,
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
