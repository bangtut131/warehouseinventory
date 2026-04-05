import { NextResponse } from 'next/server';
import {
  fetchAllPurchasePriceData,
  fetchAllInventory,
  fetchItemMasterSellingPrices,
} from '@/lib/accurate';
import { PriceAnalysisItem, CategoryPrice } from '@/lib/types';

function computeMargin(sellPrice: number, buyPrice: number): number {
  if (buyPrice <= 0 || sellPrice <= 0) return 0;
  return ((sellPrice - buyPrice) / buyPrice) * 100;
}

// getStatus takes dynamic thresholds now
function getStatus(margin: number, hasData: boolean, marginHealthy: number, marginThin: number): PriceAnalysisItem['status'] {
  if (!hasData) return 'NO_DATA';
  if (margin < marginThin) return 'NEGATIVE';
  if (margin < marginHealthy) return 'THIN';
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

    // Fetch items first to get IDs
    const items = await fetchAllInventory();
    const itemIds = items.map(i => i.id);

    // Parallel fetch all data sources
    const [purchaseResult, masterPrices] = await Promise.all([
      fetchAllPurchasePriceData(fromDate, forceParam, undefined),
      fetchItemMasterSellingPrices(itemIds, forceParam),
    ]);

    const { priceMap } = purchaseResult;

    console.log(`[PriceAnalysis] Data loaded: ${items.length} items, ${priceMap.size} purchase prices, ${masterPrices.size} master prices`);

    // Fetch settings to get margins
    let marginHealthy = 15;
    let marginThin = 5;
    try {
      const { loadPriceSyncConfig } = await import('@/lib/price-sync-scheduler');
      const cfg = await loadPriceSyncConfig();
      if (cfg.marginHealthy !== undefined) marginHealthy = cfg.marginHealthy;
      if (cfg.marginThin !== undefined) marginThin = cfg.marginThin;
    } catch (err) {
      console.warn('[PriceAnalysis] Failed to load config, using default margin thresholds');
    }

    // Build result array
    const result: PriceAnalysisItem[] = [];

    for (const item of items) {
      const itemNo = item.no;
      const purchase = priceMap.get(itemNo);
      const masterSP = masterPrices.get(itemNo);

      const lastPurchasePrice = purchase?.lastPrice || 0;
      const avgPurchasePrice = purchase && purchase.totalQtyBase > 0
        ? purchase.totalCost / purchase.totalQtyBase
        : 0;

      const baseUnit = item.unit1Name || 'Pcs';
      const unit2Name = item.unit2Name || '';
      const ratio2 = masterSP?.ratio2 || item.ratio2 || 0;

      // Build category prices — already in base unit from accurate.ts
      const categoryPrices: CategoryPrice[] = [];

      if (masterSP?.prices) {
        for (const sp of masterSP.prices) {
          const marginLast = computeMargin(sp.price, lastPurchasePrice);
          const marginAvg = computeMargin(sp.price, avgPurchasePrice);

          categoryPrices.push({
            categoryId: sp.categoryId,
            categoryName: sp.categoryName,
            branchId: sp.branchId,
            branchName: sp.branchName,
            price: Math.round(sp.price),
            priceRaw: sp.price,
            unitName: sp.unitName,
            unitRatio: 1,
            effectiveDate: sp.effectiveDate,
            marginVsLastPurchase: Math.round(marginLast * 100) / 100,
            marginVsAvgPurchase: Math.round(marginAvg * 100) / 100,
          });
        }
      }

      // Sort by category name then branch name
      categoryPrices.sort((a, b) =>
        a.categoryName.localeCompare(b.categoryName) ||
        a.branchName.localeCompare(b.branchName)
      );

      // Overall margin: average of all category prices (normalized) vs purchase
      let overallSellingPrice = 0;
      const pricesWithValue = categoryPrices.filter(cp => cp.price > 0);
      if (pricesWithValue.length > 0) {
        // Use the lowest selling price for margin calculation (worst case)
        overallSellingPrice = Math.min(...pricesWithValue.map(cp => cp.price));
      }

      const overallMarginLast = computeMargin(overallSellingPrice, lastPurchasePrice);
      const overallMarginAvg = computeMargin(overallSellingPrice, avgPurchasePrice);
      const hasData = lastPurchasePrice > 0 && overallSellingPrice > 0;

      result.push({
        itemNo,
        itemName: item.name,
        category: item.itemType || '',
        baseUnitName: baseUnit,
        salesUnitName: unit2Name,
        unitConversion: ratio2,
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
        categoryPrices,
        marginVsLastPurchase: Math.round(overallMarginLast * 100) / 100,
        marginVsAvgPurchase: Math.round(overallMarginAvg * 100) / 100,
        status: getStatus(overallMarginLast, hasData, marginHealthy, marginThin),
      });
    }

    // Sort: NEGATIVE first, then THIN, then NO_DATA, then HEALTHY
    const statusOrder = { NEGATIVE: 0, THIN: 1, NO_DATA: 2, HEALTHY: 3 };
    result.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    console.log(`[PriceAnalysis] Done: ${result.length} items analyzed`);

    return NextResponse.json({
      data: result,
      config: {
        marginHealthy,
        marginThin
      }
    });
  } catch (error: any) {
    console.error('[PriceAnalysis] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
