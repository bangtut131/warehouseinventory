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

// ─── Sync progress tracker (read by /api/sync) ──────────────
export const syncProgress = {
  phase: '' as '' | 'listing' | 'details' | 'aggregating' | 'warehouseStock' | 'poOutstanding' | 'done',
  done: 0,
  total: 0,
  message: '',
};

// Create Axios client with proper headers (including X-Session-ID)
export const accurateClient = axios.create({
  baseURL: API_HOST,
  timeout: 30000, // 30 seconds — prevent hung connections from blocking sync
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

// ─── ITEM LIST ───────────────────────────────────────────────

export interface AccurateItem {
  id: number;
  no: string;
  name: string;
  itemType: string;
  quantity: number;
  unitPrice: number;
  cost: number;
  unit1Name?: string; // Satuan utama
}

export async function fetchInventory(page = 1, pageSize = 100): Promise<{ list: AccurateItem[], hasMore: boolean }> {
  try {
    const response = await accurateClient.get('/item/list.do', {
      params: {
        fields: 'id,no,name,itemType,quantity,unitPrice,cost,unit1Name',
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

// ─── SALES INVOICE ───────────────────────────────────────────

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

// Parse Accurate date format DD/MM/YYYY → Date
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

  console.log(`[Accurate] Phase 1: Fetching invoice IDs (${fromStr} → ${toStr})${branchId ? ` branch=${branchId}` : ''}...`);

  while (hasMore) {
    try {
      const params: Record<string, any> = {
        fields: 'id,transDate,branchId',
        'filter.transDate.op': 'BETWEEN',
        'filter.transDate.val[0]': fromStr,
        'filter.transDate.val[1]': toStr,
        'sp.page': page,
        'sp.pageSize': pageSize,
      };
      // Add branch filter if specified
      if (branchId) {
        params['filter.branchId.op'] = 'EQUAL';
        params['filter.branchId.val'] = branchId;
      }
      const response = await accurateClient.get('/sales-invoice/list.do', {
        params
      });

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
      } else {
        console.warn('[Accurate] Invoice list API returned s=false:', response.data?.d);
        hasMore = false;
      }
    } catch (error: any) {
      console.error(`[Accurate] Invoice list page ${page} error:`, error.message);
      hasMore = false;
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
      console.warn(`[Accurate] ⚠️ ${stillFailed} invoices could NOT be fetched. Sales data may be incomplete.`);
    }
  }

  return results;
}

// ─── AGGREGATED SALES DATA ───────────────────────────────────

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
 * Returns a Map of itemNo → { totalQty, totalRevenue, monthlyData }
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
    console.log(`[Accurate] Force sync requested — clearing cache${branchId ? ` (branch ${branchId})` : ''}`);
    await clearSalesCache(fromDate, branchId);
  } else {
    console.log(`[Accurate] Atomic sync mode — cache ops skipped (caller manages)`);
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

  // Build invoiceId → branchId map from Phase 1 list data
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

  // 6. Cache results — ONLY if not in atomic mode
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

// ─── WAREHOUSE STOCK (Phase 3) ───────────────────────────────

/**
 * Per-warehouse stock data: itemNo → { warehouseId → quantity }
 */
export type WarehouseStockMap = Map<string, Map<number, number>>;

interface CachedWarehouseStock {
  timestamp: number;
  /** itemNo → { warehouseId: quantity } */
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
 * Returns a Map: itemNo → Map(warehouseId → quantity)
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

// ─── PO OUTSTANDING (Phase 4) ────────────────────────────────

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
  /** itemNo → outstanding qty */
  data: Record<string, number>;
}

const PO_CACHE_KEY_PREFIX = 'po-outstanding-cache';

function getPOCacheKey(branchId?: number): string {
  return branchId ? `${PO_CACHE_KEY_PREFIX}-branch${branchId}` : PO_CACHE_KEY_PREFIX;
}

/**
 * Phase 4a: Fetch PO list — exclude "Ditutup"/"Closed" POs.
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
 * Returns a Map of itemNo → outstanding qty (pcs).
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

  // Cache — main (combined)
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

// ─── SO OUTSTANDING (Kontrol SO) ─────────────────────────────

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
      };
      if (branchId) {
        params['filter.branchId.op'] = 'EQUAL';
        params['filter.branchId.val'] = branchId;
      }
      if (fromDate) {
        params['filter.transDate.op'] = 'GREATER_EQUAL';
        params['filter.transDate.val'] = fromDate;
      }
      if (toDate) {
        params['filter.transDate.op2'] = 'LESS_EQUAL';
        params['filter.transDate.val2'] = toDate;
      }

      const response = await accurateClient.get('/sales-order/list.do', { params });

      if (response.data?.s) {
        const list = response.data.d || [];
        if (list.length === 0) {
          hasMore = false;
        } else {
          let matchesInPage = 0;
          list.forEach((so: any) => {
            const status = (so.statusName || '').toLowerCase().trim();
            if (EXCLUDE_STATUSES.includes(status)) return;
            // If statuses filter is specified, only include matching ones
            if (isStatusFiltered && !includeStatuses.includes(status)) return;
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

          // Smart early-exit for status-filtered queries
          if (isStatusFiltered) {
            if (matchesInPage === 0) {
              consecutiveEmptyPages++;
              if (consecutiveEmptyPages >= MAX_EMPTY_PAGES) {
                console.log(`[Accurate] SO: ${MAX_EMPTY_PAGES} consecutive pages with 0 matches, stopping at page ${page} (${allSOs.length} SOs found)`);
                hasMore = false;
              }
            } else {
              consecutiveEmptyPages = 0;
            }
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
        const detailItems: SODetailItem[] = (d.detailItem || []).map((di: any) => {
          const qty = di.quantity || 0;
          const shipped = di.shipQuantity ?? 0;
          return {
            itemNo: di.item?.no || '',
            itemName: di.item?.name || '',
            quantity: qty,
            shipQuantity: shipped,
            outstanding: Math.max(0, qty - shipped),
            unitName: di.itemUnitName || di.unitName || '',
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
  batchSize = 15,
  onProgress?: (done: number, total: number) => void
): Promise<SOData[]> {
  const results: SOData[] = [];
  const total = soIds.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = soIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(id => fetchSODetail(id)));
    batchResults.forEach(r => { if (r) results.push(r); });
    if (onProgress) onProgress(Math.min(i + batchSize, total), total);
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

  // Phase 1: List SOs (status filter applied here = fewer detail fetches)
  const soListRaw = await fetchSOList(branchId, fromDate, toDate, statuses);

  if (soListRaw.length === 0) {
    console.log('[Accurate] No outstanding SOs found');
    await saveSOCache([]);
    return { soList: [], soCount: 0 };
  }

  // Phase 2: Fetch details
  const soIds = soListRaw.map(so => so.id);
  console.log(`[Accurate] SO Phase 2: Fetching detail for ${soIds.length} SOs...`);

  const soData = await fetchSODetailsInBatch(soIds, 15, (done, total) => {
    if (onProgress) onProgress(done, total);
  });

  // Log stats — no further filtering, since user already chose which statuses to sync
  console.log(`[Accurate] SO done: ${soData.length} SOs fetched with detail`);

  // Cache
  await saveSOCache(soData);

  return { soList: soData, soCount: soData.length };
}
