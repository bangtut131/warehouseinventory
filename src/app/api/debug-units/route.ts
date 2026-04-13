export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { fetchItemUnitMap, loadSOCache } from '@/lib/accurate';

// Endpoint diagnostik: cek semua variasi satuan di Accurate & SO
export async function GET() {
    try {
        // 1. Ambil semua unit info dari item master
        const unitMap = await fetchItemUnitMap(true); // force refresh
        const baseUnits = new Map<string, number>();
        const salesUnits = new Map<string, number>();

        unitMap.forEach((info) => {
            const b = info.baseUnitName || '(kosong)';
            baseUnits.set(b, (baseUnits.get(b) || 0) + 1);
            const s = info.salesUnitName || '(kosong)';
            salesUnits.set(s, (salesUnits.get(s) || 0) + 1);
        });

        // 2. Ambil semua satuan yang dipakai di SO
        const soList = await loadSOCache();
        const soUnits = new Map<string, number>();
        const soUnitExamples = new Map<string, string[]>();
        
        if (soList) {
            for (const so of soList) {
                for (const di of so.detailItems) {
                    const u = di.unitName || '(kosong)';
                    soUnits.set(u, (soUnits.get(u) || 0) + 1);
                    if (!soUnitExamples.has(u) || soUnitExamples.get(u)!.length < 3) {
                        if (!soUnitExamples.has(u)) soUnitExamples.set(u, []);
                        soUnitExamples.get(u)!.push(`${di.itemNo} (${di.itemName})`);
                    }
                }
            }
        }

        // 3. Cari mismatch: SO unit != base unit DAN SO unit != sales unit
        const mismatches: any[] = [];
        if (soList) {
            for (const so of soList) {
                for (const di of so.detailItems) {
                    const unitInfo = unitMap.get(di.itemNo);
                    if (!unitInfo) continue;
                    const soU = (di.unitName || '').toLowerCase().trim();
                    const baseU = (unitInfo.baseUnitName || '').toLowerCase().trim();
                    const salesU = (unitInfo.salesUnitName || '').toLowerCase().trim();
                    
                    if (soU && soU !== baseU && soU !== salesU) {
                        if (mismatches.length < 20) {
                            mismatches.push({
                                soNumber: so.soNumber,
                                itemNo: di.itemNo,
                                itemName: di.itemName,
                                soUnit: di.unitName,
                                baseUnit: unitInfo.baseUnitName,
                                salesUnit: unitInfo.salesUnitName,
                                isiPerBox: unitInfo.unitConversion,
                                qty: di.quantity,
                            });
                        }
                    }
                }
            }
        }

        return NextResponse.json({
            itemMaster: {
                totalWithConversion: unitMap.size,
                baseUnits: Object.fromEntries(baseUnits),
                salesUnits: Object.fromEntries(salesUnits),
            },
            soTransactions: {
                totalSO: soList?.length || 0,
                unitsUsed: Object.fromEntries(soUnits),
                examples: Object.fromEntries(soUnitExamples),
            },
            mismatches: {
                count: mismatches.length,
                items: mismatches,
                note: 'Items where SO unit does not match base OR sales unit'
            }
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
