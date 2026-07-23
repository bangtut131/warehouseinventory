export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchAllInventory } from '@/lib/accurate';

// Non-inventory item types to exclude from conversion master
const SKIP_ITEM_TYPES = ['NonInventory', 'Service', 'Assembly', 'FixedAsset', 'OtherAsset'];

// ─── Auto-detect logic ───────────────────────────────────────────────────────
function autoDetect(item: any, resolvedUnit: string | null, salesUnitName?: string): {
    shouldConvert: boolean;
    conversionRatio: number | null;
    displayUnit: string | null;
} {
    const baseUnit = (resolvedUnit || '').toLowerCase();
    const ratio2: number = item.ratio2 && item.ratio2 > 1 ? item.ratio2 : 0;
    const itemNameLower = (item.name || '').toLowerCase();
    const isKgItem = itemNameLower.includes('kg');

    // Already in bulk/selling unit — no conversion needed
    if (baseUnit === 'sak' || baseUnit === 'karung' || baseUnit === 'galon') {
        return { shouldConvert: false, conversionRatio: null, displayUnit: resolvedUnit };
    }

    if (isKgItem) {
        // ── KG ITEMS: Sak conversion ──────────────────────────────────────────
        let sakConversion = ratio2;
        if (sakConversion < 25) {
            const weightMatch = (item.name || '').match(/(\d+)\s*[Kk][Gg]/);
            if (weightMatch) {
                const nameWeight = parseInt(weightMatch[1], 10);
                if (nameWeight >= 25) sakConversion = nameWeight;
            }
        }
        if (sakConversion >= 25) {
            return { shouldConvert: true, conversionRatio: sakConversion, displayUnit: 'Sak' };
        }
    } else if (ratio2 >= 2) {
        // ── NON-KG ITEMS: Box/Pack/etc conversion from Accurate master ────────
        // e.g., unit1=Btl, unit2=Box, ratio2=36 → 1 Box = 36 Btl
        // shouldConvert=false: API keeps stock in base unit (Btl)
        // The Box/Pcs toggle on dashboard already divides by ratio2 automatically
        // We surface this info here so user can see the conversion exists
        const displayUnitName =
            item.unit2Name ||
            (salesUnitName && salesUnitName !== 'Sak' && salesUnitName !== 'Karung' ? salesUnitName : null) ||
            'Box';
        return { shouldConvert: false, conversionRatio: ratio2, displayUnit: displayUnitName };
    }

    return { shouldConvert: false, conversionRatio: null, displayUnit: resolvedUnit };
}

// ─── Load unit names from ALL available sales caches (global + branch) ───────
async function loadUnitMapFromAllCaches(): Promise<Map<string, string>> {
    const unitMap = new Map<string, string>();
    try {
        // Find ALL sales cache entries (global + all branches)
        const allCaches = await prisma.dataCache.findMany({
            where: { key: { startsWith: 'sales-cache-' } },
            select: { key: true, data: true },
        });

        if (allCaches.length === 0) {
            console.log('[effective] No sales cache found in DB');
            return unitMap;
        }

        console.log(`[effective] Found ${allCaches.length} sales cache(s), merging unit names`);

        for (const cache of allCaches) {
            const cached = cache.data as any;
            if (!cached?.data) continue;

            for (const [itemNo, itemData] of Object.entries(cached.data as Record<string, any>)) {
                const unitName: string = itemData?.salesUnitName || '';
                if (unitName && !unitMap.has(itemNo)) {
                    // Only set if not already set (first cache wins, prefer global)
                    unitMap.set(itemNo, unitName);
                }
            }
        }

        console.log(`[effective] Loaded unit names for ${unitMap.size} items from caches`);
    } catch (err: any) {
        console.log('[effective] Cache load error:', err.message);
    }
    return unitMap;
}

export async function GET() {
    try {
        // 1. Fetch all items from Accurate
        const accurateItems = await fetchAllInventory();

        // 2. Fetch ProductMaster entries from DB
        let masterMap = new Map<string, any>();
        try {
            const masters = await prisma.productMaster.findMany();
            masters.forEach(m => masterMap.set(m.itemNo, m));
        } catch (err: any) {
            console.log('[effective] ProductMaster load failed:', err.message);
        }

        // 3. Load unit names from ALL available sales caches (global + all branches)
        // Accurate list API often returns unit1Name=null even when unit IS set in Accurate.
        // Sales invoices reliably carry the unit name -> stored as salesUnitName in cache.
        const salesUnitMap = await loadUnitMapFromAllCaches();

        // 4. Filter and map
        const result = accurateItems
            .filter(item => {
                if (item.suspended) return false;
                if (item.itemType && SKIP_ITEM_TYPES.includes(item.itemType)) return false;
                if (!item.no) return false;
                return true;
            })
            .map(item => {
                const master = masterMap.get(item.no);
                const salesUnit = salesUnitMap.get(item.no) || '';

                // Resolve unit with fallback chain:
                // 1. unit1Name from Accurate list API (often null)
                // 2. salesUnitName from any sales cache (global or branch)
                // 3. unit2Name from Accurate list API
                const resolvedUnit: string | null =
                    item.unit1Name ||
                    (salesUnit && salesUnit !== 'Sak' && salesUnit !== 'Karung' ? salesUnit : null) ||
                    item.unit2Name ||
                    null;

                if (master) {
                    return {
                        id: master.id,
                        itemNo: master.itemNo,
                        itemName: master.itemName || item.name,
                        unit1Name: master.unit1Name || resolvedUnit,
                        displayUnit: master.displayUnit,
                        conversionRatio: master.conversionRatio,
                        shouldConvert: master.shouldConvert,
                        category: master.category,
                        notes: master.notes,
                        source: 'master' as const,
                    };
                } else {
                    const detected = autoDetect(item, resolvedUnit, salesUnit);
                    return {
                        id: null,
                        itemNo: item.no,
                        itemName: item.name,
                        unit1Name: resolvedUnit,
                        displayUnit: detected.displayUnit,
                        conversionRatio: detected.conversionRatio,
                        shouldConvert: detected.shouldConvert,
                        category: null,
                        notes: null,
                        source: 'auto' as const,
                    };
                }
            })
            .sort((a, b) => a.itemNo.localeCompare(b.itemNo));

        return NextResponse.json(result);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
