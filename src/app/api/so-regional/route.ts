export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { loadSOCache, fetchCustomerCityMap, fetchItemUnitMap } from '@/lib/accurate';

// ─── Types ────────────────────────────────────────────────────

export interface RegionalItem {
    itemNo: string;
    itemName: string;
    totalQty: number;
    totalOutstanding: number;
    totalValue: number;
    unitName: string;
}

export interface RegionalCustomer {
    customerName: string;
    address: string;
    soCount: number;
    totalQty: number;
    totalOutstanding: number;
    totalValue: number;
    soNumbers: string[];
}

export interface RegionalEntry {
    city: string;
    province: string;
    customerCount: number;
    soCount: number;
    totalQty: number;
    totalOutstanding: number;
    totalValue: number;
    unitBreakdown: Record<string, number>;      // e.g. { "Box": 120, "Pcs": 45, "Sak": 10 }
    outstandingBreakdown: Record<string, number>; // outstanding per unit
    customers: RegionalCustomer[];
    topItems: RegionalItem[];
}

export interface RegionalSummary {
    totalCities: number;
    totalCustomers: number;
    totalSOs: number;
    totalQty: number;
    totalOutstanding: number;
    totalValue: number;
    unmapped: number;
    dateFrom: string | null;
    dateTo: string | null;
    unitBreakdown: Record<string, number>;
    outstandingBreakdown: Record<string, number>;
}

// ─── Status normalization ─────────────────────────────────────

const BASE_UNIT_KEYWORDS = ['pcs', 'pcs.', 'buah', 'unit', 'biji', 'satuan', 'lembar', 'kg', 'liter'];

function isBaseUnit(unitName: string): boolean {
    return BASE_UNIT_KEYWORDS.includes(unitName.toLowerCase().trim());
}

const STATUS_GROUPS: Record<string, string[]> = {
    'menunggu': ['menunggu diproses', 'menunggu'],
    'sebagian': ['sebagian diproses', 'partially processed', 'sebagian'],
    'disetujui': ['disetujui', 'approved'],
    'terproses': ['terproses', 'processed'],
};

function matchStatus(statusName: string, allowedGroups: string[]): boolean {
    const lower = (statusName || '').toLowerCase();
    if (allowedGroups.includes('all')) return true;
    for (const group of allowedGroups) {
        const keywords = STATUS_GROUPS[group] || [group];
        if (keywords.some(kw => lower.includes(kw.split(' ')[0]))) return true;
    }
    return false;
}

// ─── Unit aggregation helper ──────────────────────────────────

function addToBreakdown(
    breakdown: Record<string, number>,
    unitName: string,
    qty: number
) {
    const key = (unitName || 'Pcs').trim();
    breakdown[key] = (breakdown[key] || 0) + qty;
}

