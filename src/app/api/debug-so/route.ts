import { NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';

export async function GET() {
  try {
     const soRes = await accurateClient.get('/sales-order/list.do', {
         params: { 'sp.pageSize': 1, 'sp.sort': 'transDate|desc' }
     });
     
     if (!soRes.data?.d?.[0]) return NextResponse.json({ error: "No SO" });

     const soId = soRes.data.d[0].id;
     
     const soDetailRes = await accurateClient.get('/sales-order/detail.do', { params: { id: soId } });
     const d = soDetailRes.data.d;
     
     return NextResponse.json({
         transDate: d.transDate,
         statusName: d.statusName,
         createdBy: d.createdBy,
         createdByUserName: d.createdByUserName,
         createdUser: d.createdUser,
         salesmanName: d.salesmanName || d.salesman?.name,
         approvalStatus: d.approvalStatus,
         approverName: d.approverName,
         char1: d.char1,
         detailInfo: d,
     });
  } catch(e: any) {
     return NextResponse.json({ error: e.message });
  }
}
