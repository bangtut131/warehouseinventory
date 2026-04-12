import axios from 'axios';
import crypto from 'crypto';
import path from 'path'; // still needed for date logic? No, but maybe specific utility
import { prisma } from './prisma';
import { SOData, SODetailItem } from './types';

const API_HOST = process.env.ACCURATE_API_HOST || 'https://zeus.accurate.id/accurate/api';
const API_TOKEN = process.env.ACCURATE_API_TOKEN || '';
const SIGNATURE_SECRET = process.env.ACCURATE_SIGNATURE_SECRET || '';
const DB_ID = process.env.ACCURATE_DB_ID || '453772';




// Cache keys
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCacheKey(fromDate: Date, branchId?: number): string {
  const dateKey = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`;
  const branchKey = branchId ? `-branch${branchId}` : '';
  return `sales-cache-${dateKey}${branchKey}`;
}

/** Delete cache for a specific date or all caches */
export async function clearSalesCache(fromDate?: Date, branchId?: number): Promise<void> {
  try {
    if (fromDate) {
      const key = getCacheKey(fromDate, branchId);
      await prisma.dataCache.delete({ where: { key } }).catch(() => { });
      console.log(`[Cache] Deleted cache key: ${key}`);
    } else {
      // Delete all sales caches
      // Prisma deleteMany with startsWith?
      // SQLite/Postgres supports 'contains' or 'startsWith' in where
      await prisma.dataCache.deleteMany({
        where: {
          key: { startsWith: 'sales-cache-' }
        }
      });
      console.log(`[Cache] Deleted all sales cache keys`);
    }
  } catch (err: any) {
    console.warn(`[Cache] Error clearing cache:`, err.message);
  }
}

// â”€â”€â”€ Sync progress tracker (read by /api/sync) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const syncProgress = {
  phase: '' as '' | 'listing' | 'details' | 'aggregating' | 'warehouseStock' | 'poOutstanding' | 'done',
  done: 0,
  total: 0,
  message: '',
};

// Create Axios client with proper headers (including X-Session-ID)
export const accurateClient = axios.create({
  baseURL: API_HOST,
  timeout: 30000, // 30 seconds â€” prevent hung connections from blocking sync
  headers: {
    'Authorization': `Bearer ${API_TOKEN}`,
    'X-Session-ID': DB_ID,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Interceptor: sign every request with HMAC-SHA256(Secret, Timestamp)
accurateClient.interceptors.request.use((config) => {
  const timestamp = new Date().toISOString();
  config.headers['X-Api-Timestamp'] = timestamp;

  if (SIGNATURE_SECRET) {
    const signature = crypto.createHmac('sha256', SIGNATURE_SECRET)
      .update(timestamp)
      .digest('base64');
    config.headers['X-Api-Signature'] = signature;
  }

  return config;
});

// â”€â”€â”€ ITEM LIST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface AccurateItem {
  id: number;
  no: string;
  name: string;
  itemType: string;
  quantity: number;
  unitPrice: number;
  cost: number;
  unit1Name?: string; // Satuan utama (Pcs/Kg)
  unit2Name?: string; // Satuan kedua (Box/Sak)
  ratio2?: number;    // Rasio unit2 ke unit1 (misal 1 Box = 12 Pcs â†’ ratio2 = 12). 0 = no unit2.
}

export async function fetchInventory(page = 1, pageSize = 100): Promise<{ list: AccurateItem[], hasMore: boolean }> {
  try {
    const response = await accurateClient.get('/item/list.do', {
      params: {
        fields: 'id,no,name,itemType,quantity,unitPrice,cost,unit1Name,unit2Name,ratio2',
        'sp.page': page,
        'sp.pageSize': pageSize
      }
    });

    if (response.data?.s) {
      const list = response.data.d || [];
      const hasMore = list.length >= pageSize;
      console.log(`[Accurate] Page ${page}: ${list.length} items (hasMore: ${hasMore})`);
      return { list, hasMore };
    }

    console.error('[Accurate] Item list error:', response.data?.d);
    return { list: [], hasMore: false };
  } catch (error: any) {
    console.error('[Accurate] Failed to fetch items:', error.message);
    throw error;
  }
}

export async function fetchAllInventory(): Promise<AccurateItem[]> {
  let allItems: AccurateItem[] = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  while (hasMore && page <= 50) {
    console.log(`[Accurate] Fetching inventory page ${page}...`);
    const result = await fetchInventory(page, pageSize);
    allItems = [...allItems, ...result.list];
    hasMore = result.hasMore;
    page++;
  }

  console.log(`[Accurate] Total items fetched: ${allItems.length}`);
  return allItems;
}

// â”€â”€â”€ SALES INVOICE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface AccurateInvoiceItem {
  item: {
    id: number;
    no: string;
    name: string;
  };
  quantity: number;          // qty in sales unit (box/karung/etc)
  quantityInBase: number;    // qty in base unit (pcs)
  unitRatio: number;         // conversion ratio to base unit
  unitPrice: number;
  totalPrice?: number;
  itemUnitName?: string;     // sales unit name (e.g. "Box", "Karung")
}

export interface AccurateInvoice {
  id: number;
  number: string;
  transDate: string;
  branchId?: number;
  detailItem?: AccurateInvoiceItem[];
}

// Parse Accurate date format DD/MM/YYYY â†’ Date
function parseAccurateDate(dateStr: string): Date {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  }
  return new Date(dateStr);
}

/**
 * Phase 1: Fetch invoice IDs using API-level date + branch filter.
 * Uses dot-notation params: filter.transDate.op=BETWEEN, filter.branchId.op=EQUAL
 * Includes retry with backoff on HTTP 429 (rate limit).
 */
async function fetchInvoiceList(fromDate: Date, branchId?: number): Promise<{ id: number; transDate: string; branchId?: number }[]> {
  const allInvoices: { id: number; transDate: string; branchId?: number }[] = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  // Format dates as DD/MM/YYYY for Accurate API
  const fromStr = `${String(fromDate.getDate()).padStart(2, '0')}/${String(fromDate.getMonth() + 1).padStart(2, '0')}/${fromDate.getFullYear()}`;
  const now = new Date();
  const toStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  console.log(`[Accurate] Phase 1: Fetching invoice IDs (${fromStr} â†’ ${toStr})${branchId ? ` branch=${branchId}` : ''}...`);

  while (hasMore) {
    const params: Record<string, any> = {
      fields: 'id,transDate,branchId',
      'filter.transDate.op': 'BETWEEN',
      'filter.transDate.val[0]': fromStr,
      'filter.transDate.val[1]': toStr,
      'sp.page': page,
      'sp.pageSize': pageSize,
    };
    if (branchId) {
      params['filter.branchId.op'] = 'EQUAL';
      params['filter.branchId.val'] = branchId;
    }

    // Retry loop for rate limiting (429)
    let success = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const response = await accurateClient.get('/sales-invoice/list.do', { params });

        if (response.data?.s) {
          const list = response.data.d || [];
          if (list.length === 0) {
            hasMore = false;
          } else {
            list.forEach((inv: any) => {
              allInvoices.push({ id: inv.id, transDate: inv.transDate, branchId: inv.branchId });
            });
            if (page % 50 === 0) {
              console.log(`[Accurate]   ... page ${page}, collected ${allInvoices.length} invoices so far`);
            }
            page++;
            if (page > 500) {
              console.log(`[Accurate]   Hit 500 pages, stopping at ${allInvoices.length} invoices`);
              hasMore = false;
            }
          }
          success = true;
          break; // Success â€” exit retry loop
        } else {
          console.warn('[Accurate] Invoice list API returned s=false:', response.data?.d);
          hasMore = false;
          success = true;
          break;
        }
      } catch (error: any) {
        const status = error.response?.status;
        if (status === 429 && attempt < 5) {
          const delay = 3000 * Math.pow(2, attempt - 1); // 3s, 6s, 12s, 24s
          console.warn(`[Accurate] Invoice page ${page}: HTTP 429 rate limit (attempt ${attempt}/5). Waiting ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`[Accurate] Invoice list page ${page} error (attempt ${attempt}):`, error.message);
          hasMore = false;
          success = true; // Stop retrying
          break;
        }
      }
    }

    if (!success) {
      console.error(`[Accurate] Invoice page ${page}: All 5 retry attempts failed. Stopping.`);
      hasMore = false;
    }

    // Small throttle between pages to reduce rate limit hits
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`[Accurate] Phase 1 done: ${allInvoices.length} total invoices`);
  return allInvoices;
}

/**
 * Phase 2: Fetch detail for a single invoice (to get detailItem).
 * Retries up to maxRetries times with exponential backoff.
 */
