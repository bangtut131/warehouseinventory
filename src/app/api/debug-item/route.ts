import { NextRequest, NextResponse } from 'next/server';
import { fetchAllInventory } from '@/lib/accurate';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const itemNo = searchParams.get('item') || 'SAP-PK-042';

    try {
        const items = await fetchAllInventory();
        const found = items.find(i => i.no.toUpperCase() === itemNo.toUpperCase());

        if (!found) {
            return NextResponse.json({ error: `Item ${itemNo} not found`, totalItems: items.length });
        }

        // Show raw data from Accurate
        return NextResponse.json({
            itemNo: found.no,
            name: found.name,
            rawQuantity: found.quantity,
            unit1Name: found.unit1Name,
            unit2Name: found.unit2Name,
            unit3Name: found.unit3Name,
            ratio2: found.ratio2,
            ratio3: found.ratio3,
            unitPrice: found.unitPrice,
            cost: found.cost,
            suspended: found.suspended,
            _analysis: {
                nameContainsKg: (found.name || '').toLowerCase().includes('kg'),
                unit1IsAlreadySak: ['sak', 'karung', 'galon'].includes((found.unit1Name || '').toLowerCase()),
                wouldConvert: (found.name || '').toLowerCase().includes('kg') && (found.ratio2 || 0) >= 25,
                estimatedSakQty: found.ratio2 && found.ratio2 >= 25 ? parseFloat((found.quantity / found.ratio2).toFixed(2)) : null,
            }
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
