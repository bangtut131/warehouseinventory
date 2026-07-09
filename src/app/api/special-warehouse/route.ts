import { NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';
import { loadWarehouseStockCache } from '@/lib/accurate';
import { prisma } from '@/lib/prisma';

// ─── Warehouse Category Detection ─────────────────────────
interface SpecialWarehouse {
  id: number;
  name: string;
  category: 'expired' | 'retur' | 'rusak';
  subCategory?: string;
}

function categorizeWarehouse(name: string): { category: SpecialWarehouse['category']; subCategory?: string } | null {
  const lower = name.toLowerCase().trim();
  if (lower === 'gudang ed barang nn' || lower === 'gudang ed nn') {
    return { category: 'expired', subCategory: 'nn' };
  }
  if (lower === 'gudang ed') {
    return { category: 'expired', subCategory: 'reguler' };
  }
  if (lower.includes('gudang ed') && !lower.includes('nn')) {
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

// ─── Aging bracket helper ──────────────────────────────────
const AGING_BRACKETS = ['0-7', '8-15', '16-30', '31-45', '46-60', '61-90', '91-120', '120+'] as const;
type AgingBracket = typeof AGING_BRACKETS[number];

function getAgingBracket(days: number): AgingBracket {
  if (days <= 7) return '0-7';
  if (days <= 15) return '8-15';
  if (days <= 30) return '16-30';
  if (days <= 45) return '31-45';
  if (days <= 60) return '46-60';
  if (days <= 90) return '61-90';
  if (days <= 120) return '91-120';
  return '120+';
}

// ─── Fetch special warehouses (lightweight) ────────────────
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
      if (cat) result.push({ id: w.id, name: w.name, category: cat.category, subCategory: cat.subCategory });
    }
    hasMore = list.length >= 100;
    page++;
  }
  return result;
}

