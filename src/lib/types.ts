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

