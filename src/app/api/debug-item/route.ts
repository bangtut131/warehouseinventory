import { NextRequest, NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const itemNo = searchParams.get('item') || 'PK-001';

    try {
        // Get item detail — dump ALL top-level keys to discover available fields
        const response = await accurateClient.get('/item/detail.do', {
            params: { no: itemNo },
        });
        const detail = response.data?.d || null;
        if (!detail) {
            return NextResponse.json({ error: 'Item not found in detail API' });
        }

        // List all top-level keys (to discover fields we haven't used)
        const allKeys = Object.keys(detail);

        // Check for any stock-related fields
        const stockFields: Record<string, any> = {};
        for (const key of allKeys) {
            const kl = key.toLowerCase();
            if (kl.includes('stock') || kl.includes('available') || kl.includes('sell')
                || kl.includes('reserve') || kl.includes('quantity') || kl.includes('balance')
                || kl.includes('commit') || kl.includes('order') || kl.includes('pending')
                || kl.includes('allocated')) {
                stockFields[key] = detail[key];
            }
        }

        // Get warehouse data with focus on stock fields
        const rawWh = detail.detailWarehouseData || [];
        const whWithStock = rawWh.filter((w: any) => w.unit1Quantity > 0 || w.balance > 0);
        const whKeys = whWithStock.length > 0 ? Object.keys(whWithStock[0]) : [];

        return NextResponse.json({
            itemNo,
            name: detail.name,

            // All top-level keys from item detail
            allDetailKeys: allKeys,

            // Stock-related fields found
            stockRelatedFields: stockFields,

            // Warehouse field names
            warehouseFieldNames: whKeys,

            // Warehouses with stock (full data)
            warehousesWithStock: whWithStock,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