async function fetchInvoiceDetail(invoiceId: number, maxRetries: number = 3): Promise<AccurateInvoice | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await accurateClient.get('/sales-invoice/detail.do', {
        params: { id: invoiceId }
      });

      if (response.data?.s && response.data.d) {
        const d = response.data.d;
        return {
          id: d.id,
          number: d.number,
          transDate: d.transDate,
          branchId: d.branchId || undefined,
          detailItem: d.detailItem?.map((di: any) => ({
            item: di.item ? { id: di.item.id, no: di.item.no, name: di.item.name } : { id: 0, no: '', name: '' },
            quantity: di.quantity || 0,
            quantityInBase: di.quantityInBase || (di.quantity * (di.unitRatio || 1)) || 0,
            unitRatio: di.unitRatio || 1,
            unitPrice: di.unitPrice || 0,
            totalPrice: di.totalPrice || 0,
            itemUnitName: di.itemUnitName || di.unitName || '',
          })) || []
        };
      }
      // API returned s=false, no point retrying
      return null;
    } catch (err: any) {
      if (attempt < maxRetries) {
        const delay = 1000 * attempt; // 1s, 2s, 3s
        console.warn(`[Accurate] Invoice ${invoiceId} fetch failed (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`[Accurate] Invoice ${invoiceId} FAILED after ${maxRetries} attempts: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

/**
 * Process invoices in parallel batches with retry for failures.
 */
async function fetchDetailsInBatch(
  invoiceIds: number[],
  batchSize: number = 20,
  onProgress?: (done: number, total: number) => void
): Promise<AccurateInvoice[]> {
  const results: AccurateInvoice[] = [];
  const failedIds: number[] = [];
  const total = invoiceIds.length;

  // Main pass
  for (let i = 0; i < total; i += batchSize) {
    const batch = invoiceIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(id => fetchInvoiceDetail(id))
    );
    batch.forEach((id, idx) => {
      if (batchResults[idx]) {
        results.push(batchResults[idx]!);
      } else {
        failedIds.push(id);
      }
    });
    if (onProgress) onProgress(Math.min(i + batchSize, total), total);
  }

  // Retry pass for failed invoices (smaller batch, more patience)
  if (failedIds.length > 0) {
    console.warn(`[Accurate] ${failedIds.length} invoices failed in main pass. Retrying individually...`);
    let recovered = 0;
    for (const id of failedIds) {
      // Wait a bit between retries to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      const result = await fetchInvoiceDetail(id, 3);
      if (result) {
        results.push(result);
        recovered++;
      }
    }
    const stillFailed = failedIds.length - recovered;
    console.log(`[Accurate] Retry pass done: recovered ${recovered}/${failedIds.length}. Still failed: ${stillFailed}`);
    if (stillFailed > 0) {
      console.warn(`[Accurate] âš ï¸ ${stillFailed} invoices could NOT be fetched. Sales data may be incomplete.`);
    }
  }

  return results;
}

// â”€â”€â”€ AGGREGATED SALES DATA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ItemSalesData {
  totalQty: number;          // total in base unit (pcs)
  totalQtyBox: number;       // total in sales unit (box/karung)
  totalRevenue: number;
  monthlyData: Map<string, { qty: number; qtyBox: number; revenue: number }>;
  unitConversion: number;    // pcs per box (0 = same unit)
  salesUnitName: string;     // e.g. "Box", "Karung", "Pcs"
}

interface CachedSalesData {
  timestamp: number;
  data: Record<string, {
    totalQty: number;
    totalQtyBox: number;
    totalRevenue: number;
    monthlyData: Record<string, { qty: number; qtyBox: number; revenue: number }>;
    unitConversion: number;
    salesUnitName: string;
  }>;
}

function getMonthKey(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]}|${date.getFullYear()}`;
}

/**
 * Try to load cached sales data. Returns null if cache is stale or missing.
 * Exported so /api/inventory can read cache-only without triggering a full fetch.
 */
export async function loadSalesCache(fromDate: Date, branchId?: number): Promise<Map<string, ItemSalesData> | null> {
  try {
    const key = getCacheKey(fromDate, branchId);

    // DB Fetch
    const cacheEntry = await prisma.dataCache.findUnique({
      where: { key }
    });

    if (!cacheEntry || !cacheEntry.data) {
      // Check for legacy logic if needed? No, strict DB now.
      if (branchId) {
        console.log(`[Cache] No cache for branch ${branchId}`);
        return null;
      }
      // Fallback to check generic cache key if needed? No.
      return null;
    }

    const cached = cacheEntry.data as unknown as CachedSalesData; // Prisma Json -> cast
    const age = Date.now() - cached.timestamp;
    console.log(`[Cache] Sales cache is ${Math.round(age / 60000)} min old`);

    console.log(`[Cache] Using cached sales data (${Math.round(age / 60000)} min old)`);
    const map = new Map<string, ItemSalesData>();
    for (const [itemNo, data] of Object.entries(cached.data)) {
      map.set(itemNo, {
        totalQty: data.totalQty,
        totalQtyBox: data.totalQtyBox || 0,
        totalRevenue: data.totalRevenue,
        monthlyData: new Map(Object.entries(data.monthlyData)),
        unitConversion: data.unitConversion || 0,
        salesUnitName: data.salesUnitName || '',
      });
    }
    return map;
  } catch (err: any) {
    console.warn('[Cache] Load error:', err.message);
    return null;
  }
}

/**
 * Save sales data to cache DB.
 */
export async function saveSalesCache(fromDate: Date, salesMap: Map<string, ItemSalesData>, branchId?: number): Promise<void> {
  try {
    const data: CachedSalesData['data'] = {};
    salesMap.forEach((val, key) => {
      data[key] = {
        totalQty: val.totalQty,
        totalQtyBox: val.totalQtyBox || 0,
        totalRevenue: val.totalRevenue,
        monthlyData: Object.fromEntries(val.monthlyData),
        unitConversion: val.unitConversion || 0,
        salesUnitName: val.salesUnitName || '',
      };
    });

    const cached: CachedSalesData = { timestamp: Date.now(), data };
    const key = getCacheKey(fromDate, branchId);

    await prisma.dataCache.upsert({
      where: { key },
      update: { data: cached as any }, // Cast to any to avoid Prisma JSON type issues
      create: { key, data: cached as any },
    });

    console.log(`[Cache] Sales data saved to DB key: ${key}`);
  } catch (err: any) {
    console.warn(`[Cache] Failed to save cache:`, err.message);
  }
}

/**
 * Main entry point: Fetch all sales data from Accurate with caching.
 * Returns a Map of itemNo â†’ { totalQty, totalRevenue, monthlyData }
 */
export async function fetchAllSalesData(
  fromDate: Date,
  force: boolean = false,
  branchId?: number,
  skipCacheOps: boolean = false  // When true: don't clear or write cache (caller manages atomicity)
): Promise<{ salesMap: Map<string, ItemSalesData>; invoiceCount: number; branchSalesMaps: Map<number, Map<string, ItemSalesData>> }> {
  // 1. Try cache first (unless force sync or skipCacheOps)
  if (!force && !skipCacheOps) {
    const cached = await loadSalesCache(fromDate, branchId);
    if (cached) {
      return { salesMap: cached, invoiceCount: -1, branchSalesMaps: new Map() }; // -1 indicates cached
    }
  } else if (force && !skipCacheOps) {
    console.log(`[Accurate] Force sync requested â€” clearing cache${branchId ? ` (branch ${branchId})` : ''}`);
    await clearSalesCache(fromDate, branchId);
  } else {
    console.log(`[Accurate] Atomic sync mode â€” cache ops skipped (caller manages)`);
  }

  // 2. Phase 1: Get invoice IDs (API-level date + branch filter)
  syncProgress.phase = 'listing';
  syncProgress.message = 'Mengambil daftar invoice...';
  const filteredInvoices = await fetchInvoiceList(fromDate, branchId);
  console.log(`[Accurate] ${filteredInvoices.length} invoices from ${fromDate.toLocaleDateString()} onwards${branchId ? ` (branch ${branchId})` : ''}`);

  // 3. Phase 2: Fetch detail for each invoice in parallel batches
  const invoiceIds = filteredInvoices.map(inv => inv.id);
  syncProgress.phase = 'details';
  syncProgress.total = invoiceIds.length;
  syncProgress.done = 0;
  syncProgress.message = `Mengambil detail 0/${invoiceIds.length} invoice...`;
  console.log(`[Accurate] Phase 2: Fetching detail for ${invoiceIds.length} invoices (batch size=20)...`);

  const invoices = await fetchDetailsInBatch(invoiceIds, 20, (done, total) => {
    syncProgress.done = done;
    syncProgress.message = `Mengambil detail ${done}/${total} invoice...`;
    if (done % 200 === 0 || done === total) {
      console.log(`[Accurate]   Detail progress: ${done}/${total}`);
    }
  });

  // Build invoiceId â†’ branchId map from Phase 1 list data
  const invoiceBranchMap = new Map<number, number>();
  filteredInvoices.forEach(inv => {
    if (inv.branchId) invoiceBranchMap.set(inv.id, inv.branchId);
  });

  // Merge branchId from list into detail-fetched invoices
  invoices.forEach(inv => {
    if (!inv.branchId) {
      inv.branchId = invoiceBranchMap.get(inv.id);
    }
  });

  // 5. Aggregate sales data by item (all branches combined)
  const salesMap = new Map<string, ItemSalesData>();
  // Also track per-branch aggregation (only when syncing all branches)
  const branchSalesMaps = new Map<number, Map<string, ItemSalesData>>();

  invoices.forEach(inv => {
    const date = parseAccurateDate(inv.transDate);
    const monthKey = getMonthKey(date);
    const invBranchId = inv.branchId;

    if (inv.detailItem) {
      inv.detailItem.forEach(d => {
        const itemNo = d.item?.no;
        if (!itemNo) return;

        const qtyPcs = d.quantityInBase || d.quantity;
        const qtyBox = d.quantity;
        const lineRevenue = d.totalPrice || (d.quantity * d.unitPrice);
        const unitName = d.itemUnitName || '';
        // Compute conversion: pcs per box
        const convRatio = (qtyBox > 0 && qtyPcs !== qtyBox) ? Math.round(qtyPcs / qtyBox) : 0;

        // Aggregate to main (all branches) map
        const entry = salesMap.get(itemNo) || {
          totalQty: 0,
          totalQtyBox: 0,
          totalRevenue: 0,
          monthlyData: new Map(),
          unitConversion: 0,
          salesUnitName: '',
        };
        entry.totalQty += qtyPcs;
        entry.totalQtyBox += qtyBox;
        entry.totalRevenue += lineRevenue;
        if (convRatio > 0) entry.unitConversion = convRatio;
        if (unitName) entry.salesUnitName = unitName;
        const curr = entry.monthlyData.get(monthKey) || { qty: 0, qtyBox: 0, revenue: 0 };
        curr.qty += qtyPcs;
        curr.qtyBox += qtyBox;
        curr.revenue += lineRevenue;
        entry.monthlyData.set(monthKey, curr);
        salesMap.set(itemNo, entry);

        // Also aggregate to per-branch map (if not branch-specific sync)
        if (!branchId && invBranchId) {
          if (!branchSalesMaps.has(invBranchId)) {
            branchSalesMaps.set(invBranchId, new Map());
          }
          const branchMap = branchSalesMaps.get(invBranchId)!;
          const brEntry = branchMap.get(itemNo) || {
            totalQty: 0,
            totalQtyBox: 0,
            totalRevenue: 0,
            monthlyData: new Map(),
            unitConversion: 0,
            salesUnitName: '',
          };
          brEntry.totalQty += qtyPcs;
          brEntry.totalQtyBox += qtyBox;
          brEntry.totalRevenue += lineRevenue;
          if (convRatio > 0) brEntry.unitConversion = convRatio;
          if (unitName) brEntry.salesUnitName = unitName;
          const brCurr = brEntry.monthlyData.get(monthKey) || { qty: 0, qtyBox: 0, revenue: 0 };
          brCurr.qty += qtyPcs;
          brCurr.qtyBox += qtyBox;
          brCurr.revenue += lineRevenue;
          brEntry.monthlyData.set(monthKey, brCurr);
          branchMap.set(itemNo, brEntry);
        }
      });
    }
  });

  console.log(`[Accurate] Aggregated sales data for ${salesMap.size} items from ${invoices.length} invoices`);

  // 6. Cache results â€” ONLY if not in atomic mode
  if (!skipCacheOps) {
    await saveSalesCache(fromDate, salesMap, branchId);

    // 6b. Auto-save per-branch caches (only when syncing all branches)
    if (!branchId && branchSalesMaps.size > 0) {
      console.log(`[Accurate] Auto-splitting cache for ${branchSalesMaps.size} branches...`);
      for (const [brId, brMap] of branchSalesMaps) {
        await saveSalesCache(fromDate, brMap, brId);
        console.log(`[Accurate]   Branch ${brId}: ${brMap.size} items cached`);
      }
    }
  } else {
    console.log(`[Accurate] Atomic mode: skipping cache write (caller will handle)`);
  }

  return { salesMap, invoiceCount: invoices.length, branchSalesMaps };
}

// â”€â”€â”€ WAREHOUSE STOCK (Phase 3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Per-warehouse stock data: itemNo â†’ { warehouseId â†’ quantity }
 */
export type WarehouseStockMap = Map<string, Map<number, number>>;

interface CachedWarehouseStock {
  timestamp: number;
  /** itemNo â†’ { warehouseId: quantity } */
  data: Record<string, Record<string, number>>;
}

const WH_STOCK_CACHE_KEY = 'warehouse-stock-cache';
const WH_STOCK_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Fetch warehouse stock for a single item via item/detail.do.
 * Returns an array of { warehouseId, warehouseName, quantity } entries.
 */
async function fetchItemWarehouseStock(itemNo: string): Promise<{ warehouseId: number; warehouseName: string; quantity: number }[]> {
  try {
    const response = await accurateClient.get('/item/detail.do', {
      params: { no: itemNo }
    });
    if (response.data?.s && response.data.d) {
      const dwd = response.data.d.detailWarehouseData;
      if (Array.isArray(dwd)) {
        return dwd.map((w: any) => ({
          warehouseId: w.id,
          warehouseName: w.name || '',
          quantity: w.unit1Quantity || 0,
        }));
      }
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Batch fetch warehouse stock for all items.
 * Returns a Map: itemNo â†’ Map(warehouseId â†’ quantity)
 */
export async function fetchWarehouseStock(
  itemNos: string[],
  batchSize: number = 10,
  onProgress?: (done: number, total: number) => void
): Promise<WarehouseStockMap> {
  const stockMap: WarehouseStockMap = new Map();
  const total = itemNos.length;

  console.log(`[Accurate] Phase 3: Fetching warehouse stock for ${total} items (batch ${batchSize})...`);

  for (let i = 0; i < total; i += batchSize) {
    const batch = itemNos.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (itemNo) => {
        const whData = await fetchItemWarehouseStock(itemNo);
        return { itemNo, whData };
      })
    );

    batchResults.forEach(({ itemNo, whData }) => {
      const whMap = new Map<number, number>();
      whData.forEach(w => {
        if (w.quantity !== 0) {
          whMap.set(w.warehouseId, w.quantity);
        }
      });
      stockMap.set(itemNo, whMap);
    });

    if (onProgress) onProgress(Math.min(i + batchSize, total), total);
  }

  console.log(`[Accurate] Phase 3 done: warehouse stock for ${stockMap.size} items`);
  return stockMap;
}

/**
 * Save warehouse stock cache.
 */
export async function saveWarehouseStockCache(stockMap: WarehouseStockMap): Promise<void> {
  try {
    const data: CachedWarehouseStock['data'] = {};
    stockMap.forEach((whMap, itemNo) => {
      const whObj: Record<string, number> = {};
      whMap.forEach((qty, whId) => {
        whObj[String(whId)] = qty;
      });
      data[itemNo] = whObj;
    });

    const cached: CachedWarehouseStock = { timestamp: Date.now(), data };

    await prisma.dataCache.upsert({
      where: { key: WH_STOCK_CACHE_KEY },
      update: { data: cached as any },
      create: { key: WH_STOCK_CACHE_KEY, data: cached as any },
    });

    console.log(`[Cache] Warehouse stock cached (${stockMap.size} items) to DB`);
  } catch (err: any) {
    console.warn(`[Cache] Failed to save warehouse stock cache:`, err.message);
  }
}

/**
 * Load warehouse stock from cache.
 * Returns null if cache is stale or missing.
 */
export async function loadWarehouseStockCache(): Promise<WarehouseStockMap | null> {
  try {
    const cacheEntry = await prisma.dataCache.findUnique({
      where: { key: WH_STOCK_CACHE_KEY }
    });

    if (!cacheEntry || !cacheEntry.data) return null;

    const cached = cacheEntry.data as unknown as CachedWarehouseStock;
    const age = Date.now() - cached.timestamp;
    console.log(`[Cache] Warehouse stock cache is ${Math.round(age / 60000)} min old`);

    console.log(`[Cache] Using cached warehouse stock (${Math.round(age / 60000)} min old)`);
    const map: WarehouseStockMap = new Map();
    for (const [itemNo, whObj] of Object.entries(cached.data)) {
      const whMap = new Map<number, number>();
      for (const [whId, qty] of Object.entries(whObj)) {
        whMap.set(parseInt(whId), qty);
      }
      map.set(itemNo, whMap);
    }
    return map;
  } catch {
    return null;
  }
}

// â”€â”€â”€ PO OUTSTANDING (Phase 4) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * PO Outstanding = qty in Purchase Orders that have NOT been fully received.
 * We fetch POs with status Open/Partial, then aggregate outstanding qty per itemNo.
 */

export interface AccuratePOItem {
  item: {
    id: number;
    no: string;
    name: string;
  };
  quantity: number;          // ordered qty (Kts Pesanan)
  shipQuantity: number;      // received/processed qty (Kts Terproses)
  unitRatio: number;
  itemUnitName?: string;
}

export interface AccuratePO {
  id: number;
  number: string;
  transDate: string;
  branchId?: number;
  statusName?: string;       // "Open"/"Buka", "Partial"/"Sebagian", "Closed"/"Ditutup"
  detailItem?: AccuratePOItem[];
}

/** Outstanding qty per itemNo (in base unit / pcs) */
export type POOutstandingMap = Map<string, number>;

interface CachedPOOutstanding {
  timestamp: number;
  /** itemNo â†’ outstanding qty */
  data: Record<string, number>;
}

const PO_CACHE_KEY_PREFIX = 'po-outstanding-cache';

function getPOCacheKey(branchId?: number): string {
  return branchId ? `${PO_CACHE_KEY_PREFIX}-branch${branchId}` : PO_CACHE_KEY_PREFIX;
}

/**
 * Phase 4a: Fetch PO list â€” exclude "Ditutup"/"Closed" POs.
 * We fetch all POs and filter out closed ones, since Accurate may use
 * Indonesian (Buka/Sebagian/Ditutup) or English (Open/Partial/Closed) status names.
 */
async function fetchPOList(branchId?: number): Promise<{ id: number; transDate: string; branchId?: number; statusName?: string }[]> {
  const allPOs: { id: number; transDate: string; branchId?: number; statusName?: string }[] = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  // Status names to EXCLUDE (closed POs have no outstanding)
  const CLOSED_STATUSES = ['ditutup', 'closed', 'selesai', 'void', 'cancel', 'batal'];

  console.log(`[Accurate] PO Phase 1: Fetching PO list${branchId ? ` branch=${branchId}` : ''}...`);

  while (hasMore) {
    try {
      const params: Record<string, any> = {
        fields: 'id,transDate,branchId,statusName',
        'sp.page': page,
        'sp.pageSize': pageSize,
      };
      if (branchId) {
        params['filter.branchId.op'] = 'EQUAL';
        params['filter.branchId.val'] = branchId;
      }

      const response = await accurateClient.get('/purchase-order/list.do', { params });

      if (response.data?.s) {
        const list = response.data.d || [];
        if (list.length === 0) {
          hasMore = false;
        } else {
          // Log first page to debug status names
          if (page === 1 && list.length > 0) {
            const statusSample = list.slice(0, 5).map((po: any) => `${po.number}:${po.statusName}`);
            console.log(`[Accurate]   PO status samples: ${statusSample.join(', ')}`);
          }

          list.forEach((po: any) => {
            const status = (po.statusName || '').toLowerCase().trim();
            // Only include POs that are NOT closed
            if (!CLOSED_STATUSES.includes(status)) {
              allPOs.push({ id: po.id, transDate: po.transDate, branchId: po.branchId, statusName: po.statusName });
            }
          });
          if (page % 20 === 0) {
            console.log(`[Accurate]   PO page ${page}, collected ${allPOs.length} POs so far`);
          }
          page++;
          if (page > 200) {
            console.log(`[Accurate]   PO: Hit 200 pages, stopping at ${allPOs.length} POs`);
            hasMore = false;
          }
        }
      } else {
        console.warn('[Accurate] PO list API returned s=false:', response.data?.d);
        hasMore = false;
      }
    } catch (error: any) {
      console.error(`[Accurate] PO list page ${page} error:`, error.message);
      hasMore = false;
    }
  }

  console.log(`[Accurate] PO Phase 1 done: ${allPOs.length} outstanding POs (excluded closed)`);
  return allPOs;
}

/**
 * Phase 4b: Fetch detail for a single PO.
 */
async function fetchPODetail(poId: number, maxRetries: number = 3): Promise<AccuratePO | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await accurateClient.get('/purchase-order/detail.do', {
        params: { id: poId }
      });

      if (response.data?.s && response.data.d) {
        const d = response.data.d;
        return {
          id: d.id,
          number: d.number,
          transDate: d.transDate,
          branchId: d.branchId || undefined,
          statusName: d.statusName || '',
          detailItem: d.detailItem?.map((di: any) => ({
            item: di.item ? { id: di.item.id, no: di.item.no, name: di.item.name } : { id: 0, no: '', name: '' },
            quantity: di.quantity || 0,
            // Accurate uses "shipQuantity" for received/processed qty (Kts Terproses)
            shipQuantity: di.shipQuantity ?? di.quantityReceived ?? 0,
            unitRatio: di.unitRatio || 1,
            itemUnitName: di.itemUnitName || di.unitName || '',
          })) || []
        };
      }
      return null;
    } catch (err: any) {
      if (attempt < maxRetries) {
        const delay = 1000 * attempt;
        console.warn(`[Accurate] PO ${poId} fetch failed (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`[Accurate] PO ${poId} FAILED after ${maxRetries} attempts: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

/**
 * Process POs in parallel batches.
 */
async function fetchPODetailsInBatch(
  poIds: number[],
  batchSize: number = 15,
  onProgress?: (done: number, total: number) => void
): Promise<AccuratePO[]> {
  const results: AccuratePO[] = [];
  const failedIds: number[] = [];
  const total = poIds.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = poIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(id => fetchPODetail(id))
    );
    batch.forEach((id, idx) => {
      if (batchResults[idx]) {
        results.push(batchResults[idx]!);
      } else {
        failedIds.push(id);
      }
    });
    if (onProgress) onProgress(Math.min(i + batchSize, total), total);
  }

  // Retry failed
  if (failedIds.length > 0) {
    console.warn(`[Accurate] ${failedIds.length} POs failed. Retrying...`);
    for (const id of failedIds) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const result = await fetchPODetail(id, 3);
      if (result) results.push(result);
    }
  }

  return results;
}

/**
 * Aggregate outstanding qty per itemNo from PO details.
 * Formula from Accurate: Outstanding = quantity - shipQuantity
 * If PO status is "Ditutup" (Closed), outstanding = 0
 *
 * Returns: combined map + per-branch maps (for auto-splitting)
 */
function aggregatePOOutstanding(pos: AccuratePO[]): {
  combined: POOutstandingMap;
  perBranch: Map<number, POOutstandingMap>;
} {
  const combined: POOutstandingMap = new Map();
  const perBranch = new Map<number, POOutstandingMap>();
  const CLOSED_STATUSES = ['ditutup', 'closed', 'selesai', 'void', 'cancel', 'batal'];

  pos.forEach(po => {
    // Skip closed POs entirely (double check)
    const poStatus = (po.statusName || '').toLowerCase().trim();
    if (CLOSED_STATUSES.includes(poStatus)) return;

    const poBranchId = po.branchId;

    if (po.detailItem) {
      po.detailItem.forEach(d => {
        const itemNo = d.item?.no;
        if (!itemNo) return;

        // Outstanding = Kts Pesanan - Kts Terproses (quantity - shipQuantity)
        const outstanding = Math.max(0, d.quantity - d.shipQuantity);

        if (outstanding > 0) {
          // Add to combined map
          combined.set(itemNo, (combined.get(itemNo) || 0) + outstanding);

          // Add to per-branch map
          if (poBranchId) {
            if (!perBranch.has(poBranchId)) {
              perBranch.set(poBranchId, new Map());
            }
            const branchMap = perBranch.get(poBranchId)!;
            branchMap.set(itemNo, (branchMap.get(itemNo) || 0) + outstanding);
          }
        }
      });
    }
  });

  return { combined, perBranch };
}

/**
 * Save PO outstanding cache to DB.
 */
export async function savePOCache(poMap: POOutstandingMap, branchId?: number): Promise<void> {
  try {
    const data: Record<string, number> = {};
    poMap.forEach((qty, itemNo) => {
      data[itemNo] = qty;
    });

    const cached: CachedPOOutstanding = { timestamp: Date.now(), data };
    const key = getPOCacheKey(branchId);

    await prisma.dataCache.upsert({
      where: { key },
      update: { data: cached as any },
      create: { key, data: cached as any },
    });

    console.log(`[Cache] PO outstanding saved (${poMap.size} items) key: ${key}`);
  } catch (err: any) {
    console.warn(`[Cache] Failed to save PO cache:`, err.message);
  }
}

/**
 * Load PO outstanding cache from DB.
 */
export async function loadPOCache(branchId?: number): Promise<POOutstandingMap | null> {
  try {
    const key = getPOCacheKey(branchId);
    const cacheEntry = await prisma.dataCache.findUnique({ where: { key } });

    if (!cacheEntry || !cacheEntry.data) {
      console.log(`[Cache] No PO outstanding cache found${branchId ? ` (branch ${branchId})` : ''}`);
      return null;
    }

    const cached = cacheEntry.data as unknown as CachedPOOutstanding;
    const age = Date.now() - cached.timestamp;
    console.log(`[Cache] PO outstanding cache is ${Math.round(age / 60000)} min old`);

    const map: POOutstandingMap = new Map();
    for (const [itemNo, qty] of Object.entries(cached.data)) {
      map.set(itemNo, qty);
    }
    return map;
  } catch (err: any) {
    console.warn(`[Cache] PO cache load error:`, err.message);
    return null;
  }
}

/**
 * Main entry: Fetch all PO outstanding data with caching.
 * Returns a Map of itemNo â†’ outstanding qty (pcs).
 * When syncing all branches, also auto-saves per-branch PO caches.
 */
export async function fetchAllPOOutstanding(
  force: boolean = false,
  branchId?: number,
  onProgress?: (done: number, total: number) => void
): Promise<{ poMap: POOutstandingMap; poCount: number }> {
  // Try cache first
  if (!force) {
    const cached = await loadPOCache(branchId);
    if (cached) {
      return { poMap: cached, poCount: -1 };
    }
  }

  // Phase 1: List POs (Open/Partial)
  const poList = await fetchPOList(branchId);

  if (poList.length === 0) {
    console.log('[Accurate] No outstanding POs found');
    const emptyMap: POOutstandingMap = new Map();
    await savePOCache(emptyMap, branchId);
    return { poMap: emptyMap, poCount: 0 };
  }

  // Phase 2: Fetch details
  const poIds = poList.map(po => po.id);
  console.log(`[Accurate] PO Phase 2: Fetching detail for ${poIds.length} POs...`);

  const pos = await fetchPODetailsInBatch(poIds, 15, (done, total) => {
    if (onProgress) onProgress(done, total);
    syncProgress.done = done;
    syncProgress.total = total;
    syncProgress.message = `PO Outstanding: ${done}/${total} PO`;
  });

  // Phase 3: Aggregate (now returns combined + per-branch)
  const { combined: poMap, perBranch } = aggregatePOOutstanding(pos);
  console.log(`[Accurate] PO done: ${poMap.size} items with outstanding qty from ${pos.length} POs`);

  // Cache â€” main (combined)
  await savePOCache(poMap, branchId);

  // Auto-split per-branch caches (only when syncing all branches)
  if (!branchId && perBranch.size > 0) {
    console.log(`[Accurate] PO: Auto-splitting cache for ${perBranch.size} branches...`);
    for (const [brId, brMap] of perBranch) {
      await savePOCache(brMap, brId);
      console.log(`[Accurate]   PO Branch ${brId}: ${brMap.size} items cached`);
    }
  }

  return { poMap, poCount: pos.length };
}

// ─── DELIVERY ORDER STATUS (for SO Kontrol) ─────────────────────────────────

/**
 * Fetch DO status map for SOs.
 * Reuses existing fetchDOList (SLA version) and fetchDODetail (SLA version).
 * Returns Map<soId, deliveryStatusName>
 * If a SO has multiple DOs, takes the status of the latest DO (by transDate).
 */
export async function fetchDOStatusForSOs(
  fromDate?: string,
  toDate?: string,
  branchId?: number,
  onProgress?: (done: number, total: number) => void
): Promise<Map<number, string>> {
  // Phase 1: Get all DO list using the existing SLA fetchDOList (which handles caching)
  const doList = await fetchDOList(undefined, undefined, branchId, true);

  if (doList.length === 0) {
    console.log('[Accurate] No DOs found — all SOs will have "Belum dikirim"');
    return new Map();
  }

  // Phase 1b: Filter DOs client-side by date range (since DO API doesn't support date filters)
  let filteredDOs = doList;
  if (fromDate || toDate) {
    const fromDateParsed = fromDate ? parseAccurateDate(fromDate) : null;
    const toDateParsed = toDate ? parseAccurateDate(toDate) : null;

    filteredDOs = doList.filter(doItem => {
      const doDate = parseAccurateDate(doItem.transDate);
      if (fromDateParsed && doDate < fromDateParsed) return false;
      if (toDateParsed && doDate > toDateParsed) return false;
      return true;
    });
    console.log(`[Accurate] DO: Filtered ${doList.length} → ${filteredDOs.length} DOs by date range`);
  }

  if (filteredDOs.length === 0) {
    console.log('[Accurate] No DOs in date range');
    return new Map();
  }

  // Phase 2: Fetch DO details directly to get salesOrderId
  console.log(`[Accurate] DO Phase 2: Fetching detail for ${filteredDOs.length} DOs to map to SOs...`);
  const soIdMap = new Map<number, string>();
  const soDoMap = new Map<number, { statusName: string; transDate: string }>();
  const total = filteredDOs.length;
  const BATCH_SIZE = 15;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = filteredDOs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (doItem) => {
      try {
        const response = await accurateClient.get('/delivery-order/detail.do', {
          params: { id: doItem.id }
        });
        if (response.data?.s && response.data.d) {
          const d = response.data.d;
          const salesOrderIds = new Set<number>();
          if (Array.isArray(d.detailItem)) {
            d.detailItem.forEach((di: any) => {
              if (di.salesOrderId) salesOrderIds.add(di.salesOrderId);
            });
          }
          return {
            salesOrderIds: Array.from(salesOrderIds),
            statusName: doItem.statusName || d.statusName || '',
            transDate: doItem.transDate || d.transDate || '',
          };
        }
        return null;
      } catch (err: any) {
        console.warn(`[Accurate] DO ${doItem.id} detail fetch error: ${err.message}`);
        return null;
      }
    }));

    batchResults.forEach(result => {
      if (!result) return;
      result.salesOrderIds.forEach(soId => {
        const existing = soIdMap.get(soId);
        const existingEntry = existing ? soDoMap.get(soId) : null;
        if (!existingEntry) {
          soDoMap.set(soId, { statusName: result.statusName, transDate: result.transDate });
          soIdMap.set(soId, result.statusName);
        } else {
          const existingDate = parseAccurateDate(existingEntry.transDate);
          const newDate = parseAccurateDate(result.transDate);
          if (newDate >= existingDate) {
            soDoMap.set(soId, { statusName: result.statusName, transDate: result.transDate });
            soIdMap.set(soId, result.statusName);
          }
        }
      });
    });

    const processed = Math.min(i + BATCH_SIZE, total);
    if (onProgress) onProgress(processed, total);
  }

  console.log(`[Accurate] DO mapping done: ${soIdMap.size} SOs have delivery status from ${filteredDOs.length} DOs`);
  return soIdMap;
}

// â”€â”€â”€ SO OUTSTANDING (Kontrol SO) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SO_CACHE_KEY = 'so-outstanding-cache';

interface CachedSOData {
  timestamp: number;
  data: SOData[];
}

/**
 * Fetch SO list from Accurate. Excludes Draf & Ditutup.
 * Supports optional date range and status filters.
 * Uses smart early-exit when filtering by status to avoid paginating all 40K+ records.
 */
async function fetchSOList(branchId?: number, fromDate?: string, toDate?: string, statuses?: string[]): Promise<{ id: number; number: string; transDate: string; branchId?: number; statusName?: string; customerName?: string }[]> {
  const allSOs: { id: number; number: string; transDate: string; branchId?: number; statusName?: string; customerName?: string }[] = [];
  let page = 1;
  const pageSize = 200; // Larger pages = fewer API calls
  let hasMore = true;

  const EXCLUDE_STATUSES = ['draf', 'draft', 'ditutup', 'closed', 'void', 'batal'];
  const includeStatuses = statuses?.map(s => s.toLowerCase().trim()) || [];
  const isStatusFiltered = includeStatuses.length > 0;

  // Parse date range for client-side filtering (API doesn't reliably support transDate filter)
  const fromDateParsed = fromDate ? parseAccurateDate(fromDate) : null;
  const toDateParsed = toDate ? parseAccurateDate(toDate) : null;

  // Smart early-exit: when filtering by status, stop after N consecutive pages with 0 matches
  let consecutiveEmptyPages = 0;
  const MAX_EMPTY_PAGES = 30; // Stop after 30 pages (6000 SOs) with no matches
  const MAX_PAGES = 500; // Absolute maximum

  console.log(`[Accurate] SO: Fetching SO list${branchId ? ` branch=${branchId}` : ''}${fromDate ? ` from=${fromDate}` : ''}${toDate ? ` to=${toDate}` : ''}${isStatusFiltered ? ` statuses=[${includeStatuses.join(',')}]` : ''}...`);

  while (hasMore) {
    try {
      const params: Record<string, any> = {
        fields: 'id,number,transDate,branchId,statusName,customerName',
        'sp.page': page,
        'sp.pageSize': pageSize,
        'sp.sort': 'transDate|desc' // IMPORTANT to allow early-exit on dates
      };
      if (branchId) {
        params['filter.branchId.op'] = 'EQUAL';
        params['filter.branchId.val'] = branchId;
      }

      const response = await accurateClient.get('/sales-order/list.do', { params });

      if (response.data?.s) {
        const list = response.data.d || [];
        if (list.length === 0) {
          hasMore = false;
        } else {
          let matchesInPage = 0;
          let datesOlderThanFromDate = 0;

          list.forEach((so: any) => {
            const status = (so.statusName || '').toLowerCase().trim();
            if (EXCLUDE_STATUSES.includes(status)) return;
            // If statuses filter is specified, only include matching ones
            if (isStatusFiltered && !includeStatuses.includes(status)) return;

            // Client-side date filtering
            if (fromDateParsed || toDateParsed) {
              const soDate = parseAccurateDate(so.transDate);
              // Since it's sorted transDate|desc, if we hit a date older than fromDateParsed,
              // we can keep a count to potentially stop fetching.
              if (fromDateParsed && soDate < fromDateParsed) {
                 datesOlderThanFromDate++;
                 return;
              }
              if (toDateParsed && soDate > toDateParsed) return;
            }

            matchesInPage++;
            allSOs.push({
              id: so.id,
              number: so.number,
              transDate: so.transDate,
              branchId: so.branchId,
              statusName: so.statusName,
              customerName: so.customerName,
            });
          });

          // Early-exit logic: 
          // 1. If we are sorting by transDate|desc and a significant portion of this page is older than fromDate, stop.
          if (fromDateParsed && datesOlderThanFromDate > (list.length * 0.5)) {
             console.log(`[Accurate] SO: Stopping at page ${page} because mostly older dates encountered (${datesOlderThanFromDate}/${list.length})`);
             hasMore = false;
          }

          // 2. Early exit based on consecutive empty matches (useful for both status and date)
          if (matchesInPage === 0) {
            consecutiveEmptyPages++;
            if (consecutiveEmptyPages >= MAX_EMPTY_PAGES) {
              console.log(`[Accurate] SO: ${MAX_EMPTY_PAGES} consecutive pages with 0 matches, stopping at page ${page} (${allSOs.length} SOs found)`);
              hasMore = false;
            }
          } else {
            consecutiveEmptyPages = 0;
          }

          // Log progress every 50 pages
          if (page % 50 === 0) {
            console.log(`[Accurate] SO: Page ${page}, ${allSOs.length} matching SOs so far...`);
          }

          page++;
          if (page > MAX_PAGES) {
            console.log(`[Accurate] SO: Hit ${MAX_PAGES} pages, stopping at ${allSOs.length} SOs`);
            hasMore = false;
          }
        }
      } else {
        console.warn('[Accurate] SO list API returned s=false:', response.data?.d);
        hasMore = false;
      }
    } catch (error: any) {
      console.error(`[Accurate] SO list page ${page} error:`, error.message);
      hasMore = false;
    }
  }

  console.log(`[Accurate] SO list done: ${allSOs.length} SOs found in ${page - 1} pages`);
  return allSOs;
}

/**
 * Fetch detail for a single SO with retry.
 */
async function fetchSODetail(soId: number, maxRetries = 3): Promise<SOData | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await accurateClient.get('/sales-order/detail.do', {
        params: { id: soId }
      });

      if (response.data?.s && response.data.d) {
        const d = response.data.d;
        const detailItems: SODetailItem[] = (d.detailItem || []).map((di: any, idx: number) => {
          const qty = di.quantity || 0;
          const shipped = di.shipQuantity ?? 0;
          // Try every possible unit field from Accurate API
          const resolvedUnit =
            di.itemUnit?.name ||
            di.itemUnit?.unitName ||
            di.unit?.name ||
            di.itemUnitName ||
            di.unitName ||
            di.item?.unit2Name ||
            di.item?.unitName ||
            '';
          // Debug: log first 2 items of first few SOs
          if (idx < 2) {
            console.log(`[SO Debug] ${d.number} item[${idx}]: resolvedUnit="${resolvedUnit}" | itemUnit=${JSON.stringify(di.itemUnit)} | itemUnitName=${di.itemUnitName} | unitName=${di.unitName} | unit=${JSON.stringify(di.unit)} | item.unit2Name=${di.item?.unit2Name}`);
          }
          return {
            itemNo: di.item?.no || '',
            itemName: di.item?.name || '',
            quantity: qty,
            shipQuantity: shipped,
            outstanding: Math.max(0, qty - shipped),
            unitName: resolvedUnit,
            unitPrice: di.unitPrice || 0,
            totalPrice: di.totalPrice || 0,
          };
        });

        const totalOutstanding = detailItems.reduce((sum, i) => sum + i.outstanding, 0);

        return {
          id: d.id,
          soNumber: d.number,
          transDate: d.transDate,
          customerName: d.customerName || d.customer?.name || '',
          customerNo: d.customer?.no || d.customerNo || '',
          branchId: d.branchId || undefined,
          statusName: d.statusName || '',
          detailItems,
          totalOutstanding,
        };
      }
      return null;
    } catch (err: any) {
      if (attempt < maxRetries) {
        const delay = 1000 * attempt;
        console.warn(`[Accurate] SO ${soId} fetch failed (attempt ${attempt}): ${err.message}. Retrying...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`[Accurate] SO ${soId} FAILED after ${maxRetries} attempts: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

/**
 * Fetch SO details in parallel batches.
 */
async function fetchSODetailsInBatch(
  soIds: number[],
  batchSize = 5, // smaller batch size to avoid 429
  onProgress?: (done: number, total: number) => void
): Promise<SOData[]> {
  const results: SOData[] = [];
  const total = soIds.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = soIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(id => fetchSODetail(id, 3)));
    batchResults.forEach(r => { if (r) results.push(r); });
    if (onProgress) onProgress(Math.min(i + batchSize, total), total);
    
    // Add sleep to prevent Accurate HTTP 429 Too Many Requests
    if (i + batchSize < total) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  return results;
}

/**
 * Save SO cache to DB.
 */
export async function saveSOCache(soData: SOData[]): Promise<void> {
  try {
    const cached: CachedSOData = { timestamp: Date.now(), data: soData };
    await prisma.dataCache.upsert({
      where: { key: SO_CACHE_KEY },
      update: { data: cached as any },
      create: { key: SO_CACHE_KEY, data: cached as any },
    });
    console.log(`[Cache] SO data saved (${soData.length} SOs)`);
  } catch (err: any) {
    console.warn(`[Cache] Failed to save SO cache:`, err.message);
  }
}

/**
 * Load SO cache from DB.
 */
export async function loadSOCache(): Promise<SOData[] | null> {
  try {
    const cacheEntry = await prisma.dataCache.findUnique({ where: { key: SO_CACHE_KEY } });
    if (!cacheEntry || !cacheEntry.data) {
      console.log('[Cache] No SO cache found');
      return null;
    }
    const cached = cacheEntry.data as unknown as CachedSOData;
    const age = Date.now() - cached.timestamp;
    console.log(`[Cache] SO cache is ${Math.round(age / 60000)} min old, ${cached.data.length} SOs`);
    return cached.data;
  } catch (err: any) {
    console.warn('[Cache] SO cache load error:', err.message);
    return null;
  }
}

/**
 * Main entry: Fetch all outstanding SO data.
 * Returns an array of SOData with detail items.
 */
export async function fetchAllSOData(
  force: boolean = false,
  branchId?: number,
  fromDate?: string,
  toDate?: string,
  statuses?: string[],
  onProgress?: (done: number, total: number) => void
): Promise<{ soList: SOData[]; soCount: number }> {
  // Try cache first (only if not force and no specific filters)
  if (!force) {
    const cached = await loadSOCache();
    if (cached) {
      return { soList: cached, soCount: -1 };
    }
  }

  // Default date range: 3 months back if not specified
  if (!fromDate) {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    fromDate = `${String(threeMonthsAgo.getDate()).padStart(2, '0')}/${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}/${threeMonthsAgo.getFullYear()}`;
    console.log(`[Accurate] SO: No fromDate specified, defaulting to 3 months ago: ${fromDate}`);
  }

  // Phase 1: List SOs (status filter applied here = fewer detail fetches)
  const soListRaw = await fetchSOList(branchId, fromDate, toDate, statuses);

  if (soListRaw.length === 0) {
    console.log('[Accurate] No outstanding SOs found');
    await saveSOCache([]);
    return { soList: [], soCount: 0 };
  }

  // Phase 2: Fetch SO details
  const soIds = soListRaw.map(so => so.id);
  console.log(`[Accurate] SO Phase 2: Fetching detail for ${soIds.length} SOs...`);

  const soData = await fetchSODetailsInBatch(soIds, 15, (done, total) => {
    if (onProgress) onProgress(done, total * 2); // *2 because DO phase follows
  });

  console.log(`[Accurate] SO Phase 2 done: ${soData.length} SOs fetched with detail`);

  // Phase 3: Fetch DO status and map to SOs
  console.log(`[Accurate] SO Phase 3: Fetching Delivery Order status...`);
  try {
    const doStatusMap = await fetchDOStatusForSOs(fromDate, toDate, branchId, (done, total) => {
      if (onProgress) onProgress(soData.length + done, soData.length + total);
    });

    // Apply delivery status to each SO
    soData.forEach(so => {
      so.deliveryStatus = doStatusMap.get(so.id) || 'Belum dikirim';
    });

    console.log(`[Accurate] SO Phase 3 done: ${doStatusMap.size} SOs mapped with delivery status`);
  } catch (err: any) {
    console.warn(`[Accurate] DO status fetch failed (non-critical): ${err.message}`);
    // Set all to 'Belum dikirim' on failure
    soData.forEach(so => { so.deliveryStatus = so.deliveryStatus || 'Belum dikirim'; });
  }

  // Cache
  await saveSOCache(soData);

  return { soList: soData, soCount: soData.length };
}

// ─── SLA SO Cache (Lightweight list of ALL SOs for SLA Dashboard) ───

const SLA_SO_CACHE_KEY = 'sla-so-list-cache';
const SLA_SO_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface SOSimpleItem {
  id: number;
  number: string;
  transDate: string;
  branchId?: number;
  statusName: string;
  customerName: string;
}

export async function loadSLASOCache(force = false): Promise<SOSimpleItem[]> {
  // Try cache first
  if (!force) {
    try {
      const cacheEntry = await prisma.dataCache.findUnique({ where: { key: SLA_SO_CACHE_KEY } });
      if (cacheEntry?.data) {
        const cached = cacheEntry.data as any;
        const age = Date.now() - (cached.timestamp || 0);
        if (age < SLA_SO_CACHE_TTL_MS && Array.isArray(cached.data)) {
          console.log(`[Cache] SLA SO list loaded (${cached.data.length} entries, ${Math.round(age / 60000)}m old)`);
          return cached.data as SOSimpleItem[];
        }
      }
    } catch (err: any) {
      console.warn('[Cache] SLA SO list load error:', err.message);
    }
  }

  // Fetch from Accurate API (no status filter to get all history)
  console.log('[Accurate] SLA: Fetching simplified SO list for SLA...');
  // We only fetch SOs from 2025 onwards to limit data size
  const fromDate = '01/01/2025';

  const allSOs: SOSimpleItem[] = [];
  let page = 1;
  const pageSize = 200;
  let hasMore = true;
  const EXCLUDE_STATUSES = ['draf', 'draft', 'ditutup', 'closed', 'void', 'batal'];

  while (hasMore) {
    try {
      const params: Record<string, any> = {
        fields: 'id,number,transDate,branchId,statusName,customer.name',
        'sp.page': page,
        'sp.pageSize': pageSize
      };

      const response = await accurateClient.get('/sales-order/list.do', { params });

      if (response.data?.s) {
        const list = response.data.d || [];
        if (list.length === 0) {
          hasMore = false;
        } else {
          list.forEach((so: any) => {
            const status = (so.statusName || '').toLowerCase().trim();
            if (EXCLUDE_STATUSES.includes(status)) return;
            allSOs.push({
              id: so.id,
              number: so.number,
              transDate: so.transDate,
              branchId: so.branchId,
              statusName: so.statusName,
              customerName: so.customer?.name || so.customerName || 'Unknown',
            });
          });
          if (page % 10 === 0) console.log(`[Accurate] SLA SO: Page ${page}, ${allSOs.length} SOs so far...`);
          page++;
          // Hard limit to prevent infinite loops (about 20,000 SOs max)
          if (page > 100) hasMore = false;
        }
      } else {
        console.error('[Accurate] SLA SO list API error on page', page, ':', response.data?.d);
        hasMore = false;
      }
    } catch (err: any) {
      console.error(`[Accurate] SLA SO list fetch error (page ${page}):`, err.message);
      hasMore = false;
    }
  }

  console.log(`[Accurate] SLA SO list complete: ${allSOs.length} items fetched.`);

  // Save to cache
  if (allSOs.length > 0) {
    try {
      await prisma.dataCache.upsert({
        where: { key: SLA_SO_CACHE_KEY },
        update: { data: { timestamp: Date.now(), data: allSOs } as any },
        create: { key: SLA_SO_CACHE_KEY, data: { timestamp: Date.now(), data: allSOs } as any },
      });
    } catch (err: any) {
      console.warn('[Cache] SLA SO list save error:', err.message);
    }
  }

  return allSOs;
}


// ─── Customer City Map ────────────────────────────────────────────────────────

export interface CustomerCity {
  city: string;
  province: string;
  address: string;  // billAddress.address (full address)
}

const CUSTOMER_CITY_CACHE_KEY = 'customer_city_map_v2'; // v2: uses billAddress
const CUSTOMER_CITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Fetch customer name → city/province mapping from Accurate.
 * Uses DataCache with 6-hour TTL. Pass force=true to refresh.
 */
export async function fetchCustomerCityMap(force = false): Promise<Map<string, CustomerCity>> {
  // Try cache
  if (!force) {
    try {
      const cacheEntry = await prisma.dataCache.findUnique({ where: { key: CUSTOMER_CITY_CACHE_KEY } });
      if (cacheEntry?.data) {
        const cached = cacheEntry.data as any;
        const age = Date.now() - (cached.timestamp || 0);
        if (age < CUSTOMER_CITY_CACHE_TTL_MS) {
          const map = new Map<string, CustomerCity>();
          Object.entries(cached.data || {}).forEach(([name, val]) => map.set(name, val as CustomerCity));
          console.log(`[Cache] Customer city map loaded (${map.size} entries, ${Math.round(age / 60000)}m old)`);
          return map;
        }
      }
    } catch (err: any) {
      console.warn('[Cache] Customer city map load error:', err.message);
    }
  }

  // Fetch from Accurate
  const map = new Map<string, CustomerCity>();
  let page = 1;
  const pageSize = 200;
  let hasMore = true;

  console.log('[Accurate] Fetching customer city/province data...');

  while (hasMore) {
    try {
      const response = await accurateClient.get('/customer/list.do', {
        params: {
          fields: 'id,name,billAddress',
          'sp.page': page,
          'sp.pageSize': pageSize,
        }
      });
      if (response.data?.s) {
        const customers: {
          name: string;
          billAddress?: {
            city?: string;
            province?: string;
            address?: string;
            street?: string;
          };
        }[] = response.data.d || [];

        customers.forEach(c => {
          const bill = c.billAddress;
          if (c.name && bill && (bill.city || bill.province)) {
            map.set(c.name.trim(), {
              city: (bill.city || '').trim(),
              province: (bill.province || '').trim(),
              address: (bill.address || bill.street || '').trim(),
            });
          }
        });
        hasMore = response.data.sp?.pageCount > page;
        page++;
      } else {
        hasMore = false;
      }
    } catch (err: any) {
      console.error('[Accurate] Customer city fetch error:', err.message);
      hasMore = false;
    }
  }

  console.log(`[Accurate] Customer city map fetched: ${map.size} customers with city data`);

  // Save cache
  try {
    const cacheData = { timestamp: Date.now(), data: Object.fromEntries(map) };
    await prisma.dataCache.upsert({
      where: { key: CUSTOMER_CITY_CACHE_KEY },
      update: { data: cacheData as any },
      create: { key: CUSTOMER_CITY_CACHE_KEY, data: cacheData as any },
    });
  } catch (err: any) {
    console.warn('[Cache] Failed to save customer city map:', err.message);
  }

  return map;
}


// --- Item Unit Conversion Map ---

export interface ItemUnitInfo {
  unitConversion: number;  // how many baseUnit per salesUnit (ratio2)
  salesUnitName: string;   // e.g. 'Box', 'Karung', 'Sak'
  baseUnitName: string;    // e.g. 'Pcs'
}

const ITEM_UNIT_CACHE_KEY = 'item-unit-map-v1';
const ITEM_UNIT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch itemNo -> { unitConversion, salesUnitName, baseUnitName }
 * from Accurate /item/list.do using unit2Name + ratio2 fields.
 * ratio2 = how many unit1(base) per unit2(sales): 1 Box = ratio2 Pcs
 * Cached in DataCache for 24h. First call fetches from API.
 */
export async function fetchItemUnitMap(force = false): Promise<Map<string, ItemUnitInfo>> {
  const result = new Map<string, ItemUnitInfo>();

  // Try cache
  if (!force) {
    try {
      const cached = await prisma.dataCache.findUnique({ where: { key: ITEM_UNIT_CACHE_KEY } });
      if (cached?.data) {
        const c = cached.data as any;
        const age = Date.now() - (c.timestamp || 0);
        if (age < ITEM_UNIT_CACHE_TTL_MS) {
          for (const [itemNo, entry] of Object.entries(c.data || {})) {
            result.set(itemNo, entry as ItemUnitInfo);
          }
          console.log('[ItemUnitMap] Loaded ' + result.size + ' items from cache (' + Math.round(age / 3600000) + 'h old)');
          return result;
        }
      }
    } catch { }
  }

  // Fetch from Accurate
  console.log('[ItemUnitMap] Fetching item unit data from Accurate...');
  let page = 1;
  const pageSize = 200;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await accurateClient.get('/item/list.do', {
        params: { fields: 'id,no,unit1Name,unit2Name,ratio2', 'sp.page': page, 'sp.pageSize': pageSize }
      });
      if (response.data?.s) {
        const items: { no: string; unit1Name?: string; unit2Name?: string; ratio2?: number }[] = response.data.d || [];
        for (const item of items) {
          if (item.no && item.unit2Name && item.ratio2 && item.ratio2 > 1) {
            result.set(item.no, {
              unitConversion: item.ratio2,
              salesUnitName: item.unit2Name,
              baseUnitName: item.unit1Name || 'Pcs',
            });
          }
        }
        hasMore = (response.data.sp?.pageCount || 1) > page;
        page++;
      } else { hasMore = false; }
    } catch (err: any) {
      console.error('[ItemUnitMap] Fetch error:', err.message);
      hasMore = false;
    }
  }

  console.log('[ItemUnitMap] Fetched ' + result.size + ' items with unit2 from Accurate');

  // Save cache
  try {
    const cacheData = { timestamp: Date.now(), data: Object.fromEntries(result) } as any;
    await prisma.dataCache.upsert({
      where: { key: ITEM_UNIT_CACHE_KEY },
      update: { data: cacheData },
      create: { key: ITEM_UNIT_CACHE_KEY, data: cacheData },
    });
  } catch (err: any) { console.warn('[ItemUnitMap] Cache save failed:', err.message); }

  return result;
}


// ─── DELIVERY ORDER (SLA Pengiriman) ────────────────────────────

const DO_CACHE_KEY = 'do-list-cache';
const DO_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface DOListItem {
  id: number;
  number: string;
  transDate: string;        // dd/mm/yyyy
  branchId?: number;
  customerName: string;
  statusName?: string;
}

interface CachedDOData {
  timestamp: number;
  fromDate: string;
  toDate: string;
  data: DOListItem[];
}

/**
 * Fetch Delivery Order list from Accurate.
 * Uses /delivery-order/list.do API.
 */
export async function fetchDOList(
  fromDate?: string,    // dd/mm/yyyy
  toDate?: string,      // dd/mm/yyyy
  branchId?: number,
  forceRefresh = false,
): Promise<DOListItem[]> {
  const cacheKey = `${DO_CACHE_KEY}${branchId ? '-b' + branchId : ''}`;

  // Try cache first
  if (!forceRefresh) {
    try {
      const cached = await prisma.dataCache.findUnique({ where: { key: cacheKey } });
      if (cached?.data) {
        const c = cached.data as unknown as CachedDOData;
        const age = Date.now() - (c.timestamp || 0);
        if (age < DO_CACHE_TTL_MS && c.data?.length > 0) {
          console.log(`[DO Cache] Using cached DO data (${Math.round(age / 60000)} min old, ${c.data.length} DOs)`);
          return c.data;
        }
      }
    } catch { }
  }

  // Fetch from Accurate API
  console.log(`[Accurate] DO: Fetching DO list${branchId ? ` branch=${branchId}` : ''}${fromDate ? ` from=${fromDate}` : ''}${toDate ? ` to=${toDate}` : ''}...`);

  const allDOs: DOListItem[] = [];
  let page = 1;
  const pageSize = 200;
  let hasMore = true;
  const MAX_PAGES = 300;

  while (hasMore) {
    try {
      const params: Record<string, any> = {
        fields: 'id,number,transDate,branchId,customerName,statusName',
        'sp.page': page,
        'sp.pageSize': pageSize,
      };
      if (branchId) {
        params['filter.branchId.op'] = 'EQUAL';
        params['filter.branchId.val'] = branchId;
      }
      // NOTE: DO API does not support filter.transDate.op (returns error)
      // Date filtering is done client-side in the SLA route

      const response = await accurateClient.get('/delivery-order/list.do', { params });

      if (response.data?.s) {
        const list = response.data.d || [];
        if (list.length === 0) {
          hasMore = false;
        } else {
          list.forEach((doItem: any) => {
            allDOs.push({
              id: doItem.id,
              number: doItem.number,
              transDate: doItem.transDate,
              branchId: doItem.branchId,
              customerName: doItem.customerName || '',
              statusName: doItem.statusName || '',
            });
          });
          if (page % 20 === 0) {
            console.log(`[Accurate] DO: Page ${page}, ${allDOs.length} DOs so far...`);
          }
          page++;
          if (page > MAX_PAGES) {
            console.log(`[Accurate] DO: Hit ${MAX_PAGES} pages, stopping at ${allDOs.length} DOs`);
            hasMore = false;
          }
        }
      } else {
        console.warn('[Accurate] DO list API returned s=false:', response.data?.d);
        hasMore = false;
      }
    } catch (error: any) {
      console.error(`[Accurate] DO list page ${page} error:`, error.message);
      hasMore = false;
    }
  }

  console.log(`[Accurate] DO list done: ${allDOs.length} DOs found in ${page - 1} pages`);

  // Save cache
  try {
    const cacheData: CachedDOData = {
      timestamp: Date.now(),
      fromDate: fromDate || '',
      toDate: toDate || '',
      data: allDOs,
    };
    await prisma.dataCache.upsert({
      where: { key: cacheKey },
      update: { data: cacheData as any },
      create: { key: cacheKey, data: cacheData as any },
    });
    console.log(`[DO Cache] Saved ${allDOs.length} DOs to cache`);
  } catch (err: any) {
    console.warn(`[DO Cache] Save failed:`, err.message);
  }

  return allDOs;
}

/**
 * Fetch DO detail to get related SO number.
 * Uses /delivery-order/detail.do API.
 */
export async function fetchDODetail(doId: number, maxRetries = 3): Promise<{ soNumber: string; doNumber: string; doDate: string; customerName: string; branchId?: number } | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await accurateClient.get('/delivery-order/detail.do', {
        params: { id: doId }
      });

      if (response.data?.s && response.data.d) {
        const d = response.data.d;
        // Try to extract SO number from detail
        const soNumber = d.salesOrderNumber || d.soNumber ||
          (d.detailItem?.[0]?.salesOrder?.number) ||
          (d.detailItem?.[0]?.salesOrderNumber) || '';

        return {
          soNumber,
          doNumber: d.number || '',
          doDate: d.transDate || '',
          customerName: d.customerName || d.customer?.name || '',
          branchId: d.branchId,
        };
      }
      return null;
    } catch (err: any) {
      if (attempt < maxRetries) {
        const delay = 1000 * attempt;
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`[Accurate] DO ${doId} FAILED after ${maxRetries} attempts: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

/**
 * Fetch DO details in batches to get SO numbers.
 * Similar to fetchSODetailsInBatch.
 */
export async function fetchDODetailsInBatch(
  doIds: number[],
  batchSize = 15,
  onProgress?: (done: number, total: number) => void
): Promise<{ soNumber: string; doNumber: string; doDate: string; customerName: string; branchId?: number }[]> {
  const results: { soNumber: string; doNumber: string; doDate: string; customerName: string; branchId?: number }[] = [];
  const total = doIds.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = doIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(id => fetchDODetail(id)));
    batchResults.forEach(r => { if (r) results.push(r); });
    if (onProgress) onProgress(Math.min(i + batchSize, total), total);
  }

  return results;
}


