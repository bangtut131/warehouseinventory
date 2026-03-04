export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { loadSOCache } from '@/lib/accurate';

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
    soCount: number;
    totalQty: number;
    totalOutstanding: number;
    totalValue: number;
    soNumbers: string[];
}

export interface RegionalEntry {
    city: string;
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

// ─── Parse kota from customer name ───────────────────────────
// Pattern: "[Number] [Words...] [KotaName]"
// Examples:
//   "129 Sragi Pekalongan" → "Pekalongan"
//   "234 Gombong Kebumen"  → "Kebumen"
//   "777 Pertanian - Kota Kefamenanu" → "Kefamenanu"
//   "Toko ABC Semarang"    → "Semarang"

function parseCityFromName(name: string): string {
    if (!name) return '';

    // Remove leading number (e.g., "129 ", "234 ")
    let cleaned = name.trim().replace(/^\d+\s+/, '');

    // Remove common prefixes after dash
    cleaned = cleaned.replace(/\s*-\s*kota\s*/i, ' ');
    cleaned = cleaned.replace(/\s*-\s*/i, ' ');

    // Split into words
    const words = cleaned.trim().split(/\s+/).filter(Boolean);

    if (words.length === 0) return name;
    if (words.length === 1) return words[0];

    // Last word is typically the kabupaten/kota
    return words[words.length - 1];
}

// ─── GET handler ─────────────────────────────────────────────

export async function GET(_request: NextRequest) {
    try {
        // Load SO cache
        const soList = await loadSOCache();
        if (!soList || soList.length === 0) {
            return NextResponse.json(
                { error: 'Data SO belum di-sync. Lakukan sync SO terlebih dahulu.' },
                { status: 404 }
            );
        }

        // Determine date range from SO cache
        let dateFrom: string | null = null;
        let dateTo: string | null = null;

        for (const so of soList) {
            if (!so.transDate) continue;
            // transDate is "dd/mm/yyyy"
            const parts = so.transDate.split('/');
            if (parts.length === 3) {
                const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
                if (!dateFrom || iso < dateFrom) dateFrom = iso;
                if (!dateTo || iso > dateTo) dateTo = iso;
            }
        }

        // All SOs — no status filter (show all cached SOs since sync already filtered by status)
        const allSOs = soList;

        // Group by parsed city
        const cityMap = new Map<string, {
            city: string;
            customers: Map<string, {
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
        }>();

        let unmapped = 0;

        for (const so of allSOs) {
            const city = parseCityFromName(so.customerName);
            const cityKey = city || 'Tidak Diketahui';
            if (!city) unmapped++;

            if (!cityMap.has(cityKey)) {
                cityMap.set(cityKey, {
                    city: cityKey,
                    customers: new Map(),
                    itemMap: new Map(),
                    totalQty: 0,
                    totalOutstanding: 0,
                    totalValue: 0,
                });
            }
            const entry = cityMap.get(cityKey)!;

            // Customer aggregation
            if (!entry.customers.has(so.customerName)) {
                entry.customers.set(so.customerName, {
                    soCount: 0, totalQty: 0, totalOutstanding: 0, totalValue: 0, soNumbers: [],
                });
            }
            const cust = entry.customers.get(so.customerName)!;
            cust.soCount++;
            cust.soNumbers.push(so.soNumber);

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

        // Build result
        const regional: RegionalEntry[] = [];

        for (const [, entry] of cityMap) {
            const customers: RegionalCustomer[] = Array.from(entry.customers.entries())
                .map(([name, c]) => ({
                    customerName: name,
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
            totalSOs: allSOs.length,
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
