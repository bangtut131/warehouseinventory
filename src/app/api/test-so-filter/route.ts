import { NextRequest, NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const val = searchParams.get('val') || '01/01/2025';
        const params = {
            fields: 'id,number,transDate',
            'sp.page': 1,
            'sp.pageSize': 5,
            'filter.transDate.op': 'GREATER_EQUAL',
            'filter.transDate.val': val
        };
        const res = await accurateClient.get('/sales-order/list.do', { params });
        return NextResponse.json({ success: true, params, response: res.data });
    } catch(err: any) {
        return NextResponse.json({ success: false, error: err.message, response: err.response?.data });
    }
}
