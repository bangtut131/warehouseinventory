export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const no = searchParams.get('no') || 'DPK.2026.07.00213';

    const results: Record<string, any> = {};

    const endpoints = [
        // delivery-order: try various param combos
        { key: 'delivery_order_list_v1', url: '/delivery-order/list.do', params: { fields: 'no,date,id,customerName,status', page: 1, pageSize: 5 } },
        { key: 'delivery_order_list_v2', url: '/delivery-order/list.do', params: { fields: 'no,date,id,customerName,status' } },
        { key: 'delivery_order_list_v3', url: '/delivery-order/list.do', params: { fields: 'no,date,id', pageNo: 1, pageSize: 5 } },

        // shipment: try various param combos
        { key: 'shipment_list_v1', url: '/shipment/list.do', params: { fields: 'no,date,id,customerName,status', page: 1, pageSize: 5 } },
        { key: 'shipment_list_v2', url: '/shipment/list.do', params: { fields: 'no,date,id,customerName,status' } },

        // Try to get detail by nomor DPK
        { key: 'delivery_order_detail_no', url: '/delivery-order/detail.do', params: { no } },
        { key: 'delivery_order_detail_id', url: '/delivery-order/detail.do', params: { id: no } },
        { key: 'shipment_detail_no', url: '/shipment/detail.do', params: { no } },

        // Also try sales delivery and sales invoice variants
        { key: 'sales_delivery_list', url: '/sales-delivery/list.do', params: { fields: 'no,date,id', page: 1, pageSize: 5 } },
        { key: 'sales_order_delivery_list', url: '/sales-order-delivery/list.do', params: { fields: 'no,date,id', page: 1, pageSize: 5 } },
    ];

    for (const ep of endpoints) {
        try {
            const res = await accurateClient.get(ep.url, { params: ep.params });
            results[ep.key] = {
                status: res.data?.s === true ? 'OK' : 'API_ERROR',
                httpStatus: res.status,
                data: res.data,
            };
        } catch (err: any) {
            results[ep.key] = {
                status: 'HTTP_ERROR',
                httpStatus: err.response?.status,
                message: err.response?.data?.message || err.message,
                errorDetail: err.response?.data,
            };
        }
    }

    return NextResponse.json(results, { status: 200 });
}
