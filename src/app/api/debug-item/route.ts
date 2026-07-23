export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const no = searchParams.get('no') || 'DPK.2026.07.00213';

    const results: Record<string, any> = {};

    // Try various possible endpoints for pengepakan/packing
    const endpoints = [
        { key: 'packaging_list', url: '/packaging/list.do', params: { fields: 'no,name,id', sp: 1, pageSize: 5 } },
        { key: 'packaging_detail', url: '/packaging/detail.do', params: { no } },
        { key: 'packing_list', url: '/packing/list.do', params: { fields: 'no,name,id', sp: 1, pageSize: 5 } },
        { key: 'packing_detail', url: '/packing/detail.do', params: { no } },
        { key: 'delivery_packing_list', url: '/delivery-packing/list.do', params: { fields: 'no,name,id', sp: 1, pageSize: 5 } },
        { key: 'delivery_packing_detail', url: '/delivery-packing/detail.do', params: { no } },
        { key: 'delivery_order_list', url: '/delivery-order/list.do', params: { fields: 'no,date,id', sp: 1, pageSize: 3 } },
        { key: 'shipment_list', url: '/shipment/list.do', params: { fields: 'no,date,id', sp: 1, pageSize: 3 } },
        { key: 'packing_slip_list', url: '/packing-slip/list.do', params: { fields: 'no,date,id', sp: 1, pageSize: 3 } },
    ];

    for (const ep of endpoints) {
        try {
            const res = await accurateClient.get(ep.url, { params: ep.params });
            results[ep.key] = {
                status: 'OK',
                httpStatus: res.status,
                data: res.data,
            };
        } catch (err: any) {
            results[ep.key] = {
                status: 'ERROR',
                httpStatus: err.response?.status,
                message: err.response?.data?.message || err.message,
                errorDetail: err.response?.data,
            };
        }
    }

    return NextResponse.json(results, { status: 200 });
}
