export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { loadSOCache, fetchAllSOData, fetchCustomerCityMap } from '@/lib/accurate';

// ─── Types ────────────────────────────────────────────────────

export interface RegionalItem {
    itemNo: string;
    itemName: string;
    unitName: string;
    totalQty: number;
    totalOutstanding: number;
    totalValue: number;
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
    unitBreakdown: Record<string, number>;
    outstandingBreakdown: Record<string, number>;
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

function addToBreakdown(bd: Record<string, number>, unit: string, qty: number) {
    const key = (unit || 'Pcs').trim();
    bd[key] = (bd[key] || 0) + qty;
}

// ─── GET handler ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const forceRefresh = searchParams.get('refresh') === 'true';
        const statusParam = searchParams.get('status') || 'menunggu,sebagian';
        const statusGroups = statusParam.split(',').map(s => s.trim().toLowerCase());

        // 1. Load SO data — when refresh=true, FORCE re-fetch from Accurate
        let soList;
        if (forceRefresh) {
            console.log('[SO Regional] Force refresh: re-syncing SO data from Accurate...');
            const result = await fetchAllSOData(true);
            soList = result.soList;
            console.log(`[SO Regional] Fresh SO data: ${soList.length} SOs fetched`);
        } else {
            soList = await loadSOCache();
        }

        if (!soList || soList.length === 0) {
            return NextResponse.json({ error: 'Data SO belum di-sync.' }, { status: 404 });
        }

        // Debug: log unitName from first SO's items to verify fix
        if (soList.length > 0) {
            const firstSO = soList[0];
            console.log(`[SO Regional] Sample SO: ${firstSO.soNumber}, items: ${firstSO.detailItems.length}`);
            firstSO.detailItems.slice(0, 3).forEach((item, i) => {
                console.log(`  item[${i}]: ${item.itemName} | unitName="${item.unitName}" | qty=${item.quantity}`);
            });
        }

        // 2. Load city map
        const cityMap = await fetchCustomerCityMap(forceRefresh);

        // 3. Filter SOs
        const filteredSOs = soList.filter(so => {
            if (!matchStatus(so.statusName, statusGroups)) return false;
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

        // 5. Group by city with unit breakdown
        // unitName comes DIRECTLY from SO detail (already "Box", "Btl", "Pcs" etc. from Accurate)
        // No conversion needed — SO stores the actual sales unit
        type CityEntry = {
            city: string; province: string;
            customers: Map<string, { address: string; soCount: number; totalQty: number; totalOutstanding: number; totalValue: number; soNumbers: string[] }>;
            itemMap: Map<string, { itemName: string; totalQty: number; totalOutstanding: number; totalValue: number; unitName: string }>;
            totalQty: number; totalOutstanding: number; totalValue: number;
            unitBreakdown: Record<string, number>;
            outstandingBreakdown: Record<string, number>;
        };

        const cityEntries = new Map<string, CityEntry>();
        let unmapped = 0;
        const globalUnit: Record<string, number> = {};
        const globalOut: Record<string, number> = {};

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
                entry.customers.set(so.customerName, { address, soCount: 0, totalQty: 0, totalOutstanding: 0, totalValue: 0, soNumbers: [] });
            }
            const cust = entry.customers.get(so.customerName)!;
            cust.soCount++;
            cust.soNumbers.push(so.soNumber);

            for (const item of so.detailItems) {
                cust.totalQty += item.quantity;
                cust.totalOutstanding += item.outstanding;
                cust.totalValue += item.totalPrice;

                // Use unitName directly from SO — already "Box", "Btl", "Sak", "Pcs" etc.
                const displayUnit = (item.unitName || 'Pcs').trim();
                const displayQty = item.quantity;
                const displayOut = item.outstanding;

                addToBreakdown(entry.unitBreakdown, displayUnit, displayQty);
                if (item.outstanding > 0) addToBreakdown(entry.outstandingBreakdown, displayUnit, displayOut);
                addToBreakdown(globalUnit, displayUnit, displayQty);
                if (item.outstanding > 0) addToBreakdown(globalOut, displayUnit, displayOut);

                const existing = entry.itemMap.get(item.itemNo);
                if (!existing) {
                    entry.itemMap.set(item.itemNo, { itemName: item.itemName, totalQty: displayQty, totalOutstanding: displayOut, totalValue: item.totalPrice, unitName: displayUnit });
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
                .map(([name, c]) => ({ customerName: name, address: c.address, soCount: c.soCount, totalQty: c.totalQty, totalOutstanding: c.totalOutstanding, totalValue: c.totalValue, soNumbers: c.soNumbers }))
                .sort((a, b) => b.totalQty - a.totalQty);
            const topItems: RegionalItem[] = Array.from(entry.itemMap.entries())
                .map(([no, im]) => ({ itemNo: no, itemName: im.itemName, unitName: im.unitName, totalQty: im.totalQty, totalOutstanding: im.totalOutstanding, totalValue: im.totalValue }))
                .sort((a, b) => b.totalQty - a.totalQty).slice(0, 10);
            regional.push({
                city: entry.city, province: entry.province,
                customerCount: entry.customers.size,
                soCount: Array.from(entry.customers.values()).reduce((s, c) => s + c.soCount, 0),
                totalQty: entry.totalQty, totalOutstanding: entry.totalOutstanding, totalValue: entry.totalValue,
                unitBreakdown: entry.unitBreakdown, outstandingBreakdown: entry.outstandingBreakdown,
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
            unitBreakdown: globalUnit, outstandingBreakdown: globalOut,
        };

        return NextResponse.json({ regional, summary });
    } catch (err: any) {
        console.error('[SO Regional] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
