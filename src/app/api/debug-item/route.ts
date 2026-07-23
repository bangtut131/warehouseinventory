export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { fetchAllInventory } from '@/lib/accurate';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('q') || '';

    try {
        const items = await fetchAllInventory();
        
        // Show first 10 items, or filter by search
        const filtered = search 
            ? items.filter(i => i.no?.toLowerCase().includes(search.toLowerCase()) || i.name?.toLowerCase().includes(search.toLowerCase()))
            : items.slice(0, 15);

        return NextResponse.json({
            total: items.length,
            showing: filtered.length,
            items: filtered.map(i => ({
                no: i.no,
                name: i.name,
                unit1Name: i.unit1Name,
                unit2Name: i.unit2Name,
                ratio2: i.ratio2,
                ratio3: i.ratio3,
                suspended: i.suspended,
                quantity: i.quantity,
            }))
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