// ─── GET handler ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const forceRefresh = searchParams.get('refresh') === 'true';

        const statusParam = searchParams.get('status') || 'menunggu,sebagian';
        const statusGroups = statusParam.split(',').map(s => s.trim().toLowerCase());

        const fromParam = searchParams.get('from') || null;
        const toParam = searchParams.get('to') || null;

        // 1. Load SO cache
        const soList = await loadSOCache();
        if (!soList || soList.length === 0) {
            return NextResponse.json({ error: 'Data SO belum di-sync.' }, { status: 404 });
        }

        // 2. Load city map + item unit map in parallel
        const [cityMap, unitMap] = await Promise.all([
            fetchCustomerCityMap(forceRefresh),
            fetchItemUnitMap(),
        ]);

        // 3. Filter
        const filteredSOs = soList.filter(so => {
            if (!matchStatus(so.statusName, statusGroups)) return false;
            if (fromParam || toParam) {
                const parts = (so.transDate || '').split('/');
                if (parts.length === 3) {
                    const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    if (fromParam && iso < fromParam) return false;
                    if (toParam && iso > toParam) return false;
                }
            }
            return true;
        });

        // 4. Date range
        let dateFrom: string | null = null;
        let dateTo: string | null = null;
        for (const so of filteredSOs) {
            if (!so.transDate) continue;
            const parts = so.transDate.split('/');
            if (parts.length === 3) {
                const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
                if (!dateFrom || iso < dateFrom) dateFrom = iso;
                if (!dateTo || iso > dateTo) dateTo = iso;
            }
        }

        // 5. Group by city
        type CityEntry = {
            city: string;
            province: string;
            customers: Map<string, {
                address: string;
                soCount: number;
                totalQty: number;
                totalOutstanding: number;
                totalValue: number;
                soNumbers: string[];
            }>;
            itemMap: Map<string, {
                itemName: string;
                totalQty: number;
                totalOutstanding: number;
                totalValue: number;
                unitName: string;
            }>;
            totalQty: number;
            totalOutstanding: number;
            totalValue: number;
            unitBreakdown: Record<string, number>;
            outstandingBreakdown: Record<string, number>;
        };

        const cityEntries = new Map<string, CityEntry>();
        let unmapped = 0;
        const globalUnitBreakdown: Record<string, number> = {};
        const globalOutstandingBreakdown: Record<string, number> = {};

        for (const so of filteredSOs) {
            const info = cityMap.get(so.customerName);
            const city = info?.city?.trim() || '';
            const province = info?.province?.trim() || '';
            const address = info?.address || '';
            const cityKey = city || 'Tidak Diketahui';
            if (!city) unmapped++;

            if (!cityEntries.has(cityKey)) {
                cityEntries.set(cityKey, {
                    city: cityKey, province: province || '-',
                    customers: new Map(), itemMap: new Map(),
                    totalQty: 0, totalOutstanding: 0, totalValue: 0,
                    unitBreakdown: {}, outstandingBreakdown: {},
                });
            }
            const entry = cityEntries.get(cityKey)!;

            if (!entry.customers.has(so.customerName)) {
                entry.customers.set(so.customerName, {
                    address, soCount: 0, totalQty: 0, totalOutstanding: 0, totalValue: 0, soNumbers: [],
                });
            }
            const cust = entry.customers.get(so.customerName)!;
            cust.soCount++;
            cust.soNumbers.push(so.soNumber);

            for (const item of so.detailItems) {
                cust.totalQty += item.quantity;
                cust.totalOutstanding += item.outstanding;
                cust.totalValue += item.totalPrice;

                // Determine effective unit and qty for breakdown
                const unitInfo = unitMap.get(item.itemNo);
                let displayUnit = item.unitName || 'Pcs';
                let displayQty = item.quantity;
                let displayOut = item.outstanding;

                if (unitInfo && unitInfo.unitConversion > 0 && isBaseUnit(item.unitName)) {
                    // Item is in base unit (Pcs) but has a sales unit (Box/Karung etc.)
                    displayUnit = unitInfo.salesUnitName || displayUnit;
                    displayQty = Math.ceil(item.quantity / unitInfo.unitConversion);
                    displayOut = item.outstanding > 0 ? Math.ceil(item.outstanding / unitInfo.unitConversion) : 0;
                }

                addToBreakdown(entry.unitBreakdown, displayUnit, displayQty);
                if (item.outstanding > 0) addToBreakdown(entry.outstandingBreakdown, displayUnit, displayOut);
                addToBreakdown(globalUnitBreakdown, displayUnit, displayQty);
                if (item.outstanding > 0) addToBreakdown(globalOutstandingBreakdown, displayUnit, displayOut);

                // Item map (use displayed unit for item top list)
                const existing = entry.itemMap.get(item.itemNo);
                if (!existing) {
                    entry.itemMap.set(item.itemNo, {
                        itemName: item.itemName, totalQty: displayQty, totalOutstanding: displayOut,
                        totalValue: item.totalPrice, unitName: displayUnit,
                    });
                } else {
                    existing.totalQty += displayQty;
                    existing.totalOutstanding += displayOut;
                    existing.totalValue += item.totalPrice;
                }
            }

            const soQty = so.detailItems.reduce((s, i) => s + i.quantity, 0);
            const soOut = so.detailItems.reduce((s, i) => s + i.outstanding, 0);
            const soVal = so.detailItems.reduce((s, i) => s + i.totalPrice, 0);
            entry.totalQty += soQty;
            entry.totalOutstanding += soOut;
            entry.totalValue += soVal;
        }

        // 6. Build result
        const regional: RegionalEntry[] = [];
        for (const [, entry] of cityEntries) {
            const customers: RegionalCustomer[] = Array.from(entry.customers.entries())
                .map(([name, c]) => ({
                    customerName: name, address: c.address,
                    soCount: c.soCount, totalQty: c.totalQty,
                    totalOutstanding: c.totalOutstanding, totalValue: c.totalValue,
                    soNumbers: c.soNumbers,
                }))
                .sort((a, b) => b.totalQty - a.totalQty);

            const topItems: RegionalItem[] = Array.from(entry.itemMap.entries())
                .map(([no, im]) => ({
                    itemNo: no, itemName: im.itemName, unitName: im.unitName,
                    totalQty: im.totalQty, totalOutstanding: im.totalOutstanding, totalValue: im.totalValue,
                }))
                .sort((a, b) => b.totalQty - a.totalQty)
                .slice(0, 10);

            regional.push({
                city: entry.city, province: entry.province,
                customerCount: entry.customers.size,
                soCount: Array.from(entry.customers.values()).reduce((s, c) => s + c.soCount, 0),
                totalQty: entry.totalQty, totalOutstanding: entry.totalOutstanding, totalValue: entry.totalValue,
                unitBreakdown: entry.unitBreakdown,
                outstandingBreakdown: entry.outstandingBreakdown,
                customers, topItems,
            });
        }
        regional.sort((a, b) => b.totalQty - a.totalQty);

        const summary: RegionalSummary = {
            totalCities: regional.filter(r => r.city !== 'Tidak Diketahui').length,
            totalCustomers: regional.reduce((s, r) => s + r.customerCount, 0),
            totalSOs: filteredSOs.length,
            totalQty: regional.reduce((s, r) => s + r.totalQty, 0),
            totalOutstanding: regional.reduce((s, r) => s + r.totalOutstanding, 0),
            totalValue: regional.reduce((s, r) => s + r.totalValue, 0),
            unmapped, dateFrom, dateTo,
            unitBreakdown: globalUnitBreakdown,
            outstandingBreakdown: globalOutstandingBreakdown,
        };

        return NextResponse.json({ regional, summary });
    } catch (err: any) {
        console.error('[SO Regional] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
