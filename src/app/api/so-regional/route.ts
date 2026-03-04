export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { loadSOCache, fetchCustomerCityMap } from '@/lib/accurate';
import { SOData } from '@/lib/types';

export interface RegionalItem {
    itemNo: string;
    itemName: string;
    totalQty: number;          // pcs
    totalOutstanding: number;  // pcs outstanding
    totalValue: number;
}

export interface RegionalCustomer {
    customerName: string;
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
    totalQty: number;          // pcs — all items
    totalOutstanding: number;  // pcs outstanding
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
    unmapped: number;  // SOs where customer city unknown
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const forceRefresh = searchParams.get('refresh') === 'true';

        // 1. Load SO cache
        const soList = await loadSOCache();
        if (!soList || soList.length === 0) {
            return NextResponse.json({ error: 'Data SO belum di-sync. Lakukan sync SO terlebih dahulu.' }, { status: 404 });
        }

        // 2. Load customer city map
        const cityMap = await fetchCustomerCityMap(forceRefresh);

        // 3. Filter SO — only approved/disetujui status
        const APPROVED_STATUSES = ['disetujui', 'approved', 'menunggu diproses', 'sebagian diproses', 'diproses'];
        const approvedSOs = soList.filter(so =>
            APPROVED_STATUSES.some(s => (so.statusName || '').toLowerCase().includes(s.toLowerCase().split(' ')[0]))
        );

        // 4. Group by city
        const cityMap2 = new Map<string, {
            city: string;
            province: string;
            customers: Map<string, { soCount: number; totalQty: number; totalOutstanding: number; totalValue: number; soNumbers: string[] }>;
            itemMap: Map<string, { itemName: string; totalQty: number; totalOutstanding: number; totalValue: number }>;
            totalQty: number;
            totalOutstanding: number;
            totalValue: number;
        }>();

        let unmapped = 0;

        for (const so of approvedSOs) {
            const cityInfo = cityMap.get(so.customerName);
            const city = cityInfo?.city || '';
            const province = cityInfo?.province || '';

            if (!city) {
                unmapped++;
                // Still include under "Tidak Diketahui"
            }

            const cityKey = city || 'Tidak Diketahui';
            const provKey = province || '-';

            if (!cityMap2.has(cityKey)) {
                cityMap2.set(cityKey, {
                    city: cityKey,
                    province: provKey,
                    customers: new Map(),
                    itemMap: new Map(),
                    totalQty: 0,
                    totalOutstanding: 0,
                    totalValue: 0,
                });
            }
            const entry = cityMap2.get(cityKey)!;

            // Customer aggregation
            if (!entry.customers.has(so.customerName)) {
                entry.customers.set(so.customerName, { soCount: 0, totalQty: 0, totalOutstanding: 0, totalValue: 0, soNumbers: [] });
            }
            const cust = entry.customers.get(so.customerName)!;
            cust.soCount++;
            cust.soNumbers.push(so.soNumber);

            // Item aggregation
            for (const item of so.detailItems) {
                cust.totalQty += item.quantity;
                cust.totalOutstanding += item.outstanding;
                cust.totalValue += item.totalPrice;

                // Item map
                if (!entry.itemMap.has(item.itemNo)) {
                    entry.itemMap.set(item.itemNo, { itemName: item.itemName, totalQty: 0, totalOutstanding: 0, totalValue: 0 });
                }
                const im = entry.itemMap.get(item.itemNo)!;
                im.totalQty += item.quantity;
                im.totalOutstanding += item.outstanding;
                im.totalValue += item.totalPrice;
            }

            // City totals
            const soQty = so.detailItems.reduce((s, i) => s + i.quantity, 0);
            const soOut = so.detailItems.reduce((s, i) => s + i.outstanding, 0);
            const soVal = so.detailItems.reduce((s, i) => s + i.totalPrice, 0);
            entry.totalQty += soQty;
            entry.totalOutstanding += soOut;
            entry.totalValue += soVal;
        }

        // 5. Build result array — sorted by totalQty desc
        const regional: RegionalEntry[] = [];

        for (const [, entry] of cityMap2) {
            const customers: RegionalCustomer[] = Array.from(entry.customers.entries()).map(([name, c]) => ({
                customerName: name,
                soCount: c.soCount,
                totalQty: c.totalQty,
                totalOutstanding: c.totalOutstanding,
                totalValue: c.totalValue,
                soNumbers: c.soNumbers,
            })).sort((a, b) => b.totalQty - a.totalQty);

            const topItems: RegionalItem[] = Array.from(entry.itemMap.entries()).map(([no, im]) => ({
                itemNo: no,
                itemName: im.itemName,
                totalQty: im.totalQty,
                totalOutstanding: im.totalOutstanding,
                totalValue: im.totalValue,
            })).sort((a, b) => b.totalQty - a.totalQty).slice(0, 10);

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

        // 6. Summary
        const summary: RegionalSummary = {
            totalCities: regional.filter(r => r.city !== 'Tidak Diketahui').length,
            totalCustomers: regional.reduce((s, r) => s + r.customerCount, 0),
            totalSOs: approvedSOs.length,
            totalQty: regional.reduce((s, r) => s + r.totalQty, 0),
            totalOutstanding: regional.reduce((s, r) => s + r.totalOutstanding, 0),
            totalValue: regional.reduce((s, r) => s + r.totalValue, 0),
            unmapped,
        };

        return NextResponse.json({ regional, summary });
    } catch (err: any) {
        console.error('[SO Regional] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
