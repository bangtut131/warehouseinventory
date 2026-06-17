import { NextResponse } from 'next/server';
import { accurateClient } from '@/lib/accurate';

/**
 * GET /api/price-analysis/debug-item?itemNo=FG-019&months=6
 * 
 * Diagnostic endpoint: cek semua faktur pembelian untuk item tertentu.
 * Menampilkan satuan apa yang dipakai di tiap faktur beli.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const itemNo = searchParams.get('itemNo') || 'FG-019';
    const months = parseInt(searchParams.get('months') || '6');

    // Calculate from date
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - months);
    const fromStr = `${String(fromDate.getDate()).padStart(2, '0')}/${String(fromDate.getMonth() + 1).padStart(2, '0')}/${fromDate.getFullYear()}`;
    const now = new Date();
    const toStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    // Step 1: Get item detail from master
    const itemListRes = await accurateClient.get('/item/list.do', {
      params: {
        fields: 'id,no,name,unit1Name,unit2Name,unit3Name,ratio2,ratio3,unitPrice,cost',
        'filter.keywords.val': itemNo,
        'sp.pageSize': 5,
      }
    });

    const itemMaster = (itemListRes.data?.d || []).find((i: any) => i.no === itemNo);
    if (!itemMaster) {
      return NextResponse.json({ error: `Item ${itemNo} tidak ditemukan di Accurate` }, { status: 404 });
    }

    // Step 2: Fetch purchase invoices for this item
    // Accurate doesn't filter PI by item, so we fetch all and filter
    const allPIs: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 200) {
      const res = await accurateClient.get('/purchase-invoice/list.do', {
        params: {
          fields: 'id,number,transDate,branchId',
          'filter.transDate.op': 'BETWEEN',
          'filter.transDate.val[0]': fromStr,
          'filter.transDate.val[1]': toStr,
          'sp.page': page,
          'sp.pageSize': 100,
        }
      });

      if (res.data?.s) {
        const list = res.data.d || [];
        if (list.length === 0) { hasMore = false; break; }
        allPIs.push(...list);
        page++;
      } else {
        hasMore = false;
      }
    }

    // Step 3: Fetch detail for each PI and find our item
    const matchingInvoices: any[] = [];
    const BATCH = 15;

    for (let i = 0; i < allPIs.length; i += BATCH) {
      const batch = allPIs.slice(i, i + BATCH);
      const details = await Promise.all(
        batch.map(async (pi) => {
          try {
            const res = await accurateClient.get('/purchase-invoice/detail.do', { params: { id: pi.id } });
            return res.data?.d || null;
          } catch { return null; }
        })
      );

      for (const inv of details) {
        if (!inv || !inv.detailItem) continue;
        for (const di of inv.detailItem) {
          if (di.item?.no === itemNo) {
            matchingInvoices.push({
              invoiceNumber: inv.number,
              transDate: inv.transDate,
              inclusiveTax: inv.inclusiveTax,
              taxable: inv.taxable,
              itemDetail: {
                unitName: di.itemUnitName || di.unitName || '?',
                unitRatio: di.unitRatio,
                unitPrice: di.unitPrice,
                quantity: di.quantity,
                quantityInBase: di.quantityInBase,
                totalPrice: di.totalPrice,
                useTax1: di.useTax1,
              }
            });
          }
        }
      }
    }

    // Sort by date descending
    matchingInvoices.sort((a, b) => {
      const da = a.transDate.split('/');
      const db = b.transDate.split('/');
      const dateA = new Date(+da[2], +da[1] - 1, +da[0]);
      const dateB = new Date(+db[2], +db[1] - 1, +db[0]);
      return dateB.getTime() - dateA.getTime();
    });

    return NextResponse.json({
      item: {
        no: itemMaster.no,
        name: itemMaster.name,
        unit1Name: itemMaster.unit1Name,
        unit2Name: itemMaster.unit2Name,
        unit3Name: itemMaster.unit3Name,
        ratio2: itemMaster.ratio2,
        ratio3: itemMaster.ratio3,
        unitPrice: itemMaster.unitPrice,
        cost: itemMaster.cost,
      },
      period: `${fromStr} → ${toStr}`,
      totalPurchaseInvoicesScanned: allPIs.length,
      matchingInvoices: matchingInvoices,
      summary: {
        totalInvoicesWithItem: matchingInvoices.length,
        unitsUsed: [...new Set(matchingInvoices.map(m => m.itemDetail.unitName))],
        ratiosUsed: [...new Set(matchingInvoices.map(m => m.itemDetail.unitRatio))],
      }
    });
  } catch (error: any) {
    console.error('[DebugItem] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