// ─── PURCHASE INVOICE (Price Analysis) ──────────────────────────

export interface AccuratePurchaseInvoiceItem {
  item: { id: number; no: string; name: string };
  quantity: number;          // qty dalam satuan transaksi (Box/Sak/Pcs)
  quantityInBase: number;    // qty dalam satuan dasar (Pcs)
  unitRatio: number;         // konversi: 1 unit transaksi = unitRatio base unit
  unitPrice: number;         // harga per unit transaksi (bisa include PPN)
  totalPrice: number;
  itemUnitName: string;      // satuan di faktur (Box/Pcs/Sak)
  useTax1: boolean;          // apakah item kena PPN
}

export interface AccuratePurchaseInvoice {
  id: number;
  number: string;
  transDate: string;         // DD/MM/YYYY
  branchId?: number;
  inclusiveTax: boolean;     // true = harga sudah termasuk PPN
  taxable: boolean;
  detailItem: AccuratePurchaseInvoiceItem[];
}

/**
 * Per-item purchase price tracking
 */
export interface ItemPurchasePriceData {
  // Last purchase (most recent invoice)
  lastPrice: number;            // harga per base unit (sudah dikonversi)
  lastPriceRaw: number;         // harga asli di faktur
  lastDate: string;             // DD/MM/YYYY
  lastInvoiceNumber: string;
  lastUnitName: string;         // satuan di faktur terakhir
  lastUnitRatio: number;        // rasio konversi terakhir
  // Weighted average
  totalCost: number;            // sum(qty_base * price_per_base)
  totalQtyBase: number;         // total qty in base unit
  invoiceCount: number;
  // Tax
  inclusiveTax: boolean;
}

