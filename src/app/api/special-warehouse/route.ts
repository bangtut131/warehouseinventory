import { NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';
import { loadWarehouseStockCache } from '@/lib/accurate';

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
  // Fallback: contains "gudang ed" but not NN
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

// ─── Fetch special warehouses ──────────────────────────────
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

// ─── Fetch item master data (name + price) ─────────────────
async function getItemMasterData(): Promise<Map<string, { name: string; avgCost: number; unit: string }>> {
  const items = new Map<string, { name: string; avgCost: number; unit: string }>();
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const res = await accurateClient.get('/item/list.do', {
      params: {
        fields: 'no,name,averageCost,unitPrice,unit1Name',
        'sp.page': page,
        'sp.pageSize': 100,
      }
    });
    const list = res.data?.d || [];
    for (const i of list) {
      items.set(i.no, {
        name: i.name || '',
        avgCost: i.averageCost || i.unitPrice || 0,
        unit: i.unit1Name || 'Pcs',
      });
    }
    hasMore = list.length >= 100;
    page++;
  }
  return items;
}

// ─── Transfer batch: date + qty of each inbound transfer ───
interface TransferBatch {
  transDate: Date;
  quantity: number;
}

// ─── Fetch ALL transfer batches into a warehouse ───────────
async function fetchTransferBatches(warehouseId: number, warehouseName: string): Promise<Map<string, TransferBatch[]>> {
  // Map: itemNo -> list of transfer batches (date + qty)
  const batchMap = new Map<string, TransferBatch[]>();

  try {
    let page = 1;
    let hasMore = true;
    let totalTransfers = 0;

    while (hasMore) {
      const res = await accurateClient.get('/item-transfer/list.do', {
        params: {
          fields: 'id,transDate',
          'filter.toWarehouse.id': warehouseId,
          'sp.page': page,
          'sp.pageSize': 100,
        }
      });

      const transfers = res.data?.d || [];
      if (transfers.length === 0) break;

      // Batch get details (5 concurrent for API rate limits)
      for (let b = 0; b < transfers.length; b += 5) {
        const batch = transfers.slice(b, b + 5);
        const details = await Promise.all(
          batch.map(async (t: any) => {
            try {
              const dRes = await accurateClient.get('/item-transfer/detail.do', { params: { id: t.id } });
              return dRes.data?.d;
            } catch { return null; }
          })
        );

        for (const detail of details) {
          if (!detail) continue;
          const transDate = new Date(detail.transDate);
          const items = detail.detailItem || [];

          for (const item of items) {
            const itemNo = item.item?.no || item.itemNo || '';
            if (!itemNo) continue;
            const qty = Math.abs(item.quantity || 0);
            if (qty === 0) continue;

            if (!batchMap.has(itemNo)) batchMap.set(itemNo, []);
            batchMap.get(itemNo)!.push({ transDate, quantity: qty });
          }
        }
      }

      totalTransfers += transfers.length;
      hasMore = transfers.length >= 100;
      page++;
    }

    console.log(`[SpecialWH] Fetched ${totalTransfers} transfers for ${warehouseName}, ${batchMap.size} items`);
  } catch (err: any) {
    console.warn(`[SpecialWH] Failed to fetch transfers for ${warehouseName}:`, err.message);
  }

  return batchMap;
}

// ─── Distribute current stock across transfer batches (FIFO aging) ──
function distributeStockFIFO(
  currentQty: number,
  batches: TransferBatch[],
  now: Date
): Record<AgingBracket, number> {
  const result: Record<AgingBracket, number> = {
    '0-7': 0, '8-15': 0, '16-30': 0, '31-45': 0,
    '46-60': 0, '61-90': 0, '91-120': 0, '120+': 0,
  };

  if (batches.length === 0 || currentQty <= 0) return result;

  // Sort oldest first (FIFO: oldest stock stays)
  const sorted = [...batches].sort((a, b) => a.transDate.getTime() - b.transDate.getTime());

  let remaining = currentQty;
  for (const batch of sorted) {
    if (remaining <= 0) break;
    const allocate = Math.min(batch.quantity, remaining);
    const agingDays = Math.max(0, Math.floor((now.getTime() - batch.transDate.getTime()) / (1000 * 60 * 60 * 24)));
    const bracket = getAgingBracket(agingDays);
    result[bracket] += allocate;
    remaining -= allocate;
  }

  // If remaining > 0 (more stock than total transfers), put in 120+
  if (remaining > 0) {
    result['120+'] += remaining;
  }

  return result;
}

