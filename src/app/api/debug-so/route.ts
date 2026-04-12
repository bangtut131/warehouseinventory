export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const soNumber = searchParams.get('so') || 'DFT.82963';

    try {
        // Try to find the SO by keyword search
        const listRes = await accurateClient.get('/sales-order/list.do', {
            params: {
                fields: 'id,number,transDate,statusName,customer,customerName,customerNo,char1,char2', // added fields to investigate
                'filter.keywords.val': soNumber,
                'sp.pageSize': 10,
            }
        });

        const listData = listRes.data;
        let detailData = null;

        // If found, get detail
        if (listData?.s && listData.d?.length > 0) {
            const soId = listData.d[0].id;
            const detailRes = await accurateClient.get('/sales-order/detail.do', {
                params: { id: soId }
            });
            detailData = detailRes.data;
        }

        return NextResponse.json({
            searchedFor: soNumber,
            listResult: listData,
            detailResultCustomer: detailData?.d?.customer,
            detailResultCustomerNo: detailData?.d?.customerNo,
            detailData: detailData?.d
        });
    } catch (err: any) {
        return NextResponse.json({
            error: err.message,
            response: err.response?.data,
        }, { status: 500 });
    }
}