/** Map: itemNo → ItemPurchasePriceData */
export type PurchasePriceMap = Map<string, ItemPurchasePriceData>;

// Cache
const PURCHASE_PRICE_CACHE_KEY = 'purchase-price-cache';

interface CachedPurchasePrice {
  timestamp: number;
  data: Record<string, ItemPurchasePriceData>;
}

/**
 * Normalize unit price to per-base-unit (Pcs/Kg).
 * Uses 3-level fallback: unitRatio → qty calculation → item master ratio2.
 */
function normalizePricePerBase(
  unitPrice: number,
  unitRatio: number,
  quantity: number,
  quantityInBase: number,
  totalPrice: number,
  itemNo: string,
  itemUnitMap?: Map<string, ItemUnitInfo>
): { pricePerBase: number; effectiveRatio: number } {
  // Method 1: unitRatio from the invoice detail
  if (unitRatio > 1) {
    return { pricePerBase: unitPrice / unitRatio, effectiveRatio: unitRatio };
  }

  // Method 2: Calculate from qty fields
  if (quantityInBase > 0 && quantity > 0 && quantityInBase !== quantity) {
    const calcRatio = quantityInBase / quantity;
    if (calcRatio > 1) {
      return { pricePerBase: unitPrice / calcRatio, effectiveRatio: calcRatio };
    }
  }

  // Method 3: totalPrice / quantityInBase
  if (totalPrice > 0 && quantityInBase > 0) {
    const ppb = totalPrice / quantityInBase;
    const ratio = quantity > 0 ? quantityInBase / quantity : 1;
    return { pricePerBase: ppb, effectiveRatio: ratio > 1 ? ratio : 1 };
  }

  // Method 4: Lookup from item master
  if (itemUnitMap) {
    const unitInfo = itemUnitMap.get(itemNo);
    if (unitInfo && unitInfo.unitConversion > 1) {
      return { pricePerBase: unitPrice / unitInfo.unitConversion, effectiveRatio: unitInfo.unitConversion };
    }
  }

  // Default: already per base unit
  return { pricePerBase: unitPrice, effectiveRatio: 1 };
}

