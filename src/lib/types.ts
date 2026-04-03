// ==========================================
// Inventory Intelligence — Unified Types
// Single source of truth for ALL interfaces
// ==========================================

export interface MonthlySales {
    month: string;   // 3-letter: "Jan", "Feb", ...
    year: number;    // 2025, 2026
    qty: number;     // Total units sold (pcs / base unit)
    qtyBox: number;  // Total units sold (box / sales unit)
    revenue: number; // Total revenue (qty × price)
}

export interface InventoryItem {
    id: string;
    itemNo: string;
    name: string;
    category: string;
    unit: string;

    // Stock
    stock: number;
    cost: number;    // Unit cost (HPP)
    price: number;   // Selling price

    // ROP / Safety Stock
    reorderPoint: number;
    safetyStock: number;
    minStock: number;
    maxStock: number;
    averageDailyUsage: number;
    leadTimeDays: number;
    serviceLevel: number;    // e.g. 0.95
    standardDeviation: number;

    // ABC-XYZ Analysis
    annualRevenue: number;
    abcClass: 'A' | 'B' | 'C';
    xyzClass: 'X' | 'Y' | 'Z';   // Demand variability

    // Advanced Analysis
    eoq: number;                   // Economic Order Quantity
    turnoverRate: number;          // Annual Inventory Turnover
    demandCategory: 'FAST' | 'SLOW' | 'NON-MOVING' | 'DEAD';
    stockAgeDays: number;          // Estimated stock age
    totalSalesQty: number;         // Total units sold in analysis period (pcs)
    totalSalesQtyBox: number;      // Total units sold in sales unit (box)
    totalSalesRevenue: number;     // Total revenue in analysis period
    unitConversion: number;        // Pcs per box (0 = same unit)
    salesUnitName: string;         // Sales unit name (e.g. "Box", "Karung")

    // PO Outstanding
    poOutstanding: number;       // Qty masih dalam PO (belum diterima)
    netShortage: number;         // Max(0, ROP - Stock - PO Outstanding)
    suggestedOrder: number;      // Qty yang perlu di-order tambahan

    // Computed
    daysOfSupply: number;
    stockValue: number;
    status: 'OK' | 'REORDER' | 'CRITICAL' | 'OVERSTOCK';

    // Trend Data
    monthlySales: MonthlySales[];

    // Meta
    dataSource: 'API' | 'ESTIMATED';
}

// Summary stats for dashboard KPIs
export interface InventorySummary {
    totalSKU: number;
    totalStockValue: number;
    totalAnnualRevenue: number;
    avgTurnoverRate: number;
    criticalCount: number;
    reorderCount: number;
    overstockCount: number;
    deadStockCount: number;
    deadStockValue: number;
    fastMovingCount: number;
    slowMovingCount: number;
    classA: { count: number; revenue: number; pct: number };
    classB: { count: number; revenue: number; pct: number };
    classC: { count: number; revenue: number; pct: number };
}

// ─── SO Control Types ─────────────────────────────────────────

export interface SODetailItem {
    itemNo: string;
    itemName: string;
    quantity: number;        // Qty ordered
    shipQuantity: number;    // Qty processed/shipped
    outstanding: number;     // quantity - shipQuantity
    unitName: string;
    unitPrice: number;
    totalPrice: number;
    stock?: number;          // Current stock (joined from inventory)
}

export interface SOData {
    id: number;
    soNumber: string;
    transDate: string;       // dd/mm/yyyy
    customerName: string;
    branchId?: number;
    branchName?: string;
    statusName: string;      // Diajukan / Menunggu diproses / Terproses
    detailItems: SODetailItem[];
    totalOutstanding: number; // Sum of all outstanding items
}

// ─── SLA Pengiriman Types ─────────────────────────────────────

export interface DeliveryOrderBasic {
    id: number;
    number: string;
    transDate: string;         // dd/mm/yyyy
    branchId?: number;
    customerName: string;
    soNumber?: string;         // Related SO number
}

export interface SLADetail {
    soNumber: string;
    soDate: string;            // dd/mm/yyyy
    doNumber: string | null;
    doDate: string | null;
    customerName: string;
    branchId?: number;
    leadTimeDays: number | null;  // null = belum dikirim
    status: 'ON_TIME' | 'LATE' | 'PENDING';
}

export interface SLASummary {
    totalSO: number;
    delivered: number;
    onTime: number;
    late: number;
    pending: number;
    avgLeadTime: number;
    slaPercentage: number;     // (onTime / delivered) * 100
}

// ─── Price Analysis Types ────────────────────────────────────

export interface BranchPrice {
    branchId: number;
    branchName: string;
    sellingPrice: number;          // Harga jual terbaru (per base unit, sudah konversi)
    sellingPriceRaw: number;       // Harga asli di faktur (sebelum konversi)
    saleUnitName: string;          // Satuan di faktur jual (Box/Pcs)
    unitRatio: number;             // Rasio konversi yang dipakai
    lastSaleDate: string;          // Tanggal penjualan terakhir
    lastInvoiceNumber: string;     // No. faktur penjualan terakhir
    marginVsLastPurchase: number;  // % margin per cabang (per base unit)
    marginVsAvgPurchase: number;   // % margin per cabang (per base unit)
}

export interface PriceAnalysisItem {
    itemNo: string;
    itemName: string;
    category: string;

    // Unit info
    baseUnitName: string;          // Satuan dasar (Pcs/Kg)
    salesUnitName: string;         // Satuan jual (Box/Sak) - kosong jika sama
    unitConversion: number;        // 1 salesUnit = N baseUnit (0 jika sama)

    // Master data
    masterSellingPrice: number;    // Harga jual default dari item master
    masterCost: number;            // HPP dari item master

    // Harga Beli (dari Purchase Invoice) — per base unit
    lastPurchasePrice: number;     // Harga beli terakhir (per base unit)
    lastPurchaseDate: string;      // Tanggal pembelian terakhir
    lastPurchaseInvoice: string;   // No. faktur pembelian terakhir
    lastPurchaseUnit: string;      // Satuan di faktur beli terakhir (Box/Pcs)
    lastPurchaseRawPrice: number;  // Harga asli di faktur (sebelum konversi)
    lastPurchaseRatio: number;     // Rasio konversi yang dipakai
    avgPurchasePrice: number;      // Harga beli rata-rata (weighted, per base unit)
    totalPurchaseQtyBase: number;  // Total qty pembelian (dalam base unit)
    purchaseInvoiceCount: number;  // Jumlah faktur pembelian

    // Tax info
    inclusiveTax: boolean;         // true = harga sudah termasuk PPN

    // Harga Jual Per Cabang — per base unit
    branchPrices: BranchPrice[];

    // Computed margins (berdasarkan harga per base unit)
    marginVsLastPurchase: number;  // % margin dari harga jual vs beli terakhir
    marginVsAvgPurchase: number;   // % margin dari harga jual vs beli rata-rata
    status: 'HEALTHY' | 'THIN' | 'NEGATIVE' | 'NO_DATA';
}
