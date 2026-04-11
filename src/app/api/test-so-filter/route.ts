import { NextRequest, NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'list';

    try {
        if (mode === 'so-with-do') {
            // Find a SO that has been shipped (Terproses or Sebagian diproses)
            const listRes = await accurateClient.get('/sales-order/list.do', {
                params: {
                    fields: 'id,number,statusName',
                    'sp.page': 1,
                    'sp.pageSize': 10,
                    'filter.statusName.op': 'EQUAL',
                    'filter.statusName.val': 'Terproses',
                }
            });
            if (!listRes.data?.d?.length) {
                return NextResponse.json({ error: 'No Terproses SO found', raw: listRes.data });
            }
            // Get detail of first one
            const soId = listRes.data.d[0].id;
            const detailRes = await accurateClient.get('/sales-order/detail.do', {
                params: { id: soId }
            });
            const d = detailRes.data?.d || {};
            return NextResponse.json({
                success: true,
                soNumber: d.number,
                statusName: d.statusName,
                deliveryOrder: d.deliveryOrder,
                percentShipped: d.percentShipped,
                shipDate: d.shipDate,
                shipment: d.shipment,
                shipmentId: d.shipmentId,
                approvalStatus: d.approvalStatus,
                // Check processHistory for clues
                processHistory: d.processHistory,
                // All top-level keys
                allKeys: Object.keys(d),
            });
        }

        if (mode === 'do-list') {
            // Fetch DO list with status
            const res = await accurateClient.get('/delivery-order/list.do', {
                params: {
                    fields: 'id,number,transDate,statusName,customerName',
                    'sp.page': 1,
                    'sp.pageSize': 10
                }
            });
            return NextResponse.json({ success: true, mode: 'do-list', data: res.data });
        }

        if (mode === 'do-detail') {
            // First get a DO id
            const listRes = await accurateClient.get('/delivery-order/list.do', {
                params: { fields: 'id,number', 'sp.page': 1, 'sp.pageSize': 1 }
            });
            const doId = listRes.data?.d?.[0]?.id;
            if (!doId) return NextResponse.json({ error: 'No DO found' });

            const detailRes = await accurateClient.get('/delivery-order/detail.do', {
                params: { id: doId }
            });
            const d = detailRes.data?.d || {};
            return NextResponse.json({
                success: true,
                mode: 'do-detail',
                topLevelFields: Object.keys(d),
                // Key fields
                number: d.number,
                statusName: d.statusName,
                approvalStatus: d.approvalStatus,
                transDate: d.transDate,
                salesOrderId: d.salesOrderId,
                salesOrderNumber: d.salesOrderNumber,
                soNumber: d.soNumber,
                // Check for SO reference
                salesOrder: d.salesOrder,
                // Detail items with SO ref
                detailItemSample: d.detailItem?.slice(0, 2)?.map((di: any) => ({
                    allKeys: Object.keys(di),
                    salesOrderId: di.salesOrderId,
                    salesOrderNumber: di.salesOrderNumber,
                    soId: di.soId,
                    soNumber: di.soNumber,
                    salesOrder: di.salesOrder,
                })),
            });
        }

        if (mode === 'detail') {
            const listRes = await accurateClient.get('/sales-order/list.do', {
                params: { fields: 'id,number', 'sp.page': 1, 'sp.pageSize': 1 }
            });
            const firstId = listRes.data?.d?.[0]?.id;
            if (!firstId) return NextResponse.json({ error: 'No SO found' });

            const detailRes = await accurateClient.get('/sales-order/detail.do', {
                params: { id: firstId }
            });
            return NextResponse.json({
                success: true,
                mode: 'detail',
                topLevelFields: Object.keys(detailRes.data?.d || {}),
                data: detailRes.data?.d
            });
        }

        // Default: list with extended fields
        const res = await accurateClient.get('/sales-order/list.do', {
            params: {
                fields: 'id,number,transDate,statusName,deliveryStatus,deliveryStatusName,shipmentStatus,approvalStatus,approvalStatusName,percentShipped',
                'sp.page': 1,
                'sp.pageSize': 10,
            }
        });
        return NextResponse.json({ success: true, mode: 'list', data: res.data });

    } catch (err: any) {
        return NextResponse.json({
            success: false,
            error: err.message,
            response: err.response?.data
        });
    }
}
