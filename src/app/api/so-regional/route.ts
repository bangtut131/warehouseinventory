export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { loadSOCache, fetchCustomerCityMap } from '@/lib/accurate';

// ─── Types ────────────────────────────────────────────────────

export interface RegionalItem {
    itemNo: string;
    itemName: string;
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
}

// ─── GET handler ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const forceRefresh = searchParams.get('refresh') === 'true';

        // 1. Load SO cache
        const soList = await loadSOCache();
        if (!soList || soList.length === 0) {
            return NextResponse.json(
                { error: 'Data SO belum di-sync. Lakukan sync SO terlebih dahulu.' },
                { status: 404 }
            );
        }

        // 2. Load customer city map (uses billAddress.city/province from Accurate)
        const cityMap = await fetchCustomerCityMap(forceRefresh);

        // 3. Determine date range
        let dateFrom: string | null = null;
        let dateTo: string | null = null;
        for (const so of soList) {
            if (!so.transDate) continue;
            const parts = so.transDate.split('/');
            if (parts.length === 3) {
                const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
                if (!dateFrom || iso < dateFrom) dateFrom = iso;
                if (!dateTo || iso > dateTo) dateTo = iso;
            }
        }

        // 4. Group by city
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
            }>;
            totalQty: number;
            totalOutstanding: number;
            totalValue: number;
        };

        const cityEntries = new Map<string, CityEntry>();
        let unmapped = 0;

        for (const so of soList) {
            const info = cityMap.get(so.customerName);
            const city = info?.city?.trim() || '';
            const province = info?.province?.trim() || '';
            const address = info?.address || '';

            const cityKey = city || 'Tidak Diketahui';
            const provKey = province || '-';
            if (!city) unmapped++;

            if (!cityEntries.has(cityKey)) {
                cityEntries.set(cityKey, {
                    city: cityKey,
                    province: provKey,
                    customers: new Map(),
                    itemMap: new Map(),
                    totalQty: 0,
                    totalOutstanding: 0,
                    totalValue: 0,
                });
            }
            const entry = cityEntries.get(cityKey)!;

            // Customer
            if (!entry.customers.has(so.customerName)) {
                entry.customers.set(so.customerName, {
                    address,
                    soCount: 0, totalQty: 0, totalOutstanding: 0, totalValue: 0, soNumbers: [],
                });
            }
            const cust = entry.customers.get(so.customerName)!;
            cust.soCount++;
            cust.soNumbers.push(so.soNumber);

            // Items
            for (const item of so.detailItems) {
                cust.totalQty += item.quantity;
                cust.totalOutstanding += item.outstanding;
                cust.totalValue += item.totalPrice;

                if (!entry.itemMap.has(item.itemNo)) {
                    entry.itemMap.set(item.itemNo, {
                        itemName: item.itemName, totalQty: 0, totalOutstanding: 0, totalValue: 0,
                    });
                }
                const im = entry.itemMap.get(item.itemNo)!;
                im.totalQty += item.quantity;
                im.totalOutstanding += item.outstanding;
                im.totalValue += item.totalPrice;
            }

            const soQty = so.detailItems.reduce((s, i) => s + i.quantity, 0);
            const soOut = so.detailItems.reduce((s, i) => s + i.outstanding, 0);
            const soVal = so.detailItems.reduce((s, i) => s + i.totalPrice, 0);
            entry.totalQty += soQty;
            entry.totalOutstanding += soOut;
            entry.totalValue += soVal;
        }

        // 5. Build result
        const regional: RegionalEntry[] = [];
        for (const [, entry] of cityEntries) {
            const customers: RegionalCustomer[] = Array.from(entry.customers.entries())
                .map(([name, c]) => ({
                    customerName: name,
                    address: c.address,
                    soCount: c.soCount,
                    totalQty: c.totalQty,
                    totalOutstanding: c.totalOutstanding,
                    totalValue: c.totalValue,
                    soNumbers: c.soNumbers,
                }))
                .sort((a, b) => b.totalQty - a.totalQty);

            const topItems: RegionalItem[] = Array.from(entry.itemMap.entries())
                .map(([no, im]) => ({
                    itemNo: no,
                    itemName: im.itemName,
                    totalQty: im.totalQty,
                    totalOutstanding: im.totalOutstanding,
                    totalValue: im.totalValue,
                }))
                .sort((a, b) => b.totalQty - a.totalQty)
                .slice(0, 10);

            regional.push({
                city: entry.city,
                province: entry.province,
                customerCount: entry.customers.size,
                soCount: Array.from(entry.customers.values()).reduce((s, c) => s + c.soCount, 0),
                totalQty: entry.totalQty,
                totalOutstanding: entry.totalOutstanding,
                totalValue: entry.totalValue,
                customers,
                topItems,
            });
        }

        regional.sort((a, b) => b.totalQty - a.totalQty);

        const summary: RegionalSummary = {
            totalCities: regional.filter(r => r.city !== 'Tidak Diketahui').length,
            totalCustomers: regional.reduce((s, r) => s + r.customerCount, 0),
            totalSOs: soList.length,
            totalQty: regional.reduce((s, r) => s + r.totalQty, 0),
            totalOutstanding: regional.reduce((s, r) => s + r.totalOutstanding, 0),
            totalValue: regional.reduce((s, r) => s + r.totalValue, 0),
            unmapped,
            dateFrom,
            dateTo,
        };

        return NextResponse.json({ regional, summary });
    } catch (err: any) {
        console.error('[SO Regional] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
