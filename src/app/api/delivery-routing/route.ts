export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { loadSOCache, fetchItemUnitMap } from '@/lib/accurate';
import { prisma } from '@/lib/prisma';
import { DispatchRecord } from '@/lib/google-sheets';

// ─── Types ──────────────────────────────────────────────────

interface AreaSOItem {
    soNumber: string;
    customerName: string;
    customerNo?: string;
    transDate: string;
    statusName: string;
    deliveryStatus?: string;
    dispatchStatus?: string;
    dispatchDriver?: string;
    city?: string;
    itemCount: number;
    totalWeightKg: number;
    totalVolumeM3: number;
    totalValue: number;
    outstandingPcs: number;
}

interface CustomerGroup {
    customerName: string;
    customerNo?: string;
    city: string;
    area: string;
    cluster: string;
    soCount: number;
    totalWeightKg: number;
    totalVolumeM3: number;
    totalValue: number;
    totalOutstandingPcs: number;
    soNumbers: string[];
}

interface AreaGroup {
    area: string;
    cluster: string;
    cities: string[];
    province: string;
    soCount: number;
    customerCount: number;
    itemCount: number;
    totalWeightKg: number;
    totalVolumeM3: number;
    totalValue: number;
    totalOutstandingPcs: number;
    oldestSODate: string;
    soItems: AreaSOItem[];
    customers: CustomerGroup[];
}