/**
 * Fetch Purchase Invoice list with date filter.
 */
async function fetchPurchaseInvoiceList(
  fromDate: Date,
  branchId?: number
): Promise<{ id: number; transDate: string; branchId?: number }[]> {
  const allPIs: { id: number; transDate: string; branchId?: number }[] = [];
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  const fromStr = `${String(fromDate.getDate()).padStart(2, '0')}/${String(fromDate.getMonth() + 1).padStart(2, '0')}/${fromDate.getFullYear()}`;
  const now = new Date();
  const toStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  console.log(`[Accurate] PI: Fetching purchase invoice list (${fromStr} → ${toStr})${branchId ? ` branch=${branchId}` : ''}...`);

  while (hasMore) {
    const params: Record<string, any> = {
      fields: 'id,transDate,branchId',
      'filter.transDate.op': 'BETWEEN',
      'filter.transDate.val[0]': fromStr,
      'filter.transDate.val[1]': toStr,
      'sp.page': page,
      'sp.pageSize': pageSize,
    };
    if (branchId) {
      params['filter.branchId.op'] = 'EQUAL';
      params['filter.branchId.val'] = branchId;
    }

    let success = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const response = await accurateClient.get('/purchase-invoice/list.do', { params });
        if (response.data?.s) {
          const list = response.data.d || [];
          if (list.length === 0) {
            hasMore = false;
          } else {
            list.forEach((pi: any) => {
              allPIs.push({ id: pi.id, transDate: pi.transDate, branchId: pi.branchId });
            });
            if (page % 50 === 0) {
              console.log(`[Accurate] PI: page ${page}, ${allPIs.length} invoices so far`);
            }
            page++;
            if (page > 500) { hasMore = false; }
          }
          success = true;
          break;
        } else {
          hasMore = false; success = true; break;
        }
      } catch (error: any) {
        const status = error.response?.status;
        if (status === 429 && attempt < 5) {
          const delay = 3000 * Math.pow(2, attempt - 1);
          console.warn(`[Accurate] PI page ${page}: HTTP 429, waiting ${delay / 1000}s...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          console.error(`[Accurate] PI list page ${page} error:`, error.message);
          hasMore = false; success = true; break;
        }
      }
    }
    if (!success) { hasMore = false; }
    if (hasMore) await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[Accurate] PI list done: ${allPIs.length} purchase invoices`);
  return allPIs;
}

/**
 * Fetch detail for a single Purchase Invoice.
 */
async function fetchPurchaseInvoiceDetail(
  piId: number,
  maxRetries = 3
): Promise<AccuratePurchaseInvoice | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await accurateClient.get('/purchase-invoice/detail.do', {
        params: { id: piId }
      });

      if (response.data?.s && response.data.d) {
        const d = response.data.d;
        return {
          id: d.id,
          number: d.number,
          transDate: d.transDate,
          branchId: d.branchId || undefined,
          inclusiveTax: d.inclusiveTax ?? false,
          taxable: d.taxable ?? false,
          detailItem: (d.detailItem || []).map((di: any) => ({
            item: di.item ? { id: di.item.id, no: di.item.no, name: di.item.name } : { id: 0, no: '', name: '' },
            quantity: di.quantity || 0,
            quantityInBase: di.quantityInBase || (di.quantity * (di.unitRatio || 1)) || 0,
            unitRatio: di.unitRatio || 1,
            unitPrice: di.unitPrice || 0,
            totalPrice: di.totalPrice || 0,
            itemUnitName: di.itemUnitName || di.unitName || '',
            useTax1: di.useTax1 ?? false,
          })),
        };
      }
      return null;
    } catch (err: any) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      } else {
        console.error(`[Accurate] PI ${piId} FAILED after ${maxRetries} attempts: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

/**
 * Fetch PI details in parallel batches.
 */
async function fetchPIDetailsInBatch(
  piIds: number[],
  batchSize = 20,
  onProgress?: (done: number, total: number) => void
): Promise<AccuratePurchaseInvoice[]> {
  const results: AccuratePurchaseInvoice[] = [];
  const failedIds: number[] = [];
  const total = piIds.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = piIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(id => fetchPurchaseInvoiceDetail(id)));
    batch.forEach((id, idx) => {
      if (batchResults[idx]) results.push(batchResults[idx]!);
      else failedIds.push(id);
    });
    if (onProgress) onProgress(Math.min(i + batchSize, total), total);
  }

  // Retry failed
  if (failedIds.length > 0) {
    console.warn(`[Accurate] PI: ${failedIds.length} failed. Retrying...`);
    for (const id of failedIds) {
      await new Promise(r => setTimeout(r, 500));
      const result = await fetchPurchaseInvoiceDetail(id, 3);
      if (result) results.push(result);
    }
  }

  return results;
}

/**
 * Save purchase price cache.
 */
async function savePurchasePriceCache(priceMap: PurchasePriceMap): Promise<void> {
  try {
    const data: Record<string, ItemPurchasePriceData> = {};
    priceMap.forEach((val, key) => { data[key] = val; });
    const cached: CachedPurchasePrice = { timestamp: Date.now(), data };
    await prisma.dataCache.upsert({
      where: { key: PURCHASE_PRICE_CACHE_KEY },
      update: { data: cached as any },
      create: { key: PURCHASE_PRICE_CACHE_KEY, data: cached as any },
    });
    console.log(`[Cache] Purchase price data saved (${priceMap.size} items)`);
  } catch (err: any) {
    console.warn(`[Cache] Purchase price save failed:`, err.message);
  }
}

/**
 * Load purchase price cache.
 */
export async function loadPurchasePriceCache(): Promise<PurchasePriceMap | null> {
  try {
    const entry = await prisma.dataCache.findUnique({ where: { key: PURCHASE_PRICE_CACHE_KEY } });
    if (!entry?.data) return null;
    const cached = entry.data as unknown as CachedPurchasePrice;
    const age = Date.now() - cached.timestamp;
    console.log(`[Cache] Purchase price cache is ${Math.round(age / 60000)} min old`);
    const map: PurchasePriceMap = new Map();
    for (const [itemNo, d] of Object.entries(cached.data)) {
      map.set(itemNo, d);
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Main: Fetch all purchase price data and aggregate.
 * Returns Map of itemNo → ItemPurchasePriceData (prices normalized to per-base-unit).
 */
export async function fetchAllPurchasePriceData(
  fromDate: Date,
  force = false,
  itemUnitMap?: Map<string, ItemUnitInfo>,
  onProgress?: (done: number, total: number) => void
): Promise<{ priceMap: PurchasePriceMap; piCount: number }> {
  // Try cache
  if (!force) {
    const cached = await loadPurchasePriceCache();
    if (cached) return { priceMap: cached, piCount: -1 };
  }

  // Ambil config PPN Rate dari setting (default 11 jika tidak ada)
  let ppnRateConfig = 11;
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'price_sync_config' },
    });
    if (setting?.value && typeof (setting.value as any).ppnRate === 'number') {
      ppnRateConfig = (setting.value as any).ppnRate;
    }
  } catch (err) {
    console.warn('[Accurate] Failed to read PPN rate config, using default 11%');
  }
  const currentPpnRate = ppnRateConfig / 100;

  // Phase 1: List
  const piList = await fetchPurchaseInvoiceList(fromDate);
  if (piList.length === 0) {
    const empty: PurchasePriceMap = new Map();
    await savePurchasePriceCache(empty);
    return { priceMap: empty, piCount: 0 };
  }

  // Phase 2: Details
  const piIds = piList.map(pi => pi.id);
  console.log(`[Accurate] PI Phase 2: Fetching detail for ${piIds.length} purchase invoices...`);

  const invoices = await fetchPIDetailsInBatch(piIds, 20, (done, total) => {
    if (onProgress) onProgress(done, total);
    if (done % 200 === 0 || done === total) {
      console.log(`[Accurate] PI detail progress: ${done}/${total}`);
    }
  });

  // Phase 3: Aggregate per item
  const priceMap: PurchasePriceMap = new Map();

  invoices.forEach(inv => {
    const invDate = parseAccurateDate(inv.transDate);

    inv.detailItem.forEach(di => {
      const itemNo = di.item?.no;
      if (!itemNo || di.unitPrice <= 0) return;

      // Normalize price to per-base-unit
      let { pricePerBase, effectiveRatio } = normalizePricePerBase(
        di.unitPrice, di.unitRatio, di.quantity, di.quantityInBase,
        di.totalPrice, itemNo, itemUnitMap
      );

      // --- PPN Adjustment (Margin Standardization) ---
      // PPN Rate diambil dinamis dari config (currentPpnRate)
      const isExcludeItem = itemNo.includes('-NN-') || itemNo.includes('-BB-');
      const isTaxable = di.useTax1 || inv.taxable;

      if (!isExcludeItem) {
        // Target: INCLUDE PPN
        // Jika pembelian eksklusif PPN tapi barang kena pajak, tambahkan PPN agar setara dengan harga jual
        if (!inv.inclusiveTax && isTaxable) {
          pricePerBase = pricePerBase * (1 + currentPpnRate);
        }
      } else {
        // Target: EXCLUDE PPN (Untuk item -NN- dan -BB-)
        // Jika pembelian inklusif PPN dan kena pajak, keluarkan/buang PPN
        if (inv.inclusiveTax && isTaxable) {
          pricePerBase = pricePerBase / (1 + currentPpnRate);
        }
      }

      const qtyBase = di.quantityInBase || (di.quantity * (di.unitRatio || 1));
      const lineCost = pricePerBase * qtyBase;

      const existing = priceMap.get(itemNo);

      if (!existing) {
        priceMap.set(itemNo, {
          lastPrice: pricePerBase,
          lastPriceRaw: di.unitPrice,
          lastDate: inv.transDate,
          lastInvoiceNumber: inv.number,
          lastUnitName: di.itemUnitName || '',
          lastUnitRatio: effectiveRatio,
          totalCost: lineCost,
          totalQtyBase: qtyBase,
          invoiceCount: 1,
          inclusiveTax: inv.inclusiveTax,
        });
      } else {
        // Update "last" if this invoice is newer
        const existingDate = parseAccurateDate(existing.lastDate);
        if (invDate > existingDate) {
          existing.lastPrice = pricePerBase;
          existing.lastPriceRaw = di.unitPrice;
          existing.lastDate = inv.transDate;
          existing.lastInvoiceNumber = inv.number;
          existing.lastUnitName = di.itemUnitName || '';
          existing.lastUnitRatio = effectiveRatio;
          existing.inclusiveTax = inv.inclusiveTax;
        }
        // Accumulate for weighted average
        existing.totalCost += lineCost;
        existing.totalQtyBase += qtyBase;
        existing.invoiceCount += 1;
      }
    });
  });

  console.log(`[Accurate] PI done: ${priceMap.size} items with purchase price data from ${invoices.length} invoices`);

  await savePurchasePriceCache(priceMap);
  return { priceMap, piCount: invoices.length };
}

/**
 * Extract latest selling price per item per branch from Sales Invoice data.
 * OPTIMIZED: Only fetches last 3 months (not all history) and caches results.
 * Returns Map: itemNo → Map: branchId → { price, priceRaw, unitName, ratio, date, invoiceNo }
 */

const SELLING_PRICE_CACHE_KEY = 'selling-price-cache';

interface CachedSellingPrice {
  timestamp: number;
  data: Record<string, Record<string, {
    price: number; priceRaw: number; unitName: string; ratio: number;
    date: string; invoiceNumber: string; inclusiveTax: boolean;
  }>>;
}

type SellingPriceResult = Map<string, Map<number, {
  price: number; priceRaw: number; unitName: string; ratio: number;
  date: string; invoiceNumber: string; inclusiveTax: boolean;
}>>;

export async function fetchLatestSellingPrices(
  fromDate: Date,
  force = false,
  itemUnitMap?: Map<string, ItemUnitInfo>
): Promise<SellingPriceResult> {
  const result: SellingPriceResult = new Map();

  // Try cache first (valid for 2 hours)
  if (!force) {
    try {
      const entry = await prisma.dataCache.findUnique({ where: { key: SELLING_PRICE_CACHE_KEY } });
      if (entry?.data) {
        const cached = entry.data as unknown as CachedSellingPrice;
        const age = Date.now() - cached.timestamp;
        const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
        if (age < CACHE_TTL) {
          console.log(`[PriceAnalysis] Using cached selling prices (${Math.round(age / 60000)} min old)`);
          for (const [itemNo, branches] of Object.entries(cached.data)) {
            const brMap = new Map<number, any>();
            for (const [brId, val] of Object.entries(branches)) {
              brMap.set(parseInt(brId), val);
            }
            result.set(itemNo, brMap);
          }
          return result;
        }
        console.log(`[PriceAnalysis] Selling price cache expired (${Math.round(age / 60000)} min old)`);
      }
    } catch {}
  }

  // OPTIMIZATION: Only fetch last 3 months for "latest" selling price
  // No need to scan 21K+ invoices from Jan 2025
  const recentDate = new Date();
  recentDate.setMonth(recentDate.getMonth() - 3);
  const effectiveFrom = recentDate > fromDate ? recentDate : fromDate;

  console.log(`[PriceAnalysis] Fetching selling prices from ${effectiveFrom.toISOString().slice(0, 10)} (optimized: 3 months)`);

  const invoiceList = await fetchInvoiceList(effectiveFrom);
  if (invoiceList.length === 0) return result;

  const invoiceIds = invoiceList.map(inv => inv.id);
  console.log(`[PriceAnalysis] Fetching detail for ${invoiceIds.length} recent sales invoices...`);

  // Build invoice → branch map
  const invBranchMap = new Map<number, number>();
  invoiceList.forEach(inv => { if (inv.branchId) invBranchMap.set(inv.id, inv.branchId); });

  // Use smaller batch size (10 instead of 20) to reduce 429 errors
  const invoices = await fetchDetailsInBatch(invoiceIds, 10, (done, total) => {
    if (done % 500 === 0 || done === total) {
      console.log(`[PriceAnalysis] SI detail progress: ${done}/${total}`);
    }
  });

  const defaultInclusiveTax = true;

  invoices.forEach(inv => {
    const branchId = inv.branchId || invBranchMap.get(inv.id);
    if (!branchId) return;

    const invDate = parseAccurateDate(inv.transDate);

    (inv.detailItem || []).forEach(di => {
      const itemNo = di.item?.no;
      if (!itemNo || di.unitPrice <= 0) return;

      const { pricePerBase, effectiveRatio } = normalizePricePerBase(
        di.unitPrice, di.unitRatio, di.quantity,
        di.quantityInBase, di.totalPrice || 0,
        itemNo, itemUnitMap
      );

      if (!result.has(itemNo)) result.set(itemNo, new Map());
      const branchMap = result.get(itemNo)!;

      const existing = branchMap.get(branchId);
      if (!existing || invDate > parseAccurateDate(existing.date)) {
        branchMap.set(branchId, {
          price: pricePerBase,
          priceRaw: di.unitPrice,
          unitName: di.itemUnitName || '',
          ratio: effectiveRatio,
          date: inv.transDate,
          invoiceNumber: inv.number,
          inclusiveTax: defaultInclusiveTax,
        });
      }
    });
  });

  // Save to cache
  try {
    const cacheData: CachedSellingPrice['data'] = {};
    result.forEach((brMap, itemNo) => {
      cacheData[itemNo] = {};
      brMap.forEach((val, brId) => {
        cacheData[itemNo][brId.toString()] = val;
      });
    });
    await prisma.dataCache.upsert({
      where: { key: SELLING_PRICE_CACHE_KEY },
      update: { data: { timestamp: Date.now(), data: cacheData } as any },
      create: { key: SELLING_PRICE_CACHE_KEY, data: { timestamp: Date.now(), data: cacheData } as any },
    });
    console.log(`[PriceAnalysis] Selling price cache saved (${result.size} items)`);
  } catch (err: any) {
    console.warn(`[PriceAnalysis] Cache save failed:`, err.message);
  }

  console.log(`[PriceAnalysis] Selling prices: ${result.size} items across branches`);
  return result;
}


// ─── ITEM MASTER SELLING PRICES ──────────────────────────────
// Fetch detailSellingPrice from /item/detail.do for all items
// with 24-hour cache and batch processing

const MASTER_SP_CACHE_KEY = 'master-selling-price-cache';

export interface MasterSellingPriceEntry {
  categoryId: number;
  categoryName: string;
  branchId: number;
  branchName: string;
  price: number;           // Original price from master
  unitName: string;        // Unit used for this price
  effectiveDate: string;
}

export interface ItemMasterPrices {
  itemNo: string;
  ratio2: number;           // Unit 1→2 ratio (from item master)
  unit1Name: string;        // Base unit
  unit2Name: string;        // Second unit
  prices: MasterSellingPriceEntry[];
}

export async function fetchItemMasterSellingPrices(
  itemIds: number[],
  force = false
): Promise<Map<string, ItemMasterPrices>> {
  const result = new Map<string, ItemMasterPrices>();

  // Try cache first (valid for 24 hours)
  if (!force) {
    try {
      const entry = await prisma.dataCache.findUnique({ where: { key: MASTER_SP_CACHE_KEY } });
      if (entry?.data) {
        const cached = entry.data as any;
        const age = Date.now() - (cached.timestamp || 0);
        const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
        if (age < CACHE_TTL) {
          console.log(`[MasterSP] Using cached master selling prices (${Math.round(age / 60000)} min old, ${Object.keys(cached.data || {}).length} items)`);
          for (const [itemNo, val] of Object.entries(cached.data || {})) {
            result.set(itemNo, val as ItemMasterPrices);
          }
          return result;
        }
        console.log(`[MasterSP] Cache expired (${Math.round(age / 60000)} min old)`);
      }
    } catch {}
  }

  console.log(`[MasterSP] Fetching item details for ${itemIds.length} items...`);

  // Batch fetch item details (10 concurrent to avoid 429)
  const BATCH_SIZE = 10;
  const DELAY_BETWEEN_BATCHES = 300; // ms
  let done = 0;

  for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
    const batch = itemIds.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (id) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await accurateClient.get('/item/detail.do', { params: { id } });
          return res.data?.d || null;
        } catch (err: any) {
          if (err.response?.status === 429 && attempt < 3) {
            await new Promise(r => setTimeout(r, 2000 * attempt));
            continue;
          }
          if (attempt === 3) console.warn(`[MasterSP] Item ${id} failed:`, err.message);
          return null;
        }
      }
    });

    const results = await Promise.all(promises);

    results.forEach(item => {
      if (!item || !item.no) return;

      const sellingPrices: MasterSellingPriceEntry[] = [];
      const baseUnitName = (item.unit1Name || 'PCS').toLowerCase();
      (item.detailSellingPrice || []).forEach((sp: any) => {
        if (!sp.price || sp.price <= 0) return;
        const spUnit = (sp.unit?.name || '').toLowerCase();
        // Only keep base unit prices — skip Box/Sak/unit2 entries
        // Each category has 2 entries (Btl + Box), we only want Btl
        if (spUnit && spUnit !== baseUnitName) return;
        sellingPrices.push({
          categoryId: sp.priceCategory?.id || 0,
          categoryName: sp.priceCategory?.name || 'Default',
          branchId: sp.branch?.id || 0,
          branchName: sp.branch?.name || 'Semua Cabang',
          price: sp.price,
          unitName: sp.unit?.name || item.unit1Name || 'PCS',
          effectiveDate: sp.effectiveDate || '',
        });
      });

      result.set(item.no, {
        itemNo: item.no,
        ratio2: item.ratio2 || 0,
        unit1Name: item.unit1Name || 'PCS',
        unit2Name: item.unit2Name || '',
        prices: sellingPrices,
      });
    });

    done += batch.length;
    if (done % 100 === 0 || done === itemIds.length) {
      console.log(`[MasterSP] Progress: ${done}/${itemIds.length}`);
    }

    if (i + BATCH_SIZE < itemIds.length) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
    }
  }

  // Save to cache
  try {
    const cacheData: Record<string, ItemMasterPrices> = {};
    result.forEach((val, key) => { cacheData[key] = val; });
    await prisma.dataCache.upsert({
      where: { key: MASTER_SP_CACHE_KEY },
      update: { data: { timestamp: Date.now(), data: cacheData } as any },
      create: { key: MASTER_SP_CACHE_KEY, data: { timestamp: Date.now(), data: cacheData } as any },
    });
    console.log(`[MasterSP] Cache saved (${result.size} items)`);
  } catch (err: any) {
    console.warn(`[MasterSP] Cache save failed:`, err.message);
  }

  return result;
}
