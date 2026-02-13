import { v4 as uuidv4 } from 'uuid';

export interface MonthlySales {
    month: string;
    year: number;
    sales: number;
}

export interface InventoryItem {
    id: string;
    itemNo: string;
    name: string;
    category: string;
    stock: number;
    unit: string;
    cost: number;
    price: number;

    // Analysis Fields
    averageDailyUsage: number; // Avg units sold/used per day
    leadTimeDays: number;      // Days to restock
    safetyStock: number;       // Buffer stock
    minStock: number;          // Min desired stock
    maxStock: number;          // Max desired stock
    serviceLevel: number;      // 0.95
    standardDeviation: number; // For SS calc

    // ABC Analysis
    annualRevenue: number;     // total sales value last 12 months (or projected)
    abcClass: 'A' | 'B' | 'C'; // Pareto class

    // Computed Fields
    reorderPoint: number;      // (AvgDailyUsage * LeadTime) + SafetyStock
    daysOfSupply: number;      // Stock / AvgDailyUsage
    status: 'OK' | 'REORDER' | 'CRITICAL' | 'OVERSTOCK';
    stockValue: number;        // Stock * Cost

    // Trend Data
    monthlySales: MonthlySales[];
}

const CATEGORIES = ['Electronics', 'Furniture', 'Office Supplies', 'Raw Materials', 'Packaging', 'Automotive', 'Medical'];
const UNITS = ['PCS', 'UNIT', 'SET', 'BOX', 'KG', 'MTR', 'PAK'];
const MONTHS = [
    { m: 'Jan', y: 2025 }, { m: 'Feb', y: 2025 }, { m: 'Mar', y: 2025 }, { m: 'Apr', y: 2025 },
    { m: 'May', y: 2025 }, { m: 'Jun', y: 2025 }, { m: 'Jul', y: 2025 }, { m: 'Aug', y: 2025 },
    { m: 'Sep', y: 2025 }, { m: 'Oct', y: 2025 }, { m: 'Nov', y: 2025 }, { m: 'Dec', y: 2025 },
    { m: 'Jan', y: 2026 }, { m: 'Feb', y: 2026 }
];

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
    return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

// Z-score for 95% service level
const Z_SCORE_95 = 1.645;