// ─── GET ────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const truckWeightKg = parseFloat(searchParams.get('truckWeight') || '5000');
        const truckVolumeM3 = parseFloat(searchParams.get('truckVolume') || '16');
        const onlyOutstanding = searchParams.get('onlyOutstanding') !== 'false';

        // Load SO data from cache
        let soList = await loadSOCache();
        if (!soList) {
            return NextResponse.json({
                areas: [],
                customers: [],
                summary: { totalAreas: 0, totalSO: 0, totalCustomers: 0, totalWeight: 0, totalVolume: 0, totalValue: 0, totalTrucks: 0 },
                message: 'Belum ada data SO. Sync SO terlebih dahulu.',
            });
        }

        // Note: No server-side filtering of delivery status.
        // All SO statuses are passed to the frontend so the user can filter via checkboxes.

        // Load master data: city clusters + product dimensions + unit conversions
        let clusterMap = new Map<string, { area: string; cluster: string | null; subCluster: string | null }>();
        let dimMap = new Map<string, { weightKg: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null; qtyPerCarton: number | null }>();
        let unitMap = new Map<string, { unitConversion: number; salesUnitName: string; baseUnitName: string }>();

        try {
            const [clusters, dims, units] = await Promise.all([
                prisma.cityCluster.findMany(),
                prisma.productDimension.findMany(),
                fetchItemUnitMap(),
            ]);
            clusters.forEach(c => clusterMap.set(c.city, { area: c.area, cluster: c.cluster, subCluster: c.subCluster }));
            dims.forEach(d => dimMap.set(d.itemNo, {
                weightKg: d.weightKg,
                lengthCm: d.lengthCm,
                widthCm: d.widthCm,
                heightCm: d.heightCm,
                qtyPerCarton: d.qtyPerCarton,
            }));
            unitMap = units;
        } catch (e: any) {
            console.warn('[Delivery Routing] Could not load master data:', e.message);
        }

        // ─── Load dispatch (TMS) data for fleet status ─────
        let dispatchByCode = new Map<string, DispatchRecord[]>();
        let dispatchByName = new Map<string, DispatchRecord[]>();
        try {
            let dispatchRecords: DispatchRecord[] = [];
            const dispatchCache = await prisma.dataCache.findUnique({ where: { key: 'dispatch-tms-cache' } });
            if (dispatchCache?.data) {
                dispatchRecords = (dispatchCache.data as any).data || [];
            }
            if (dispatchRecords.length === 0) {
                const { fetchDispatchOrders } = await import('@/lib/google-sheets');
                dispatchRecords = await fetchDispatchOrders();
                if (dispatchRecords.length > 0) {
                    try {
                        await prisma.dataCache.upsert({
                            where: { key: 'dispatch-tms-cache' },
                            update: { data: { timestamp: Date.now(), data: dispatchRecords } as any },
                            create: { key: 'dispatch-tms-cache', data: { timestamp: Date.now(), data: dispatchRecords } as any },
                        });
                    } catch { }
                }
            }
            for (const dr of dispatchRecords) {
                if (dr.customerCode) {
                    const arr = dispatchByCode.get(dr.customerCode) || [];
                    arr.push(dr);
                    dispatchByCode.set(dr.customerCode, arr);
                }
                if (dr.customerName) {
                    const key = dr.customerName.toLowerCase().trim();
                    const arr = dispatchByName.get(key) || [];
                    arr.push(dr);
                    dispatchByName.set(key, arr);
                }
            }
            console.log(`[Delivery Routing] Dispatch data: ${dispatchRecords.length} records loaded`);
        } catch (e: any) {
            console.warn('[Delivery Routing] Could not load dispatch data:', e.message);
        }

        // ─── Group SO by area ───────────────────────────────
        const areaMap = new Map<string, {
            area: string;
            cluster: string;
            cities: Set<string>;
            province: string;
            customerMap: Map<string, {
                customerName: string;
                customerNo?: string;
                city: string;
                totalWeightKg: number;
                totalVolumeM3: number;
                totalValue: number;
                totalOutstandingPcs: number;
                soNumbers: string[];
            }>;
            soItems: AreaSOItem[];
            totalWeightKg: number;
            totalVolumeM3: number;
            totalValue: number;
            totalOutstandingPcs: number;
            totalItemCount: number;
            oldestDate: string;
        }>();

        for (const so of soList) {
            // ★ Critical fix: join area from cityCluster (same logic as SO API)
            const clusterInfo = so.shipCity ? clusterMap.get(so.shipCity) : undefined;
            const area = clusterInfo?.area || so.area || 'Tidak Diketahui';
            const cluster = clusterInfo?.cluster || so.cluster || '-';
            const city = so.shipCity || '-';
            const province = so.shipProvince || '-';
            const key = `${area}||${cluster}`;

            if (!areaMap.has(key)) {
                areaMap.set(key, {
                    area,
                    cluster,
                    cities: new Set(),
                    province,
                    customerMap: new Map(),
                    soItems: [],
                    totalWeightKg: 0,
                    totalVolumeM3: 0,
                    totalValue: 0,
                    totalOutstandingPcs: 0,
                    totalItemCount: 0,
                    oldestDate: '',
                });
            }

            const group = areaMap.get(key)!;
            group.cities.add(city);

            // Parse SO date for oldest tracking
            const parts = so.transDate.split('/');
            const isoDate = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : so.transDate;
            if (!group.oldestDate || isoDate < group.oldestDate) {
                group.oldestDate = isoDate;
            }

            // Calculate weight/volume per SO (with proper unit conversion like SO API)
            let soWeight = 0;
            let soVolume = 0;
            let soValue = 0;
            let soOutstanding = 0;
            let soItemCount = 0;

            for (const di of so.detailItems) {
                const dimInfo = dimMap.get(di.itemNo);
                const unitInfo = unitMap.get(di.itemNo);
                const qtyKarton = (dimInfo?.qtyPerCarton && dimInfo.qtyPerCarton > 1) ? dimInfo.qtyPerCarton : 1;

                // Apply unit conversion (same logic as SO API)
                const isiPerBox = unitInfo?.unitConversion || 0;
                const soUnit = (di.unitName || '').toLowerCase().trim();
                const salesUnit = (unitInfo?.salesUnitName || '').toLowerCase().trim();
                const isSalesUnit = isiPerBox > 1 && salesUnit && soUnit === salesUnit;
                const qtyPcs = isSalesUnit ? di.quantity * isiPerBox : di.quantity;
                const outPcs = isSalesUnit ? di.outstanding * isiPerBox : di.outstanding;

                // Weight is per-pcs, volume needs dividing by qtyPerCarton
                const weightPerPcs = dimInfo?.weightKg || 0;
                const volumePerPcs = (dimInfo?.lengthCm && dimInfo?.widthCm && dimInfo?.heightCm)
                    ? (dimInfo.lengthCm * dimInfo.widthCm * dimInfo.heightCm) / 1_000_000 / qtyKarton
                    : 0;

                soWeight += weightPerPcs * qtyPcs;
                soVolume += volumePerPcs * qtyPcs;
                soValue += di.totalPrice || 0;
                soOutstanding += outPcs;
                soItemCount++;
            }

            group.totalWeightKg += soWeight;
            group.totalVolumeM3 += soVolume;
            group.totalValue += soValue;
            group.totalOutstandingPcs += soOutstanding;
            group.totalItemCount += soItemCount;

            // ─── Customer-level aggregation ─────────────────
            const custKey = so.customerName || 'Unknown';
            if (!group.customerMap.has(custKey)) {
                group.customerMap.set(custKey, {
                    customerName: so.customerName,
                    customerNo: so.customerNo,
                    city,
                    totalWeightKg: 0,
                    totalVolumeM3: 0,
                    totalValue: 0,
                    totalOutstandingPcs: 0,
                    soNumbers: [],
                });
            }
            const cust = group.customerMap.get(custKey)!;
            cust.totalWeightKg += soWeight;
            cust.totalVolumeM3 += soVolume;
            cust.totalValue += soValue;
            cust.totalOutstandingPcs += soOutstanding;
            cust.soNumbers.push(so.soNumber);

            // ─── Resolve dispatch status for this SO ────────
            let dispatchStatus: string | undefined;
            let dispatchDriver: string | undefined;
            {
                let matched: DispatchRecord[] = [];
                if (so.customerNo && dispatchByCode.has(so.customerNo)) {
                    matched = dispatchByCode.get(so.customerNo)!;
                } else if (so.customerName) {
                    const key = so.customerName.toLowerCase().trim();
                    if (dispatchByName.has(key)) matched = dispatchByName.get(key)!;
                }
                if (matched.length > 0) {
                    const latest = matched[matched.length - 1];
                    const allCompleted = matched.every(d => d.isCompleted);
                    const allDeparted = matched.every(d => d.isDeparted);
                    const someDeparted = matched.some(d => d.isDeparted);
                    dispatchStatus = allCompleted ? 'Selesai' : allDeparted ? 'Sudah Berangkat' : someDeparted ? 'Sebagian Berangkat' : 'Belum Berangkat';
                    dispatchDriver = latest.driver || undefined;
                }
            }

            group.soItems.push({
                soNumber: so.soNumber,
                customerName: so.customerName,
                customerNo: so.customerNo,
                transDate: so.transDate,
                statusName: so.statusName,
                deliveryStatus: so.deliveryStatus,
                dispatchStatus,
                dispatchDriver,
                city,
                itemCount: soItemCount,
                totalWeightKg: Math.round(soWeight * 100) / 100,
                totalVolumeM3: Math.round(soVolume * 10000) / 10000,
                totalValue: soValue,
                outstandingPcs: soOutstanding,
            });
        }

        // Convert to array and calculate truck estimates
        const areas: AreaGroup[] = [];
        const allCustomers: CustomerGroup[] = [];
        let grandTotalWeight = 0;
        let grandTotalVolume = 0;
        let grandTotalValue = 0;
        let grandTotalTrucks = 0;

        for (const [, group] of areaMap) {
            // Sort SO items by date (oldest first)
            group.soItems.sort((a, b) => {
                const da = a.transDate.split('/').reverse().join('-');
                const db = b.transDate.split('/').reverse().join('-');
                return da.localeCompare(db);
            });

            const trucksByWeight = truckWeightKg > 0 ? Math.ceil(group.totalWeightKg / truckWeightKg) : 0;
            const trucksByVolume = truckVolumeM3 > 0 ? Math.ceil(group.totalVolumeM3 / truckVolumeM3) : 0;
            const estimatedTrucks = Math.max(trucksByWeight, trucksByVolume, group.soItems.length > 0 ? 1 : 0);

            // Build customer list for this area
            const customers: CustomerGroup[] = [];
            for (const [, cust] of group.customerMap) {
                const custGroup: CustomerGroup = {
                    customerName: cust.customerName,
                    customerNo: cust.customerNo,
                    city: cust.city,
                    area: group.area,
                    cluster: group.cluster,
                    soCount: cust.soNumbers.length,
                    totalWeightKg: Math.round(cust.totalWeightKg * 100) / 100,
                    totalVolumeM3: Math.round(cust.totalVolumeM3 * 10000) / 10000,
                    totalValue: cust.totalValue,
                    totalOutstandingPcs: cust.totalOutstandingPcs,
                    soNumbers: cust.soNumbers,
                };
                customers.push(custGroup);
                allCustomers.push(custGroup);
            }

            // Sort customers by weight desc
            customers.sort((a, b) => b.totalWeightKg - a.totalWeightKg);

            areas.push({
                area: group.area,
                cluster: group.cluster,
                cities: [...group.cities].sort(),
                province: group.province,
                soCount: group.soItems.length,
                customerCount: group.customerMap.size,
                itemCount: group.totalItemCount,
                totalWeightKg: Math.round(group.totalWeightKg * 100) / 100,
                totalVolumeM3: Math.round(group.totalVolumeM3 * 10000) / 10000,
                totalValue: group.totalValue,
                totalOutstandingPcs: group.totalOutstandingPcs,
                oldestSODate: group.oldestDate,
                soItems: group.soItems,
                customers,
            });

            grandTotalWeight += group.totalWeightKg;
            grandTotalVolume += group.totalVolumeM3;
            grandTotalValue += group.totalValue;
            grandTotalTrucks += estimatedTrucks;
        }

        // Sort by total weight descending (heaviest first)
        areas.sort((a, b) => b.totalWeightKg - a.totalWeightKg);

        return NextResponse.json({
            areas,
            customers: allCustomers,
            summary: {
                totalAreas: areas.length,
                totalSO: soList.length,
                totalCustomers: allCustomers.length,
                totalWeight: Math.round(grandTotalWeight * 100) / 100,
                totalVolume: Math.round(grandTotalVolume * 10000) / 10000,
                totalValue: grandTotalValue,
                totalTrucks: grandTotalTrucks,
                truckWeightKg,
                truckVolumeM3,
            },
        });
    } catch (err: any) {
        console.error('[Delivery Routing] Error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
