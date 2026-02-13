import { NextRequest, NextResponse } from 'next/server';
import { fetchAllInventory, loadSalesCache, loadWarehouseStockCache, AccurateItem, ItemSalesData } from '@/lib/accurate';
import { InventoryItem, MonthlySales } from '@/lib/types';

// ─── CONSTANTS ────────────────────────────────────────────────
const Z_SCORE_95 = 1.645;
const LEAD_TIME_DAYS = 14;
const HOLDING_COST_PCT = 0.25;     // 25% of cost per year
const ORDER_COST = 150000;         // Rp 150k per order (estimated)
const DEFAULT_ANALYSIS_START = new Date(2025, 0, 1); // Jan 1, 2025

// ─── HELPERS ──────────────────────────────────────────────────

function parseDate(dateStr: string): Date {
    const parts = dateStr.split('/');
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
}

function getMonthKey(date: Date): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]}|${date.getFullYear()}`;
}

function generateDateHeaders(start: Date, end: Date): { key: string; month: string; year: number }[] {
    const headers: { key: string; month: string; year: number }[] = [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(start);
    while (d <= end) {
        headers.push({
            key: `${months[d.getMonth()]}|${d.getFullYear()}`,
            month: months[d.getMonth()],
            year: d.getFullYear()
        });
        d.setMonth(d.getMonth() + 1);
    }
    return headers;
}

// ─── SMART ESTIMATION ENGINE ──────────────────────────────────
// When sales API fails, generate realistic demand estimates
// based on stock levels, item type, cost, and price.

function estimateDemand(item: AccurateItem, monthCount: number): {
    monthlyData: Map<string, { qty: number; qtyBox: number; revenue: number }>;
    totalQty: number;
    totalQtyBox: number;
    totalRevenue: number;
    unitConversion: number;
    salesUnitName: string;
} {
    const qty = item.quantity || 0;
    const cost = item.cost || 0;
    const price = item.unitPrice || 0;

    // Base daily demand estimation from stock level
    // Logic: items with moderate stock relative to price are likely active sellers
    // Items with very high stock + low price = slow movers
    // Items with very low stock + high price = fast movers (always selling out)

    // Use deterministic seed from item.no for consistent estimates
    const seed = hashCode(item.no);
    let baseDailyDemand: number;

    if (qty === 0) {
        // Zero stock: either sold out (fast) or discontinued (dead)
        if (price > 500000) {
            baseDailyDemand = pseudoRandom(seed + 1) * 3 + 1; // 1-4/day
        } else if (price > 50000) {
            baseDailyDemand = pseudoRandom(seed + 2) * 5 + 2; // 2-7/day
        } else {
            baseDailyDemand = 0; // Likely discontinued
        }
    } else if (qty <= 10) {
        baseDailyDemand = pseudoRandom(seed + 3) * 8 + 3; // 3-11/day
    } else if (qty <= 50) {
        baseDailyDemand = pseudoRandom(seed + 4) * 5 + 1; // 1-6/day
    } else if (qty <= 200) {
        baseDailyDemand = pseudoRandom(seed + 5) * 3 + 0.5; // 0.5-3.5/day
    } else if (qty <= 1000) {
        baseDailyDemand = pseudoRandom(seed + 6) * 1.5 + 0.1; // 0.1-1.6/day
    } else {
        baseDailyDemand = pseudoRandom(seed + 7) * 0.3; // 0-0.3/day
    }

    // Price factor: more expensive = fewer units but higher revenue impact
    if (price > 1000000) baseDailyDemand *= 0.4;
    else if (price > 500000) baseDailyDemand *= 0.6;
    else if (price < 10000) baseDailyDemand *= 1.5;

    // Seasonal pattern with trend
    const dateHeaders = generateDateHeaders(DEFAULT_ANALYSIS_START, new Date());
    const monthlyData = new Map<string, { qty: number; qtyBox: number; revenue: number }>();
    let totalQty = 0;
    let totalRevenue = 0;

    // seed already declared above
    const seasonalPeak = (seed % 12); // peak month varies by item

    dateHeaders.forEach((h, idx) => {
        // Seasonal factor (sine wave peaking at different months)
        const monthIdx = (['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']).indexOf(h.month);
        const seasonalFactor = 1 + 0.3 * Math.sin((monthIdx - seasonalPeak) * Math.PI / 6);

        // Slight growth trend
        const trendFactor = 1 + (idx * 0.02);

        // Random noise (±20%)
        const noise = 0.8 + (pseudoRandom(seed + idx) * 0.4);

        const monthlyQty = Math.max(0, Math.round(baseDailyDemand * 30 * seasonalFactor * trendFactor * noise));
        const sellPrice = price > 0 ? price : cost * 1.3;
        const monthlyRevenue = monthlyQty * sellPrice;

        monthlyData.set(h.key, { qty: monthlyQty, qtyBox: monthlyQty, revenue: monthlyRevenue });
        totalQty += monthlyQty;
        totalRevenue += monthlyRevenue;
    });

    return { monthlyData, totalQty, totalQtyBox: totalQty, totalRevenue, unitConversion: 0, salesUnitName: '' };
}

// Deterministic hash for consistent random per item
function hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash);
}

// Pseudo-random from seed (deterministic)
function pseudoRandom(seed: number): number {
    const x = Math.sin(seed * 9301 + 49297) * 233280;
    return x - Math.floor(x);
}

// ─── MAIN API HANDLER ────────────────────────────────────────

export async function GET(request: NextRequest) {
    try {
        // Parse query params
        const { searchParams } = new URL(request.url);
        const fromParam = searchParams.get('from');
        const toParam = searchParams.get('to');
        const branchParam = searchParams.get('branch');
        const warehouseParam = searchParams.get('warehouse');

        // Determine analysis date range
        const analysisStart = fromParam ? new Date(fromParam) : DEFAULT_ANALYSIS_START;
        const analysisEnd = toParam ? new Date(toParam) : new Date();
        const branchId = branchParam ? parseInt(branchParam) : undefined;
        const warehouseId = warehouseParam ? parseInt(warehouseParam) : undefined;
        console.log(`[API] Date range: ${analysisStart.toLocaleDateString()} → ${analysisEnd.toLocaleDateString()}${branchId ? ` (branch ${branchId})` : ''}${warehouseId ? ` (warehouse ${warehouseId})` : ''}`);

        // 1. Fetch real items from Accurate
        console.log('[API] Fetching inventory items...');
        const accurateItems = await fetchAllInventory();
        console.log(`[API] Got ${accurateItems.length} items from Accurate`);

        // 2. Fetch real sales data (from cache if available, otherwise fresh fetch)
        let dataSource: 'API' | 'ESTIMATED' = 'ESTIMATED';
        const itemSalesMap = new Map<string, ItemSalesData>();

        try {
            const cachedSales = await loadSalesCache(analysisStart, branchId);
            if (cachedSales && cachedSales.size > 0) {
                dataSource = 'API';
                cachedSales.forEach((val: ItemSalesData, key: string) => {
                    itemSalesMap.set(key, val);
                });
                console.log(`[API] Got real sales data for ${cachedSales.size} items (from cache${branchId ? `, branch ${branchId}` : ''})`);
            } else {
                console.log('[API] No sales cache found — using estimation. Run Force Sync to populate.');
            }
        } catch (err: any) {
            console.log('[API] Sales cache read failed:', err.message, '— using estimation');
        }

        // 3. Fallback to estimation if no real data
        const today = analysisEnd;
        const dateHeaders = generateDateHeaders(analysisStart, today);
        const daysSinceStart = Math.max(1, Math.floor((today.getTime() - analysisStart.getTime()) / (1000 * 3600 * 24)));
        const monthCount = dateHeaders.length;

        if (dataSource === 'ESTIMATED') {
            accurateItems.forEach(item => {
                const est = estimateDemand(item, monthCount);
                itemSalesMap.set(item.no, est);
            });
        }

        // 3b. Load warehouse stock cache if warehouse filter is selected
        const warehouseStockMap = warehouseId ? await loadWarehouseStockCache() : null;
        if (warehouseId && warehouseStockMap) {
            console.log(`[API] Using warehouse stock for warehouse ${warehouseId}`);
        } else if (warehouseId) {
            console.log(`[API] Warehouse ${warehouseId} selected but no warehouse stock cache — showing total stock. Run Force Sync to get per-warehouse stock.`);
        }

        // 4. Transform to InventoryItem with full analysis
        const inventoryItems: InventoryItem[] = accurateItems.map(item => {
            const salesData = itemSalesMap.get(item.no) || {
                totalQty: 0, totalQtyBox: 0, totalRevenue: 0, monthlyData: new Map(),
                unitConversion: 0, salesUnitName: '',
            };

            // ── Core Metrics ────────────────────
            // Use warehouse-specific stock if warehouse is selected and cache is available
            let quantity = item.quantity || 0;
            if (warehouseId && warehouseStockMap) {
                const itemWhStock = warehouseStockMap.get(item.no);
                if (itemWhStock) {
                    quantity = itemWhStock.get(warehouseId) || 0;
                } else {
                    quantity = 0; // item not in warehouse stock cache
                }
            }
            const price = item.unitPrice || 0;
            const effectiveCost = item.cost > 0 ? item.cost : (price > 0 ? price * 0.7 : 0);
            const unit = item.unit1Name || 'PCS';

            // ── Demand Metrics ──────────────────
            const avgDailyUsage = parseFloat((salesData.totalQty / daysSinceStart).toFixed(2));
            const avgMonthlyUsage = parseFloat((salesData.totalQty / monthCount).toFixed(1));

            // Standard Deviation (from monthly data)
            const monthlyQtys = dateHeaders.map(h => salesData.monthlyData.get(h.key)?.qty || 0);
            const mean = monthlyQtys.reduce((a, b) => a + b, 0) / monthlyQtys.length;
            const variance = monthlyQtys.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / monthlyQtys.length;
            const stdDev = parseFloat(Math.sqrt(variance).toFixed(2));
            const dailyStdDev = parseFloat((stdDev / 30).toFixed(2));

            // ── ROP / Safety Stock ──────────────
            const safetyStock = Math.ceil(Z_SCORE_95 * dailyStdDev * Math.sqrt(LEAD_TIME_DAYS));
            const reorderPoint = Math.ceil((avgDailyUsage * LEAD_TIME_DAYS) + safetyStock);
            const maxStock = Math.ceil(reorderPoint * 2.5);

            // ── Days of Supply ──────────────────
            const rawDoS = avgDailyUsage > 0 ? quantity / avgDailyUsage : 99999;
            const daysOfSupply = parseFloat(Math.min(rawDoS, 99999).toFixed(1));

            // ── Status ──────────────────────────
            let status: InventoryItem['status'] = 'OK';
            if (quantity <= safetyStock && avgDailyUsage > 0) status = 'CRITICAL';
            else if (quantity <= reorderPoint && avgDailyUsage > 0) status = 'REORDER';
            else if (daysOfSupply > 90 || (avgDailyUsage === 0 && quantity > 0)) status = 'OVERSTOCK';

            // ── EOQ ─────────────────────────────
            // EOQ = sqrt((2 × D × S) / H)
            // D = annual demand, S = order cost, H = holding cost per unit per year
            const annualDemand = avgDailyUsage * 365;
            const holdingCostPerUnit = effectiveCost * HOLDING_COST_PCT;
            const eoq = holdingCostPerUnit > 0
                ? Math.ceil(Math.sqrt((2 * annualDemand * ORDER_COST) / holdingCostPerUnit))
                : 0;

            // ── Turnover Rate ───────────────────
            // Turnover = Annual COGS / Average Inventory Value
            const annualCOGS = salesData.totalQty * effectiveCost * (12 / monthCount);
            const avgInventoryValue = quantity * effectiveCost;
            const turnoverRate = avgInventoryValue > 0
                ? parseFloat((annualCOGS / avgInventoryValue).toFixed(2))
                : 0;

            // ── Demand Category ─────────────────
            let demandCategory: InventoryItem['demandCategory'] = 'NON-MOVING';
            if (avgDailyUsage >= 5) demandCategory = 'FAST';
            else if (avgDailyUsage >= 0.5) demandCategory = 'SLOW';
            else if (avgDailyUsage > 0) demandCategory = 'NON-MOVING';
            else demandCategory = 'DEAD';

            // ── Stock Age ───────────────────────
            // Estimated: if demand=0, stock age = entire period. Otherwise stock age = DoS (how long current stock lasts)
            const stockAgeDays = avgDailyUsage > 0
                ? Math.min(Math.round(quantity / avgDailyUsage), daysSinceStart)
                : (quantity > 0 ? daysSinceStart : 0);

            // ── XYZ Classification ──────────────
            // CV (Coefficient of Variation) = StdDev / Mean
            const cv = mean > 0 ? stdDev / mean : 999;
            let xyzClass: InventoryItem['xyzClass'] = 'Z';
            if (cv <= 0.5) xyzClass = 'X';       // Stable demand
            else if (cv <= 1.0) xyzClass = 'Y';  // Variable demand
            else xyzClass = 'Z';                  // Erratic demand

            // ── Monthly Sales Array ─────────────
            const monthlySales: MonthlySales[] = dateHeaders.map(h => {
                const data = salesData.monthlyData.get(h.key) || { qty: 0, qtyBox: 0, revenue: 0 };
                return {
                    month: h.month,
                    year: h.year,
                    qty: data.qty,
                    qtyBox: data.qtyBox || 0,
                    revenue: data.revenue
                };
            });

            // ── Stock Value ─────────────────────
            const stockValue = Math.round(quantity * effectiveCost);

            return {
                id: item.id.toString(),
                itemNo: item.no,
                name: item.name,
                category: item.itemType || 'General',
                unit,
                stock: quantity,
                cost: effectiveCost,
                price,
                reorderPoint,
                safetyStock,
                minStock: safetyStock,
                maxStock,
                averageDailyUsage: avgDailyUsage,
                leadTimeDays: LEAD_TIME_DAYS,
                serviceLevel: 0.95,
                standardDeviation: dailyStdDev,
                annualRevenue: salesData.totalRevenue,
                abcClass: 'C' as const,
                xyzClass,
                eoq,
                turnoverRate,
                demandCategory,
                stockAgeDays,
                totalSalesQty: salesData.totalQty,
                totalSalesQtyBox: salesData.totalQtyBox || 0,
                totalSalesRevenue: salesData.totalRevenue,
                unitConversion: salesData.unitConversion || 0,
                salesUnitName: salesData.salesUnitName || '',
                daysOfSupply,
                stockValue,
                status,
                monthlySales,
                dataSource
            };
        });

        // 5. ABC Analysis (by revenue, Pareto)
        inventoryItems.sort((a, b) => b.annualRevenue - a.annualRevenue);
        const totalRevenue = inventoryItems.reduce((sum, i) => sum + i.annualRevenue, 0);
        let cumRevenue = 0;
        inventoryItems.forEach(item => {
            cumRevenue += item.annualRevenue;
            const pct = totalRevenue > 0 ? cumRevenue / totalRevenue : 0;
            if (pct <= 0.80) item.abcClass = 'A';
            else if (pct <= 0.95) item.abcClass = 'B';
            else item.abcClass = 'C';
        });

        console.log(`[API] Returning ${inventoryItems.length} analyzed items (source: ${dataSource})`);
        return NextResponse.json(inventoryItems);

    } catch (error: any) {
        console.error('[API] Fatal error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
