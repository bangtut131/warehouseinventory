import { NextRequest, NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const itemNo = searchParams.get('item') || 'PK-001';

    try {
        const response = await accurateClient.get('/item/detail.do', {
            params: { no: itemNo },
        });
        const d = response.data?.d || null;
        if (!d) return NextResponse.json({ error: 'Not found' });

        // Extract ONLY the key stock fields (no huge arrays)
        return NextResponse.json({
            itemNo: d.no,
            name: d.name,
            unit1Name: d.unit1Name,
            balance: d.balance,                                 // stok fisik total
            availableToSell: d.availableToSell,                 // ← STOK DAPAT DIJUAL
            availableToSellInAllUnit: d.availableToSellInAllUnit, // ← multi-unit format
            totalUnit1Quantity: d.totalUnit1Quantity,
            totalUnit2Quantity: d.totalUnit2Quantity,
            totalUnit3Quantity: d.totalUnit3Quantity,
            controlQuantity: d.controlQuantity,
            balanceInUnit: d.balanceInUnit,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
