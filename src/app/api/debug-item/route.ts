import { NextRequest, NextResponse } from 'next/server';
import { fetchAllInventory } from '@/lib/accurate';
import axios from 'axios';
import crypto from 'crypto';

const API_BASE = process.env.ACCURATE_API_BASE!;
const API_TOKEN = process.env.ACCURATE_API_TOKEN!;
const DB_ID = process.env.ACCURATE_DB_ID!;
const SIGNATURE_SECRET = process.env.ACCURATE_SIGNATURE_SECRET || '';

async function fetchItemDetail(itemNo: string): Promise<any> {
    const timestamp = new Date().toISOString();
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${API_TOKEN}`,
        'X-Session-ID': DB_ID,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Api-Timestamp': timestamp,
    };
    if (SIGNATURE_SECRET) {
        headers['X-Api-Signature'] = crypto.createHmac('sha256', SIGNATURE_SECRET)
            .update(timestamp).digest('base64');
    }

    const response = await axios.get(`${API_BASE}/item/detail.do`, {
        headers,
        params: { no: itemNo },
    });

    return response.data?.d || null;
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const itemNo = searchParams.get('item') || 'PK-001';

    try {
        // 1. Get from item list (basic data)
        const items = await fetchAllInventory();
        const found = items.find(i => i.no.toUpperCase() === itemNo.toUpperCase());

        // 2. Get item detail (includes raw warehouse data)
        const detail = await fetchItemDetail(itemNo);

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
            warehouses: rawWarehouseData.map((w: any) => ({
                ...w, // Show ALL fields from Accurate
            })),

            _analysis: {
                totalUnit1Qty: rawWarehouseData.reduce((s: number, w: any) => s + (w.unit1Quantity || 0), 0),
                totalAvailableToSell: rawWarehouseData.reduce((s: number, w: any) => s + (w.availableToSell ?? w.unit1AvailableToSell ?? w.quantityAvailableToSell ?? 'N/A'), 0),
            }
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
