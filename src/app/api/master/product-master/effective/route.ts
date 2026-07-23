export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchAllInventory, loadSalesCache } from '@/lib/accurate';

// Non-inventory item types to exclude from conversion master
const SKIP_ITEM_TYPES = ['NonInventory', 'Service', 'Assembly', 'FixedAsset', 'OtherAsset'];
const DEFAULT_ANALYSIS_START = new Date(2025, 0, 1);

// ─── Auto-detect logic ───────────────────────────────────────────────────────
function autoDetect(item: any, resolvedUnit: string | null): {
    shouldConvert: boolean;
    conversionRatio: number | null;
    displayUnit: string | null;
} {
    const baseUnit = (resolvedUnit || '').toLowerCase();

    // Already in selling unit
    if (baseUnit === 'sak' || baseUnit === 'karung' || baseUnit === 'galon') {
        return { shouldConvert: false, conversionRatio: null, displayUnit: resolvedUnit };
    }

    const itemNameLower = (item.name || '').toLowerCase();
    const isKgItem = itemNameLower.includes('kg');

    if (!isKgItem) {
        return { shouldConvert: false, conversionRatio: null, displayUnit: resolvedUnit };
    }

    // Get ratio from Accurate or extract from name
    let sakConversion: number = item.ratio2 && item.ratio2 > 1 ? item.ratio2 : 0;
    if (sakConversion < 25) {
        const weightMatch = (item.name || '').match(/(\d+)\s*[Kk][Gg]/);
        if (weightMatch) {
            const nameWeight = parseInt(weightMatch[1], 10);
            if (nameWeight >= 20) sakConversion = nameWeight;
        }
    }

    if (sakConversion >= 25) {
        return { shouldConvert: true, conversionRatio: sakConversion, displayUnit: 'Sak' };
    }

    return { shouldConvert: false, conversionRatio: null, displayUnit: resolvedUnit };
}

export async function GET() {
    try {
        // 1. Fetch all items from Accurate
        const accurateItems = await fetchAllInventory();

        // 2. Fetch ProductMaster entries
        let masterMap = new Map<string, any>();
        try {
            const masters = await prisma.productMaster.findMany();
            masters.forEach(m => masterMap.set(m.itemNo, m));
        } catch (err: any) {
            console.log('[effective] ProductMaster load failed:', err.message);
        }

        // 3. Fetch sales cache for unit name fallback
        // Accurate list API often returns unit1Name=null even when unit IS set in Accurate.
        // Sales invoices reliably carry the unit name -> stored as salesUnitName in cache.
        let salesMap = new Map<string, any>();
        try {
            const cached = await loadSalesCache(DEFAULT_ANALYSIS_START);
            if (cached) salesMap = cached;
        } catch (err: any) {
            console.log('[effective] Sales cache load failed:', err.message);
        }

        // 4. Filter and combine
        const result = accurateItems
            .filter(item => {
                if (item.suspended) return false;
                if (item.itemType && SKIP_ITEM_TYPES.includes(item.itemType)) return false;
                if (!item.no) return false;
                return true;
            })
            .map(item => {
                const master = masterMap.get(item.no);
                const salesData = salesMap.get(item.no);

                // Resolve unit with fallback chain:
                // 1. unit1Name from Accurate (often null in list API for some items)
                // 2. salesUnitName from sales cache (most reliably populated)
                // 3. unit2Name from Accurate (secondary unit)
                const salesUnit = salesData?.salesUnitName;
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
                    const detected = autoDetect(item, resolvedUnit);
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
