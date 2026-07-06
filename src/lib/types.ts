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
    suspended: boolean;            // true = item non-aktif di Accurate
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

    // Unit conversion (joined from item master)
    isiPerBox?: number;      // How many base units (Pcs) per sales unit (Box/Karung)
    baseUnitName?: string;   // e.g. "Pcs"
    salesUnitName?: string;  // e.g. "Box", "Karung"
    qtyPcs?: number;         // quantity converted to smallest unit (Pcs)
    shipQtyPcs?: number;     // shipQuantity converted to smallest unit (Pcs)
    outstandingPcs?: number; // outstanding converted to smallest unit (Pcs)
    weightKg?: number;
    volumeM3?: number;
    totalWeightKg?: number;
    totalVolumeM3?: number;
}

export interface SOData {
    id: number;
    soNumber: string;
    transDate: string;       // dd/mm/yyyy
    customerName: string;
    customerNo?: string;
    branchId?: number;
    branchName?: string;
    shipCity?: string;       // Kota/Kab tujuan pengiriman (normalized)
    shipProvince?: string;   // Provinsi tujuan pengiriman (normalized)
    area?: string;
    cluster?: string;
    subCluster?: string;
    statusName: string;      // Diajukan / Menunggu diproses / Terproses
    deliveryStatus?: string; // Status pengiriman DO: Dikirim / Difaktur / Difaktur Sebagian / Ditolak / Diajukan / Draf / Belum dikirim
    doNumberText?: string;   // DO numbers mapping (comma separated)
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
    receivedDate: string | null;  // murni format date sheets/iso atau as string
    status: 'ON_TIME' | 'LATE' | 'PENDING' | 'IN_TRANSIT';
}

export interface SLASummary {
    totalSO: number;
    delivered: number;
    onTime: number;
    late: number;
    inTransit: number;
    pending: number;
    avgLeadTime: number;
    slaPercentage: number;     // (onTime / delivered) * 100
}

// ─── Price Analysis Types ────────────────────────────────────

/** Harga jual per kategori penjualan dari item master Accurate */
export interface CategoryPrice {
    categoryId: number;
    categoryName: string;         // "CJ R1", "NTB R2", "Telemarketing", dll
    branchId: number;
    branchName: string;           // "Kantor Pusat SMG", "Semua Cabang"
    price: number;                // Harga jual (per base unit, sudah konversi)
    priceRaw: number;             // Harga asli di master (sebelum konversi)
    unitName: string;             // Satuan di master (Box/Pcs)
    unitRatio: number;            // Rasio konversi
    effectiveDate: string;        // Tanggal berlaku
    marginVsLastPurchase: number; // % margin vs harga beli terakhir
    marginVsAvgPurchase: number;  // % margin vs harga beli rata-rata
}

export interface PriceAnalysisItem {
    itemNo: string;
    itemName: string;
    category: string;

    // Unit info
    baseUnitName: string;          // Satuan dasar (Pcs/Kg)
    salesUnitName: string;         // Satuan jual kedua (Box/Sak) - kosong jika sama
    unitConversion: number;        // 1 salesUnit = N baseUnit (0 jika sama)

    // Master data
    masterSellingPrice: number;    // Harga jual default dari item master (unitPrice)
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

    // Harga Jual Per Kategori — dari item master (per base unit)
    categoryPrices: CategoryPrice[];

    // Computed margins (rata-rata semua kategori vs harga beli)
    marginVsLastPurchase: number;  // % margin dari avg harga jual vs beli terakhir
    marginVsAvgPurchase: number;   // % margin dari avg harga jual vs beli rata-rata
    status: 'HEALTHY' | 'THIN' | 'NEGATIVE' | 'NO_DATA';
}

