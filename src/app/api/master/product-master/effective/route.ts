export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchAllInventory } from '@/lib/accurate';

// Non-inventory item types to exclude from conversion master
const SKIP_ITEM_TYPES = ['NonInventory', 'Service', 'Assembly', 'FixedAsset', 'OtherAsset'];

// ─── Auto-detect logic (sama persis dengan inventory/route.ts) ──────────────
function autoDetect(item: any): {
    shouldConvert: boolean;
    conversionRatio: number | null;
    displayUnit: string | null;
} {
    const unitName = item.unit1Name || item.unit2Name || null;
    const baseUnit = (unitName || '').toLowerCase();

    // Already in selling unit
    if (baseUnit === 'sak' || baseUnit === 'karung' || baseUnit === 'galon') {
        return { shouldConvert: false, conversionRatio: null, displayUnit: unitName };
    }

    const itemNameLower = (item.name || '').toLowerCase();
    const isKgItem = itemNameLower.includes('kg');

    if (!isKgItem) {
        return { shouldConvert: false, conversionRatio: null, displayUnit: unitName };
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

    return { shouldConvert: false, conversionRatio: null, displayUnit: unitName };
}

export async function GET() {
    try {
        // 1. Fetch all items from Accurate
        const accurateItems = await fetchAllInventory();

        // 2. Fetch all ProductMaster entries
        let masterMap = new Map<string, any>();
        try {
            const masters = await prisma.productMaster.findMany();
            masters.forEach(m => masterMap.set(m.itemNo, m));
        } catch (err: any) {
            console.log('[effective] ProductMaster load failed:', err.message);
        }

        // 3. Filter and combine
        const result = accurateItems
            .filter(item => {
                // Skip suspended items
                if (item.suspended) return false;
                // Skip non-inventory types
                if (item.itemType && SKIP_ITEM_TYPES.includes(item.itemType)) return false;
                // Must have item number
                if (!item.no) return false;
                return true;
            })
            .map(item => {
                const master = masterMap.get(item.no);
                // Resolve unit with fallback
                const resolvedUnit = item.unit1Name || item.unit2Name || null;

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
                    const detected = autoDetect(item);
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
