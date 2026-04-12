export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

// Quick debug endpoint — check a specific SO by number
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const soNumber = searchParams.get('so') || 'DFT.82963';

    try {

        // Get session from env
        const sessionId = process.env.ACCURATE_SESSION;
        const host = process.env.ACCURATE_HOST || 'https://zeus.accurate.id';
        const Authorization = `Bearer ${sessionId}`;

        // Try to find the SO by keyword search
        const listRes = await axios.get(`${host}/accurate/api/sales-order/list.do`, {
            params: {
                fields: 'id,number,transDate,statusName,customerName,branchId',
                'filter.keywords.val': soNumber,
                'sp.pageSize': 10,
            },
            headers: { Authorization },
        });

        const listData = listRes.data;
        let detailData = null;

        // If found, get detail
        if (listData?.s && listData.d?.length > 0) {
            const soId = listData.d[0].id;
            const detailRes = await axios.get(`${host}/accurate/api/sales-order/detail.do`, {
                params: { id: soId },
                headers: { Authorization },
            });
            detailData = detailRes.data;
        }

        return NextResponse.json({
            searchedFor: soNumber,
            listResult: listData,
            detailResult: detailData ? {
                id: detailData.d?.id,
                number: detailData.d?.number,
                statusName: detailData.d?.statusName,
                transDate: detailData.d?.transDate,
                customerName: detailData.d?.customerName || detailData.d?.customer?.name,
                branchId: detailData.d?.branchId,
                detailItemCount: detailData.d?.detailItem?.length,
            } : null,
        });
    } catch (err: any) {
        return NextResponse.json({
            error: err.message,
            response: err.response?.data,
        }, { status: 500 });
    }
}
