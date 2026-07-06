// Audit script: check IK-024 sales data detail for June 2026
// Run with: npx tsx scratch/audit_ik024.ts

import { accurateClient } from '../src/lib/accurate';

async function audit() {
  console.log('=== AUDIT IK-024 SALES JUNE 2026 ===\n');

  const fromDate = '01/06/2026';
  const toDate = '30/06/2026';

  let allInvoices: any[] = [];
  let page = 1;
  let hasMore = true;

  console.log('Fetching all June 2026 invoices...');
  while (hasMore) {
    const res = await accurateClient.get('/sales-invoice/list.do', {
      params: {
        fields: 'id,number,transDate,branchName',
        'filter.transDateFrom': fromDate,
        'filter.transDateTo': toDate,
        'sp.page': page,
        'sp.pageSize': 100,
      }
    });
    const list = res.data?.d || [];
    allInvoices.push(...list);
    hasMore = list.length >= 100;
    page++;
  }
  console.log(`Total June invoices: ${allInvoices.length}\n`);

  let totalQty = 0;
  let totalQtyBase = 0;
  let matchingLines: any[] = [];

  console.log('Fetching invoice details...');
  for (let i = 0; i < allInvoices.length; i += 20) {
    const batch = allInvoices.slice(i, i + 20);
    const details = await Promise.all(
      batch.map(async (inv: any) => {
        try {
          const res = await accurateClient.get('/sales-invoice/detail.do', { params: { id: inv.id } });
          return { inv, detail: res.data?.d };
        } catch { return { inv, detail: null }; }
      })
    );

    for (const { inv, detail } of details) {
      if (!detail?.detailItem) continue;
      for (const item of detail.detailItem) {
        const itemNo = item.item?.no || '';
        if (itemNo === 'IK-024') {
          const qty = item.quantity || 0;
          const qtyBase = item.quantityInBase || item.quantity || 0;
          const unitName = item.itemUnitName || '';
          totalQty += qty;
          totalQtyBase += qtyBase;

          matchingLines.push({
            invoiceNo: detail.number || inv.number,
            date: detail.transDate || inv.transDate,
            branch: detail.branchName || inv.branchName || '-',
            qty,
            qtyBase,
            unit: unitName,
            unitPrice: item.unitPrice || 0,
            totalPrice: item.totalPrice || 0,
          });
        }
      }
    }
    if ((i + 20) % 100 === 0) console.log(`  Progress: ${Math.min(i + 20, allInvoices.length)}/${allInvoices.length}`);
  }

  console.log(`\n=== IK-024 LINES IN JUNE 2026 ===`);
  console.log(`Total invoice lines: ${matchingLines.length}`);
  console.log(`Total qty (sales unit): ${totalQty}`);
  console.log(`Total qtyBase (base unit): ${totalQtyBase}\n`);

  matchingLines.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  matchingLines.forEach((line, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${line.date} | ${line.invoiceNo} | ${line.branch} | ${line.qty} ${line.unit} | base:${line.qtyBase} | @${line.unitPrice} | tot:${line.totalPrice}`);
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Invoice lines: ${matchingLines.length}`);
  console.log(`Sum qty (Box/unit penjualan): ${totalQty}`);
  console.log(`Sum qtyBase (Pcs/base unit): ${totalQtyBase}`);
  console.log(`App shows: 59 box | Accurate Lite: 28 box | Diff: ${totalQty - 28}`);
}

audit().catch(console.error);
