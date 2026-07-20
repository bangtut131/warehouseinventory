export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchAllInventory } from '@/lib/accurate';

export async function POST(req: NextRequest) {
    try {
        const items = await fetchAllInventory();
        let createdCount = 0;
        let skippedCount = 0;

        // Fetch existing
        const existingMasters = await prisma.productMaster.findMany({
            select: { itemNo: true }
        });
        const existingItemNos = new Set(existingMasters.map(m => m.itemNo));

        for (const item of items) {
            if (item.suspended) continue;
            if (!item.no) continue;
            
            if (existingItemNos.has(item.no)) {
                skippedCount++;
                continue;
            }

            let shouldConvert = false;
            let displayUnit = item.unit1Name || null;
            let conversionRatio = null;
            let itemName = item.name;
            let unit1Name = item.unit1Name || null;

            if (unit1Name === 'Sak' || unit1Name === 'Karung' || unit1Name === 'Galon') {
                shouldConvert = false;
            } else {
                const lowerName = (itemName || '').toLowerCase();
                const ratio2 = item.ratio2 || 0;

                if (lowerName.includes('kg') && ratio2 >= 25) {
                    shouldConvert = true;
                    conversionRatio = ratio2;
                    displayUnit = 'Sak';
                } else if (lowerName.includes('kg') && ratio2 < 25) {
                    const match = lowerName.match(/(\d+(?:\.\d+)?)\s*kg/);
                    if (match) {
                        const weight = parseFloat(match[1]);
                        if (weight >= 20) {
                            shouldConvert = true;
                            conversionRatio = weight;
                            displayUnit = 'Sak';
                        }
                    }
                }
            }

            await prisma.productMaster.create({
                data: {
                    itemNo: item.no,
                    itemName: itemName,
                    unit1Name: unit1Name,
                    displayUnit: displayUnit,
                    shouldConvert: shouldConvert,
                    conversionRatio: conversionRatio,
                }
            });
            createdCount++;
        }

        return NextResponse.json({
            success: true,
            created: createdCount,
            skipped: skippedCount,
            total: createdCount + skippedCount
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