export function generateMockInventory(count: number = 415): InventoryItem[] {
    const items: InventoryItem[] = [];

    // Helper to generate monthly sales trend
    const generateMonthlySales = (baseDemand: number, variance: number): MonthlySales[] => {
        return MONTHS.map(md => {
            const fluctuation = randomFloat(1 - variance, 1 + variance);
            return {
                month: md.m,
                year: md.y,
                sales: Math.max(0, Math.floor(baseDemand * 30 * fluctuation))
            };
        });
    };

    // First pass: Generate base items
    for (let i = 0; i < count; i++) {
        const category = CATEGORIES[randomInt(0, CATEGORIES.length - 1)];
        const unit = UNITS[randomInt(0, UNITS.length - 1)];
        const cost = randomInt(50000, 5000000);
        const price = Math.floor(cost * randomFloat(1.2, 1.5));

        const avgDailyUsage = randomFloat(0.5, 50); // Increased range
        const leadTimeDays = 7; // Fixed as per request
        const stdDev = avgDailyUsage * randomFloat(0.2, 0.5); // 20-50% variation

        // Formulas
        // Safety Stock = Z * stdDev * sqrt(LeadTime)
        const safetyStock = Math.ceil(Z_SCORE_95 * stdDev * Math.sqrt(leadTimeDays));
        const reorderPoint = Math.ceil((avgDailyUsage * leadTimeDays) + safetyStock);
        const minStock = safetyStock;
        const maxStock = reorderPoint * 2; // Simple heuristic

        // Generate Monthly Sales
        const monthlySales = generateMonthlySales(avgDailyUsage, 0.3);
        const annualRevenue = monthlySales.reduce((acc, curr) => acc + (curr.sales * price), 0);

        // Status Logic (Pre-calculation for distribution)
        // We'll adjust stock later to ensure we hit the requested scenarios (Overstock, Critical, etc)

        items.push({
            id: uuidv4(),
            itemNo: `SKU-${1000 + i}`,
            name: `${category} Item ${i + 1} - ${['Pro', 'Basic', 'Ultra', 'Max'][i % 4]}`,
            category,
            unit,
            stock: 0, // Placeholder
            cost,
            price,
            averageDailyUsage: parseFloat(avgDailyUsage.toFixed(2)),
            leadTimeDays,
            safetyStock,
            minStock,
            maxStock,
            serviceLevel: 0.95,
            standardDeviation: parseFloat(stdDev.toFixed(2)),
            abcClass: 'C', // Placeholder
            annualRevenue,
            reorderPoint,
            daysOfSupply: 0, // Placeholder
            status: 'OK', // Placeholder
            stockValue: 0, // Placeholder
            monthlySales
        });
    }

    // ABC Analysis Calculation
    // Sort by Annual Revenue Descending
    items.sort((a, b) => b.annualRevenue - a.annualRevenue);

    const totalRevenue = items.reduce((acc, item) => acc + item.annualRevenue, 0);
    let cumulativeRevenue = 0;

    items.forEach(item => {
        cumulativeRevenue += item.annualRevenue;
        const percentage = cumulativeRevenue / totalRevenue;

        if (percentage <= 0.80) item.abcClass = 'A';
        else if (percentage <= 0.95) item.abcClass = 'B';
        else item.abcClass = 'C';
    });

    // Enforce specific High Value items mentioned in request
    // "Starban, Tandem, Zenus" - let's rename top 3
    if (items.length > 3) {
        items[0].name = "Starban Insecticide 500ml";
        items[1].name = "Tandem Herbisida Systemic";
        items[2].name = "Zenus Fertilizer Pro";
    }

    // Stock Status Distribution Enforcement
    // Request mentions: 
    // - 10 Reorder
    // - 295 Overstock
    // - 76 No Movement
    // - (Implied) Critical? Let's assume some. User prompt mentions "Alert Reorder" which might be Critical + Reorder.
    // Let's deduce: Total 415. 
    // If 295 Overstock + 76 No Movement + 10 Reorder = 381.
    // Remaining = 34. Maybe these are Critical or OK?
    // Let's create: 10 Critical, 10 Reorder, 295 Overstock, 76 No Movement, 24 OK.

    items.forEach((item, index) => {
        let stock: number;
        let status: 'OK' | 'REORDER' | 'CRITICAL' | 'OVERSTOCK';

        if (index < 10) {
            // Critical (Stock <= SS)
            stock = randomInt(0, item.safetyStock);
            status = 'CRITICAL';
        } else if (index < 20) {
            // Reorder (SS < Stock <= ROP)
            stock = randomInt(item.safetyStock + 1, item.reorderPoint);
            status = 'REORDER';
        } else if (index < 20 + 295) {
            // Overstock
            const minOverstock = Math.max(item.maxStock, item.averageDailyUsage * 60);
            stock = randomInt(Math.ceil(minOverstock), Math.ceil(minOverstock * 1.5));
            status = 'OVERSTOCK';
        } else if (index < 20 + 295 + 76) {
            // No Movement (Stock > 0, Usage ~ 0)
            item.averageDailyUsage = 0;
            item.reorderPoint = item.safetyStock; // if usage is 0, ROP = SS
            stock = randomInt(10, 100);
            status = 'OVERSTOCK'; // No movement usually flagged as Overstock or separate 'NO MOVEMENT' status?
            // The dashboard usually treats No Movement as a sub-category of Overstock or separate. 
            // In InventoryItem, we have status field. Let's map it to OVERSTOCK for now but maybe add a flag?
            // Or if formatting assumes Status 'NO MOVEMENT'? Interface says: 'OK' | 'REORDER' | 'CRITICAL' | 'OVERSTOCK'.
            // Let's stick to OVERSTOCK but with high DoS (Infinity).
        } else {
            // OK
            stock = randomInt(item.reorderPoint + 1, item.maxStock - 1);
            status = 'OK';
        }

        // Apply Stock
        item.stock = stock;
        item.stockValue = stock * item.cost;
        const rawDoS = item.averageDailyUsage > 0 ? stock / item.averageDailyUsage : 99999;
        item.daysOfSupply = parseFloat(Math.min(rawDoS, 99999).toFixed(1));

        // Helper to override status logic if needed (since we forced stock)
        // Re-evaluate to ensure consistency
        if (item.stock <= item.safetyStock) item.status = 'CRITICAL';
        else if (item.stock <= item.reorderPoint) item.status = 'REORDER';
        else if (item.stock > item.maxStock || item.daysOfSupply > 90) item.status = 'OVERSTOCK';
        else item.status = 'OK';

        // Force status for No Movement to be Overstock if not captured
        if (item.averageDailyUsage === 0 && item.stock > 0) item.status = 'OVERSTOCK';
    });

    // Scramble order so ABC aren't just top of list
    return items.sort(() => Math.random() - 0.5);
}
