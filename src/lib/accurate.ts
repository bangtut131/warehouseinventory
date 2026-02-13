import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const API_HOST = process.env.ACCURATE_API_HOST || 'https://zeus.accurate.id/accurate/api';
const API_TOKEN = process.env.ACCURATE_API_TOKEN || '';
const SIGNATURE_SECRET = process.env.ACCURATE_SIGNATURE_SECRET || '';
const DB_ID = process.env.ACCURATE_DB_ID || '453772';

// Cache config (server-side)
const CACHE_DIR = path.resolve(process.cwd(), 'data');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCacheFile(fromDate: Date, branchId?: number): string {
  const dateKey = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`;
  const branchKey = branchId ? `-branch${branchId}` : '';
  return path.join(CACHE_DIR, `sales-cache-${dateKey}${branchKey}.json`);
}

/** Delete cache for a specific date or all caches */
export function clearSalesCache(fromDate?: Date, branchId?: number): void {
  try {
    if (fromDate) {
      const file = getCacheFile(fromDate, branchId);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`[Cache] Deleted cache: ${file}`);
      }
    } else {
      // Delete all sales caches
      const files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith('sales-cache-') && f.endsWith('.json'));
      files.forEach(f => {
        fs.unlinkSync(path.join(CACHE_DIR, f));
        console.log(`[Cache] Deleted: ${f}`);
      });
      // Also delete legacy cache
      const legacy = path.join(CACHE_DIR, 'sales-cache.json');
      if (fs.existsSync(legacy)) {
        fs.unlinkSync(legacy);
        console.log(`[Cache] Deleted legacy cache`);
      }
    }
  } catch (err: any) {
    console.warn(`[Cache] Error clearing cache:`, err.message);
  }
}

// ─── Sync progress tracker (read by /api/sync) ──────────────
export const syncProgress = {
  phase: '' as '' | 'listing' | 'details' | 'aggregating' | 'warehouseStock' | 'done',
  done: 0,
  total: 0,
  message: '',
};

// Create Axios client with proper headers (including X-Session-ID)
export const accurateClient = axios.create({
  baseURL: API_HOST,
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
 */
async function fetchInvoiceDetail(invoiceId: number): Promise<AccurateInvoice | null> {
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
          quantityInBase: di.quantityInBase || di.quantity || 0,
          unitPrice: di.unitPrice || 0,
          totalPrice: di.totalPrice || 0,
          itemUnitName: di.itemUnitName || di.unitName || '',
        })) || []
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Process invoices in parallel batches.
 */
async function fetchDetailsInBatch(
  invoiceIds: number[],
  batchSize: number = 20,
  onProgress?: (done: number, total: number) => void
): Promise<AccurateInvoice[]> {
  const results: AccurateInvoice[] = [];
  const total = invoiceIds.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = invoiceIds.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(id => fetchInvoiceDetail(id))
    );
    batchResults.forEach(r => {
      if (r) results.push(r);
    });
    if (onProgress) onProgress(Math.min(i + batchSize, total), total);
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
export function loadSalesCache(fromDate: Date, branchId?: number): Map<string, ItemSalesData> | null {
  try {
    // Try branch-keyed cache first
    let cacheFile = getCacheFile(fromDate, branchId);
    if (!fs.existsSync(cacheFile)) {
      if (branchId) {
        // Branch-specific cache not found — do NOT fallback to all-branch cache
        // This prevents showing incorrect "all branches" data for a specific branch
        console.log(`[Cache] No cache for branch ${branchId} — need Force Sync for this branch`);
        return null;
      } else {
        // No branch: try legacy cache file
        cacheFile = path.join(CACHE_DIR, 'sales-cache.json');
        if (!fs.existsSync(cacheFile)) return null;
      }
    }
    const raw = fs.readFileSync(cacheFile, 'utf-8');
    const cached: CachedSalesData = JSON.parse(raw);

    const age = Date.now() - cached.timestamp;
    if (age > CACHE_TTL_MS) {
      console.log(`[Cache] Sales cache is ${Math.round(age / 60000)} min old — stale, will re-fetch`);
      return null;
    }

    console.log(`[Cache] Using cached sales data (${Math.round(age / 60000)} min old, ${path.basename(cacheFile)})`);
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
  } catch {
    return null;
  }
}

/**
 * Save sales data to cache file.
 */
function saveSalesCache(fromDate: Date, salesMap: Map<string, ItemSalesData>, branchId?: number): void {
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
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cacheFile = getCacheFile(fromDate, branchId);
    fs.writeFileSync(cacheFile, JSON.stringify(cached), 'utf-8');
    console.log(`[Cache] Sales data cached to ${path.basename(cacheFile)}`);
  } catch (err: any) {
    console.warn(`[Cache] Failed to save cache:`, err.message);
  }
}

/**
 * Main entry point: Fetch all sales data from Accurate with caching.
 * Returns a Map of itemNo → { totalQty, totalRevenue, monthlyData }
 */
export async function fetchAllSalesData(fromDate: Date, force: boolean = false, branchId?: number): Promise<{ salesMap: Map<string, ItemSalesData>; invoiceCount: number }> {
  // 1. Try cache first (unless force sync)
  if (!force) {
    const cached = loadSalesCache(fromDate, branchId);
    if (cached) {
      return { salesMap: cached, invoiceCount: -1 }; // -1 indicates cached
    }
  } else {
    console.log(`[Accurate] Force sync requested — skipping cache${branchId ? ` (branch ${branchId})` : ''}`);
    clearSalesCache(fromDate, branchId);
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

  // 6. Cache results — main cache
  saveSalesCache(fromDate, salesMap, branchId);

  // 6b. Auto-save per-branch caches (only when syncing all branches)
  if (!branchId && branchSalesMaps.size > 0) {
    console.log(`[Accurate] Auto-splitting cache for ${branchSalesMaps.size} branches...`);
    branchSalesMaps.forEach((brMap, brId) => {
      saveSalesCache(fromDate, brMap, brId);
      console.log(`[Accurate]   Branch ${brId}: ${brMap.size} items cached`);
    });
  }

  return { salesMap, invoiceCount: invoices.length };
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

const WH_STOCK_CACHE_FILE = path.join(CACHE_DIR, 'warehouse-stock-cache.json');
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
export function saveWarehouseStockCache(stockMap: WarehouseStockMap): void {
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
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(WH_STOCK_CACHE_FILE, JSON.stringify(cached), 'utf-8');
    console.log(`[Cache] Warehouse stock cached (${stockMap.size} items)`);
  } catch (err: any) {
    console.warn(`[Cache] Failed to save warehouse stock cache:`, err.message);
  }
}

/**
 * Load warehouse stock from cache.
 * Returns null if cache is stale or missing.
 */
export function loadWarehouseStockCache(): WarehouseStockMap | null {
  try {
    if (!fs.existsSync(WH_STOCK_CACHE_FILE)) return null;
    const raw = fs.readFileSync(WH_STOCK_CACHE_FILE, 'utf-8');
    const cached: CachedWarehouseStock = JSON.parse(raw);

    const age = Date.now() - cached.timestamp;
    if (age > WH_STOCK_CACHE_TTL) {
      console.log(`[Cache] Warehouse stock cache is ${Math.round(age / 60000)} min old — stale`);
      return null;
    }

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

// ─── LEGACY (kept for compatibility) ─────────────────────────

/** @deprecated Use fetchAllSalesData instead */
export async function fetchSalesInvoices(fromDate: string, toDate: string): Promise<AccurateInvoice[]> {
  console.warn('[Accurate] fetchSalesInvoices is deprecated — use fetchAllSalesData instead');
  return [];
}
