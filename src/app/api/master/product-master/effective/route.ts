export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchAllInventory } from '@/lib/accurate';

// ─── Auto-detect logic (sama persis dengan di inventory/route.ts) ──────────
function autoDetect(item: any): {
    shouldConvert: boolean;
    conversionRatio: number | null;
    displayUnit: string | null;
} {
    const baseUnit = (item.unit1Name || '').toLowerCase();
    const alreadyInSellingUnit = baseUnit === 'sak' || baseUnit === 'karung' || baseUnit === 'galon';

    if (alreadyInSellingUnit) {
        return { shouldConvert: false, conversionRatio: null, displayUnit: item.unit1Name };
    }

    const itemNameLower = (item.name || '').toLowerCase();
    const isKgItem = itemNameLower.includes('kg');

    if (!isKgItem) {
        return { shouldConvert: false, conversionRatio: null, displayUnit: item.unit1Name };
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

    return { shouldConvert: false, conversionRatio: null, displayUnit: item.unit1Name };
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

        // 3. Combine: for each item, use master if exists, else auto-detect
        const result = accurateItems
            .filter(item => !item.suspended && item.no)
            .map(item => {
                const master = masterMap.get(item.no);

                if (master) {
                    return {
                        // From DB
                        id: master.id,
                        itemNo: master.itemNo,
                        itemName: master.itemName || item.name,
                        unit1Name: master.unit1Name || item.unit1Name,
                        displayUnit: master.displayUnit,
                        conversionRatio: master.conversionRatio,
                        shouldConvert: master.shouldConvert,
                        category: master.category,
                        notes: master.notes,
                        source: 'master' as const,    // Sudah disimpan di DB
                    };
                } else {
                    // Auto-detect
                    const detected = autoDetect(item);
                    return {
                        id: null,
                        itemNo: item.no,
                        itemName: item.name,
                        unit1Name: item.unit1Name,
                        displayUnit: detected.displayUnit,
                        conversionRatio: detected.conversionRatio,
                        shouldConvert: detected.shouldConvert,
                        category: null,
                        notes: null,
                        source: 'auto' as const,      // Belum disimpan, masih auto
                    };
                }
            })
            .sort((a, b) => a.itemNo.localeCompare(b.itemNo));

        return NextResponse.json(result);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
