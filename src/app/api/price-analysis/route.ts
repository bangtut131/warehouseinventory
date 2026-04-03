import { NextResponse } from 'next/server';
import {
  fetchAllPurchasePriceData,
  fetchLatestSellingPrices,
  fetchItemUnitMap,
  fetchAllInventory,
  PurchasePriceMap,
} from '@/lib/accurate';
import { PriceAnalysisItem, BranchPrice } from '@/lib/types';

// Branch name map (we'll fetch this alongside)
async function getBranchNames(): Promise<Map<number, string>> {
  try {
    const { accurateClient } = await import('@/lib/accurate');
    const res = await accurateClient.get('/branch/list.do', { params: { 'sp.pageSize': 100 } });
    const map = new Map<number, string>();
    (res.data?.d || []).forEach((b: any) => { map.set(b.id, b.name); });
    return map;
  } catch {
    return new Map();
  }
}

// Margin thresholds
const MARGIN_HEALTHY = 15;  // > 15% = healthy
const MARGIN_THIN = 5;      // 5-15% = thin

function computeMargin(sellPrice: number, buyPrice: number): number {
  if (buyPrice <= 0 || sellPrice <= 0) return 0;
  return ((sellPrice - buyPrice) / buyPrice) * 100;
}

function getStatus(margin: number, hasData: boolean): PriceAnalysisItem['status'] {
  if (!hasData) return 'NO_DATA';
  if (margin < MARGIN_THIN) return 'NEGATIVE';
  if (margin < MARGIN_HEALTHY) return 'THIN';
  return 'HEALTHY';
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get('from') || '2025-01-01';
    const forceParam = searchParams.get('force') === 'true';

    // Parse from date
    const fromParts = fromParam.split('-');
    const fromDate = new Date(parseInt(fromParts[0]), parseInt(fromParts[1]) - 1, parseInt(fromParts[2] || '1'));

    console.log(`[PriceAnalysis] Starting... from=${fromParam} force=${forceParam}`);

    // Parallel fetch all data sources
    const [itemUnitMap, branchNames, items] = await Promise.all([
      fetchItemUnitMap(),
      getBranchNames(),
      fetchAllInventory(),
    ]);

    // Fetch purchase and selling prices (these may take time)
    const [purchaseResult, sellingPriceMap] = await Promise.all([
      fetchAllPurchasePriceData(fromDate, forceParam, itemUnitMap),
      fetchLatestSellingPrices(fromDate, forceParam, itemUnitMap),
    ]);

    const { priceMap } = purchaseResult;

    console.log(`[PriceAnalysis] Data loaded: ${items.length} items, ${priceMap.size} purchase prices, ${sellingPriceMap.size} selling prices, ${branchNames.size} branches`);

    // Build result array
    const result: PriceAnalysisItem[] = [];

    // Collect all branch IDs that have selling prices
    const allBranchIds = new Set<number>();
    sellingPriceMap.forEach(brMap => {
      brMap.forEach((_, brId) => allBranchIds.add(brId));
    });

    for (const item of items) {
      const itemNo = item.no;
      const purchase = priceMap.get(itemNo);
      const sellingByBranch = sellingPriceMap.get(itemNo);

      const lastPurchasePrice = purchase?.lastPrice || 0;
      const avgPurchasePrice = purchase && purchase.totalQtyBase > 0
        ? purchase.totalCost / purchase.totalQtyBase
        : 0;

      // Build branch prices
      const branchPrices: BranchPrice[] = [];

      if (sellingByBranch) {
        sellingByBranch.forEach((sp, brId) => {
          const marginLast = computeMargin(sp.price, lastPurchasePrice);
          const marginAvg = computeMargin(sp.price, avgPurchasePrice);

          branchPrices.push({
            branchId: brId,
            branchName: branchNames.get(brId) || `Branch ${brId}`,
            sellingPrice: Math.round(sp.price),
            sellingPriceRaw: Math.round(sp.priceRaw),
            saleUnitName: sp.unitName,
            unitRatio: sp.ratio,
            lastSaleDate: sp.date,
            lastInvoiceNumber: sp.invoiceNumber,
            marginVsLastPurchase: Math.round(marginLast * 100) / 100,
            marginVsAvgPurchase: Math.round(marginAvg * 100) / 100,
          });
        });
      }

      // Sort branches by name
      branchPrices.sort((a, b) => a.branchName.localeCompare(b.branchName));

      // Overall margin: use first branch with selling price, or average
      let overallSellingPrice = 0;
      if (branchPrices.length > 0) {
        overallSellingPrice = branchPrices.reduce((sum, bp) => sum + bp.sellingPrice, 0) / branchPrices.length;
      }

      const overallMarginLast = computeMargin(overallSellingPrice, lastPurchasePrice);
      const overallMarginAvg = computeMargin(overallSellingPrice, avgPurchasePrice);
      const hasData = lastPurchasePrice > 0 && overallSellingPrice > 0;

      result.push({
        itemNo,
        itemName: item.name,
        category: item.itemType || '',
        baseUnitName: item.unit1Name || 'Pcs',
        salesUnitName: item.unit2Name || '',
        unitConversion: item.ratio2 || 0,
        masterSellingPrice: item.unitPrice || 0,
        masterCost: item.cost || 0,
        lastPurchasePrice: Math.round(lastPurchasePrice),
        lastPurchaseDate: purchase?.lastDate || '',
        lastPurchaseInvoice: purchase?.lastInvoiceNumber || '',
        lastPurchaseUnit: purchase?.lastUnitName || '',
        lastPurchaseRawPrice: Math.round(purchase?.lastPriceRaw || 0),
        lastPurchaseRatio: purchase?.lastUnitRatio || 1,
        avgPurchasePrice: Math.round(avgPurchasePrice),
        totalPurchaseQtyBase: Math.round(purchase?.totalQtyBase || 0),
        purchaseInvoiceCount: purchase?.invoiceCount || 0,
        inclusiveTax: purchase?.inclusiveTax ?? true,
        branchPrices,
        marginVsLastPurchase: Math.round(overallMarginLast * 100) / 100,
        marginVsAvgPurchase: Math.round(overallMarginAvg * 100) / 100,
        status: getStatus(overallMarginLast, hasData),
      });
    }

    // Sort: NEGATIVE first, then THIN, then NO_DATA, then HEALTHY
    const statusOrder = { NEGATIVE: 0, THIN: 1, NO_DATA: 2, HEALTHY: 3 };
    result.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    console.log(`[PriceAnalysis] Done: ${result.length} items analyzed`);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[PriceAnalysis] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
