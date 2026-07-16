import { NextRequest, NextResponse } from 'next/server';
import { fetchAllInventory, accurateClient } from '@/lib/accurate';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const itemNo = searchParams.get('item') || 'PK-001';

    try {
        // 1. Get from item list (basic data)
        const items = await fetchAllInventory();
        const found = items.find(i => i.no.toUpperCase() === itemNo.toUpperCase());

        // 2. Get item detail (includes raw warehouse data)
        const response = await accurateClient.get('/item/detail.do', {
            params: { no: itemNo },
        });
        const detail = response.data?.d || null;

        // Extract raw warehouse data with ALL fields
        const rawWarehouseData = detail?.detailWarehouseData || [];

        return NextResponse.json({
            itemNo: found?.no || itemNo,
            name: found?.name || detail?.name || 'NOT FOUND',
            listQuantity: found?.quantity,
            unit1Name: found?.unit1Name || detail?.unit1Name,
            unit2Name: found?.unit2Name || detail?.unit2Name,
            ratio2: found?.ratio2 || detail?.ratio2,

            // Raw warehouse data — shows ALL fields Accurate sends per gudang
            warehouseCount: rawWarehouseData.length,
            warehouses: rawWarehouseData,

            _analysis: {
                totalUnit1Qty: rawWarehouseData.reduce((s: number, w: any) => s + (w.unit1Quantity || 0), 0),
            }
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message, stack: err.stack?.split('\n').slice(0, 3) }, { status: 500 });
    }
}
