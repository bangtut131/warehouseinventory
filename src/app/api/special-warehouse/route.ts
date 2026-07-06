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
    const itemMaster = new Map<string, { name: string; avgCost: number; unit: string }>();
    let itemPage = 1;
    let itemHasMore = true;
    while (itemHasMore) {
      const res = await accurateClient.get('/item/list.do', {
        params: { fields: 'no,name,averageCost,unitPrice,unit1Name', 'sp.page': itemPage, 'sp.pageSize': 100 }
      });
      const list = res.data?.d || [];
      for (const i of list) {
        itemMaster.set(i.no, {
          name: i.name || '',
          avgCost: i.averageCost || i.unitPrice || 0,
          unit: i.unit1Name || 'Pcs',
        });
      }
      itemHasMore = list.length >= 100;
      itemPage++;
    }

    // 4. Get firstSeen dates from DB (fast — already stored by Snapshot)
    const whIds = filtered.map(w => w.id);
    const firstSeenRecords = await prisma.specialWarehouseFirstSeen.findMany({
      where: { warehouseId: { in: whIds }, isActive: true },
    });
    const firstSeenMap = new Map<string, Date>();
    firstSeenRecords.forEach(r => firstSeenMap.set(`${r.warehouseId}-${r.itemNo}`, r.firstSeenAt));

    // 5. Build items with aging from firstSeen dates
    const now = new Date();
    const resultItems: any[] = [];

    for (const wh of filtered) {
      warehouseStockMap.forEach((whMap, itemNo) => {
        const qty = whMap.get(wh.id);
        if (!qty || qty <= 0) return;

        const info = itemMaster.get(itemNo);
        const firstSeen = firstSeenMap.get(`${wh.id}-${itemNo}`);
        const agingDays = firstSeen
          ? Math.max(0, Math.floor((now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24)))
          : 0;
        const bracket = getAgingBracket(agingDays);

        // Simple aging: all qty goes into one bracket based on firstSeen
        const agingBrackets: Record<AgingBracket, number> = {
          '0-7': 0, '8-15': 0, '16-30': 0, '31-45': 0,
          '46-60': 0, '61-90': 0, '91-120': 0, '120+': 0,
        };
        agingBrackets[bracket] = qty;

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
          firstSeenAt: firstSeen ? firstSeen.toISOString() : null,
          avgAgingDays: agingDays,
          agingBrackets,
          hasFirstSeen: !!firstSeen,
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
