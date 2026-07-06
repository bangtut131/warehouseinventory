import { NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';
import { loadWarehouseStockCache } from '@/lib/accurate';
import { prisma } from '@/lib/prisma';

// ─── Warehouse Category Detection ─────────────────────────
interface SpecialWarehouse {
  id: number;
  name: string;
  category: 'expired' | 'retur' | 'rusak';
  subCategory?: string; // 'reguler' | 'nn' for expired
}

function categorizeWarehouse(name: string): { category: SpecialWarehouse['category']; subCategory?: string } | null {
  const lower = name.toLowerCase();
  if (lower === 'gudang ed barang nn' || lower === 'gudang ed nn') {
    return { category: 'expired', subCategory: 'nn' };
  }
  if (lower === 'gudang ed' || lower.includes('gudang ed')) {
    return { category: 'expired', subCategory: 'reguler' };
  }
  if (lower === 'gudang retur' || lower.includes('retur')) {
    return { category: 'retur' };
  }
  if (lower === 'gudang rusak' || lower.includes('rusak')) {
    return { category: 'rusak' };
  }
  return null;
}

// ─── Fetch all warehouses and identify special ones ────────
async function getSpecialWarehouses(): Promise<SpecialWarehouse[]> {
  const result: SpecialWarehouse[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await accurateClient.get('/warehouse/list.do', {
      params: { 'sp.pageSize': 100, 'sp.page': page }
    });
    const list = res.data?.d || [];
    for (const w of list) {
      const cat = categorizeWarehouse(w.name || '');
      if (cat) {
        result.push({
          id: w.id,
          name: w.name,
          category: cat.category,
          subCategory: cat.subCategory,
        });
      }
    }
    hasMore = list.length >= 100;
    page++;
  }

  return result;
}

// ─── Fetch item transfer history for a warehouse ───────────
interface TransferEntry {
  itemNo: string;
  transDate: string;
  quantity: number;
  fromWarehouse: string;
  toWarehouse: string;
}

async function fetchTransfersToWarehouse(warehouseId: number, warehouseName: string): Promise<Map<string, Date>> {
  // Map: itemNo -> earliest transfer date into this warehouse
  const firstTransferMap = new Map<string, Date>();

  try {
    let page = 1;
    let hasMore = true;
    let totalFetched = 0;

    while (hasMore) {
      const res = await accurateClient.get('/item-transfer/list.do', {
        params: {
          fields: 'id,transDate,toWarehouseName',
          'filter.toWarehouse.id': warehouseId,
          'sp.page': page,
          'sp.pageSize': 100,
        }
      });

      const transfers = res.data?.d || [];
      if (transfers.length === 0) break;

      // Get detail for each transfer to get item-level info
      for (const t of transfers) {
        try {
          const detailRes = await accurateClient.get('/item-transfer/detail.do', {
            params: { id: t.id }
          });
          const detail = detailRes.data?.d;
          if (!detail) continue;

          const transDate = new Date(detail.transDate);
          const items = detail.detailItem || [];

          for (const item of items) {
            const itemNo = item.item?.no || item.itemNo;
            if (!itemNo) continue;

            const existing = firstTransferMap.get(itemNo);
            if (!existing || transDate < existing) {
              firstTransferMap.set(itemNo, transDate);
            }
          }
        } catch (err: any) {
          console.warn(`[SpecialWH] Failed to get transfer detail ${t.id}:`, err.message);
        }
      }

      totalFetched += transfers.length;
      hasMore = transfers.length >= 100;
      page++;
    }

    console.log(`[SpecialWH] Fetched ${totalFetched} transfers to ${warehouseName} (${firstTransferMap.size} unique items)`);
  } catch (err: any) {
    console.warn(`[SpecialWH] Failed to fetch transfers for ${warehouseName}:`, err.message);
  }

  return firstTransferMap;
}

// ─── Main GET handler ──────────────────────────────────────
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filterType = searchParams.get('type'); // expired | retur | rusak | null (all)

    // 1. Get special warehouses
    const specialWarehouses = await getSpecialWarehouses();
    const filtered = filterType
      ? specialWarehouses.filter(w => w.category === filterType)
      : specialWarehouses;

    if (filtered.length === 0) {
      return NextResponse.json({
        warehouses: [],
        items: [],
        summary: { totalSKU: 0, totalQty: 0, totalValue: 0, avgAgingDays: 0 },
      });
    }

    // 2. Load warehouse stock from cache
    const warehouseStockMap = await loadWarehouseStockCache();
    if (!warehouseStockMap) {
      return NextResponse.json({
        error: 'Warehouse stock cache not available. Run Force Sync first.',
        warehouses: filtered,
        items: [],
        summary: { totalSKU: 0, totalQty: 0, totalValue: 0, avgAgingDays: 0 },
      });
    }

    // 3. Get item master data for names/prices
    const allItems: Map<string, { name: string; cost: number; unit: string }> = new Map();
    let itemPage = 1;
    let itemHasMore = true;
    while (itemHasMore) {
      const res = await accurateClient.get('/item/list.do', {
        params: {
          fields: 'no,name,cost,unit1Name',
          'sp.page': itemPage,
          'sp.pageSize': 100,
        }
      });
      const items = res.data?.d || [];
      for (const i of items) {
        allItems.set(i.no, { name: i.name || '', cost: i.cost || 0, unit: i.unit1Name || 'Pcs' });
      }
      itemHasMore = items.length >= 100;
      itemPage++;
    }

    // 4. Get firstSeen data from DB
    const whIds = filtered.map(w => w.id);
    const firstSeenRecords = await prisma.specialWarehouseFirstSeen.findMany({
      where: { warehouseId: { in: whIds } },
    });
    const firstSeenMap = new Map<string, Date>();
    firstSeenRecords.forEach(r => {
      firstSeenMap.set(`${r.warehouseId}-${r.itemNo}`, r.firstSeenAt);
    });

    // 5. Build items list with aging
    const now = new Date();
    const resultItems: any[] = [];

    for (const wh of filtered) {
      // Get all items with stock in this warehouse
      warehouseStockMap.forEach((whMap, itemNo) => {
        const qty = whMap.get(wh.id);
        if (!qty || qty <= 0) return;

        const itemInfo = allItems.get(itemNo);
        const firstSeenKey = `${wh.id}-${itemNo}`;
        let firstSeenAt = firstSeenMap.get(firstSeenKey);

        // If no firstSeen record, create one now
        if (!firstSeenAt) {
          firstSeenAt = now;
          // Will be saved in batch below
        }

        const agingDays = Math.floor((now.getTime() - firstSeenAt.getTime()) / (1000 * 60 * 60 * 24));
        const value = qty * (itemInfo?.cost || 0);

        resultItems.push({
          warehouseId: wh.id,
          warehouseName: wh.name,
          category: wh.category,
          subCategory: wh.subCategory,
          itemNo,
          itemName: itemInfo?.name || itemNo,
          unit: itemInfo?.unit || 'Pcs',
          quantity: qty,
          value,
          firstSeenAt: firstSeenAt.toISOString(),
          agingDays,
          agingBracket: getAgingBracket(agingDays),
        });
      });
    }

    // 6. Batch upsert firstSeen for new items
    const newFirstSeen = resultItems.filter(item => !firstSeenMap.has(`${item.warehouseId}-${item.itemNo}`));
    if (newFirstSeen.length > 0) {
      await Promise.all(
        newFirstSeen.map(item =>
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
            update: {
              lastSeenAt: now,
              isActive: true,
            },
          })
        )
      );
      console.log(`[SpecialWH] Created/updated ${newFirstSeen.length} firstSeen records`);
    }

    // 7. Sort by aging (oldest first)
    resultItems.sort((a, b) => b.agingDays - a.agingDays);

    // 8. Summary
    const totalQty = resultItems.reduce((s, i) => s + i.quantity, 0);
    const totalValue = resultItems.reduce((s, i) => s + i.value, 0);
    const avgAgingDays = resultItems.length > 0
      ? Math.round(resultItems.reduce((s, i) => s + i.agingDays, 0) / resultItems.length)
      : 0;

    // 9. Aging distribution
    const agingDistribution = {
      '0-7': resultItems.filter(i => i.agingDays <= 7).length,
      '8-15': resultItems.filter(i => i.agingDays >= 8 && i.agingDays <= 15).length,
      '16-30': resultItems.filter(i => i.agingDays >= 16 && i.agingDays <= 30).length,
      '31-45': resultItems.filter(i => i.agingDays >= 31 && i.agingDays <= 45).length,
      '46-60': resultItems.filter(i => i.agingDays >= 46 && i.agingDays <= 60).length,
      '61-90': resultItems.filter(i => i.agingDays >= 61 && i.agingDays <= 90).length,
      '91-120': resultItems.filter(i => i.agingDays >= 91 && i.agingDays <= 120).length,
      '120+': resultItems.filter(i => i.agingDays > 120).length,
    };

    return NextResponse.json({
      warehouses: filtered,
      items: resultItems,
      summary: {
        totalSKU: resultItems.length,
        totalQty: Math.round(totalQty),
        totalValue: Math.round(totalValue),
        avgAgingDays,
      },
      agingDistribution,
    });

  } catch (error: any) {
    console.error('[SpecialWH] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ─── Aging bracket helper ──────────────────────────────────
function getAgingBracket(days: number): string {
  if (days <= 7) return '0-7';
  if (days <= 15) return '8-15';
  if (days <= 30) return '16-30';
  if (days <= 45) return '31-45';
  if (days <= 60) return '46-60';
  if (days <= 90) return '61-90';
  if (days <= 120) return '91-120';
  return '120+';
}