// ─── Main GET handler ──────────────────────────────────────
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

    // 2. Load warehouse stock from cache
    const warehouseStockMap = await loadWarehouseStockCache();
    if (!warehouseStockMap) {
      return NextResponse.json({
        error: 'Warehouse stock cache belum tersedia. Jalankan Force Sync dulu.',
        warehouses: filtered, items: [],
        summary: { totalSKU: 0, totalQty: 0, totalValue: 0, avgAgingDays: 0 },
      });
    }

    // 3. Get item master data (name + cost)
    const itemMaster = await getItemMasterData();

    // 4. Fetch transfer batches for each warehouse
    const allTransferBatches = new Map<string, TransferBatch[]>(); // "whId-itemNo" -> batches
    for (const wh of filtered) {
      const whBatches = await fetchTransferBatches(wh.id, wh.name);
      whBatches.forEach((batches, itemNo) => {
        allTransferBatches.set(`${wh.id}-${itemNo}`, batches);
      });
    }

    // 5. Build items with aging distribution
    const now = new Date();
    const resultItems: any[] = [];

    for (const wh of filtered) {
      warehouseStockMap.forEach((whMap, itemNo) => {
        const qty = whMap.get(wh.id);
        if (!qty || qty <= 0) return;

        const info = itemMaster.get(itemNo);
        const batches = allTransferBatches.get(`${wh.id}-${itemNo}`) || [];

        // FIFO distribute current stock across transfer dates
        const agingBrackets = distributeStockFIFO(qty, batches, now);

        // Calculate weighted average aging
        let totalWeightedDays = 0;
        const sortedBatches = [...batches].sort((a, b) => a.transDate.getTime() - b.transDate.getTime());
        let remain = qty;
        for (const b of sortedBatches) {
          if (remain <= 0) break;
          const alloc = Math.min(b.quantity, remain);
          const days = Math.max(0, Math.floor((now.getTime() - b.transDate.getTime()) / (1000 * 60 * 60 * 24)));
          totalWeightedDays += alloc * days;
          remain -= alloc;
        }
        const avgAgingDays = qty > 0 ? Math.round(totalWeightedDays / qty) : 0;

        // Oldest batch date (for First Seen)
        const oldestBatch = sortedBatches.length > 0 ? sortedBatches[0] : null;
        const firstSeenAt = oldestBatch ? oldestBatch.transDate.toISOString() : now.toISOString();

        const unitCost = info?.avgCost || 0;
        const value = qty * unitCost;

        resultItems.push({
          warehouseId: wh.id,
          warehouseName: wh.name,
          category: wh.category,
          subCategory: wh.subCategory,
          itemNo,
          itemName: info?.name || itemNo,
          unit: info?.unit || 'Pcs',
          quantity: qty,
          unitCost,
          value,
          firstSeenAt,
          avgAgingDays,
          agingBrackets, // { '0-7': qty, '8-15': qty, ... }
          transferCount: batches.length,
        });
      });
    }

    // Sort by avg aging descending
    resultItems.sort((a, b) => b.avgAgingDays - a.avgAgingDays);

    // Summary
    const totalQty = resultItems.reduce((s, i) => s + i.quantity, 0);
    const totalValue = resultItems.reduce((s, i) => s + i.value, 0);
    const avgAgingDays = resultItems.length > 0
      ? Math.round(resultItems.reduce((s, i) => s + i.avgAgingDays * i.quantity, 0) / (totalQty || 1))
      : 0;

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
    });

  } catch (error: any) {
    console.error('[SpecialWH] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