// ─── Main GET handler (FAST — reads from cache + DB only) ──
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filterType = searchParams.get('type');

    // 1. Get special warehouses
    const specialWarehouses = await getSpecialWarehouses();
    const filtered = filterType
      ? specialWarehouses.filter(w => w.category === filterType)
      : specialWarehouses;

    if (filtered.length === 0) {
      return NextResponse.json({
        warehouses: [], items: [],
        summary: { totalSKU: 0, totalQty: 0, totalValue: 0, avgAgingDays: 0 },
        agingDistribution: {},
      });
    }

    // 2. Load warehouse stock from cache (fast — already in memory/DB)
    const warehouseStockMap = await loadWarehouseStockCache();
    if (!warehouseStockMap) {
      return NextResponse.json({
        error: 'Warehouse stock cache belum tersedia. Jalankan Force Sync dulu.',
        warehouses: filtered, items: [],
        summary: { totalSKU: 0, totalQty: 0, totalValue: 0, avgAgingDays: 0 },
      });
    }

    // 3. Get item names from Accurate (lightweight list call)
    const itemMaster = new Map<string, { name: string; avgCost: number; unit: string; ratio2: number }>();
    let itemPage = 1;
    let itemHasMore = true;
    while (itemHasMore) {
      const res = await accurateClient.get('/item/list.do', {
        params: { fields: 'no,name,averageCost,unitPrice,unit1Name,ratio2', 'sp.page': itemPage, 'sp.pageSize': 100 }
      });
      const list = res.data?.d || [];
      for (const i of list) {
        itemMaster.set(i.no, {
          name: i.name || '',
          avgCost: i.averageCost || i.unitPrice || 0,
          unit: i.unit1Name || 'Pcs',
          ratio2: i.ratio2 || 0,
        });
      }
      itemHasMore = list.length >= 100;
      itemPage++;
    }

    // 4. Get transfer batches from DB for FIFO aging (fast — stored by Snapshot)
    const whIds = filtered.map(w => w.id);
    const transferBatches = await prisma.specialWarehouseTransferBatch.findMany({
      where: { warehouseId: { in: whIds } },
      orderBy: { transferDate: 'asc' }, // FIFO: oldest first
    });

    // Group batches by "warehouseId-itemNo"
    const batchMap = new Map<string, { transferDate: Date; quantity: number }[]>();
    transferBatches.forEach(b => {
      const key = `${b.warehouseId}-${b.itemNo}`;
      if (!batchMap.has(key)) batchMap.set(key, []);
      batchMap.get(key)!.push({ transferDate: b.transferDate, quantity: b.quantity });
    });

    // Also get firstSeen as fallback for items without transfer batches
    const firstSeenRecords = await prisma.specialWarehouseFirstSeen.findMany({
      where: { warehouseId: { in: whIds }, isActive: true },
    });
    const firstSeenMap = new Map<string, Date>();
    firstSeenRecords.forEach(r => firstSeenMap.set(`${r.warehouseId}-${r.itemNo}`, r.firstSeenAt));

    // 5. Build items with FIFO aging from transfer batches
    const now = new Date();
    const resultItems: any[] = [];

    for (const wh of filtered) {
      warehouseStockMap.forEach((whMap, itemNo) => {
        let qty = whMap.get(wh.id);
        if (!qty || qty <= 0) return;

        const info = itemMaster.get(itemNo);
        let unit = info?.unit || 'Pcs';
        let unitCost = info?.avgCost || 0;

        // ── Sak/Bulk Unit Conversion (same logic as inventory route) ──
        const itemNameLower = (info?.name || '').toLowerCase();
        const isKgItem = itemNameLower.includes('kg');
        let sakConversion = info?.ratio2 && info.ratio2 > 1 ? info.ratio2 : 0;

        // Fallback: extract weight from item name (e.g. "NPK 16.16.16 50 Kg" → 50)
        if (isKgItem && sakConversion < 25) {
          const weightMatch = (info?.name || '').match(/(\d+)\s*[Kk][Gg]/);
          if (weightMatch) {
            const nameWeight = parseInt(weightMatch[1], 10);
            if (nameWeight >= 20) sakConversion = nameWeight;
          }
        }

        const isBulkUnit = isKgItem && sakConversion >= 25;
        if (isBulkUnit) {
          qty = parseFloat((qty / sakConversion).toFixed(2));
          unit = 'Sak';
        }

        // ── FIFO Aging: distribute stock across transfer batches ──
        const agingBrackets: Record<AgingBracket, number> = {
          '0-7': 0, '8-15': 0, '16-30': 0, '31-45': 0,
          '46-60': 0, '61-90': 0, '91-120': 0, '120+': 0,
        };

        const key = `${wh.id}-${itemNo}`;
        const batches = batchMap.get(key);
        let weightedDays = 0;
        let assignedQty = 0;

        if (batches && batches.length > 0) {
          let remainingStock = qty;

          for (const batch of batches) {
            if (remainingStock <= 0) break;

            let batchQty = batch.quantity;
            // If Sak item, convert batch qty too
            if (isBulkUnit) {
              batchQty = parseFloat((batchQty / sakConversion).toFixed(2));
            }

            const used = Math.min(remainingStock, batchQty);
            const days = Math.max(0, Math.floor((now.getTime() - batch.transferDate.getTime()) / (1000 * 60 * 60 * 24)));
            const bracket = getAgingBracket(days);

            agingBrackets[bracket] += parseFloat(used.toFixed(2));
            weightedDays += days * used;
            assignedQty += used;
            remainingStock -= used;
          }

          // If stock > total batches (items added before system), put remainder in oldest bracket
          if (remainingStock > 0.01) {
            const oldestDate = batches[0].transferDate;
            const days = Math.max(0, Math.floor((now.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24)));
            const bracket = getAgingBracket(days);
            agingBrackets[bracket] += parseFloat(remainingStock.toFixed(2));
            weightedDays += days * remainingStock;
            assignedQty += remainingStock;
          }
        } else {
          // Fallback: use firstSeen (all qty in one bracket)
          const firstSeen = firstSeenMap.get(key);
          const days = firstSeen
            ? Math.max(0, Math.floor((now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24)))
            : 0;
          const bracket = getAgingBracket(days);
          agingBrackets[bracket] = qty;
          weightedDays = days * qty;
          assignedQty = qty;
        }

        const avgAgingDays = assignedQty > 0 ? Math.round(weightedDays / assignedQty) : 0;

        const value = qty * unitCost;

        resultItems.push({
          warehouseId: wh.id,
          warehouseName: wh.name,
          category: wh.category,
          subCategory: wh.subCategory,
          itemNo,
          itemName: info?.name || itemNo,
          unit,
          quantity: qty,
          unitCost,
          value,
          firstSeenAt: firstSeenMap.get(`${wh.id}-${itemNo}`)?.toISOString() || null,
          avgAgingDays,
          agingBrackets,
          hasBatches: !!(batches && batches.length > 0),
        });
      });
    }

    // Sort by aging descending
    resultItems.sort((a, b) => b.avgAgingDays - a.avgAgingDays);

    // Summary
    const totalQty = resultItems.reduce((s, i) => s + i.quantity, 0);
    const totalValue = resultItems.reduce((s, i) => s + i.value, 0);
    const avgAgingDays = resultItems.length > 0
      ? Math.round(resultItems.reduce((s, i) => s + i.avgAgingDays * i.quantity, 0) / (totalQty || 1))
      : 0;
    const noFirstSeen = resultItems.filter(i => !i.hasFirstSeen).length;

    // Global aging distribution
    const agingDistribution: Record<string, number> = {};
    AGING_BRACKETS.forEach(b => { agingDistribution[b] = 0; });
    resultItems.forEach(item => {
      AGING_BRACKETS.forEach(b => { agingDistribution[b] += item.agingBrackets[b] || 0; });
    });

    return NextResponse.json({
      warehouses: filtered,
      items: resultItems,
      summary: { totalSKU: resultItems.length, totalQty: Math.round(totalQty), totalValue: Math.round(totalValue), avgAgingDays },
      agingDistribution,
      noFirstSeen, // Items that haven't been snapshotted yet
    });

  } catch (error: any) {
    console.error('[SpecialWH] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
