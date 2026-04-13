export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { loadSOCache } from '@/lib/accurate';
import { prisma } from '@/lib/prisma';

// ─── Types ──────────────────────────────────────────────────

interface AreaSOItem {
    soNumber: string;
    customerName: string;
    customerNo?: string;
    transDate: string;
    statusName: string;
    deliveryStatus?: string;
    itemCount: number;
    totalWeightKg: number;
    totalVolumeM3: number;
    totalValue: number;
    outstandingPcs: number;
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
                summary: { totalAreas: 0, totalSO: 0, totalWeight: 0, totalVolume: 0, totalValue: 0, totalTrucks: 0 },
                message: 'Belum ada data SO. Sync SO terlebih dahulu.',
            });
        }

        // Filter: hanya SO yang belum dikirim / outstanding
        if (onlyOutstanding) {
            soList = soList.filter(so => {
                const ds = (so.deliveryStatus || '').toLowerCase();
                return !ds.includes('dikirim') && !ds.includes('difaktur');
            });
        }

        // Load product dimensions for weight/volume
        let dimMap = new Map<string, { weightKg: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null; qtyPerCarton: number | null }>();
        try {
            const dims = await prisma.productDimension.findMany();
            dims.forEach(d => dimMap.set(d.itemNo, {
                weightKg: d.weightKg,
                lengthCm: d.lengthCm,
                widthCm: d.widthCm,
                heightCm: d.heightCm,
                qtyPerCarton: d.qtyPerCarton,
            }));
        } catch (e: any) {
            console.warn('[Delivery Routing] Could not load dims:', e.message);
        }

        // Group SO by area
        const areaMap = new Map<string, {
            area: string;
            cluster: string;
            cities: Set<string>;
            province: string;
            customers: Set<string>;
            soItems: AreaSOItem[];
            totalWeightKg: number;
            totalVolumeM3: number;
            totalValue: number;
            totalOutstandingPcs: number;
            totalItemCount: number;
            oldestDate: string;
        }>();

        for (const so of soList) {
            const area = so.area || 'Tidak Diketahui';
            const cluster = so.cluster || '-';
            const city = so.shipCity || '-';
            const province = so.shipProvince || '-';
            const key = `${area}||${cluster}`;

            if (!areaMap.has(key)) {
                areaMap.set(key, {
                    area,
                    cluster,
                    cities: new Set(),
                    province,
                    customers: new Set(),
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
            group.customers.add(so.customerName);

            // Parse SO date for oldest tracking
            const parts = so.transDate.split('/');
            const isoDate = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : so.transDate;
            if (!group.oldestDate || isoDate < group.oldestDate) {
                group.oldestDate = isoDate;
            }

            // Calculate weight/volume per SO
            let soWeight = 0;
            let soVolume = 0;
            let soValue = 0;
            let soOutstanding = 0;
            let soItemCount = 0;

            for (const di of so.detailItems) {
                const dimInfo = dimMap.get(di.itemNo);
                const qtyKarton = (dimInfo?.qtyPerCarton && dimInfo.qtyPerCarton > 1) ? dimInfo.qtyPerCarton : 1;

                // Weight is per-pcs, volume needs dividing by qtyPerCarton
                const weightPerPcs = dimInfo?.weightKg || 0;
                const volumePerPcs = (dimInfo?.lengthCm && dimInfo?.widthCm && dimInfo?.heightCm)
                    ? (dimInfo.lengthCm * dimInfo.widthCm * dimInfo.heightCm) / 1_000_000 / qtyKarton
                    : 0;

                const qty = di.quantity || 0;
                soWeight += weightPerPcs * qty;
                soVolume += volumePerPcs * qty;
                soValue += di.totalPrice || 0;
                soOutstanding += di.outstanding || 0;
                soItemCount++;
            }

            group.totalWeightKg += soWeight;
            group.totalVolumeM3 += soVolume;
            group.totalValue += soValue;
            group.totalOutstandingPcs += soOutstanding;
            group.totalItemCount += soItemCount;

            group.soItems.push({
                soNumber: so.soNumber,
                customerName: so.customerName,
                customerNo: so.customerNo,
                transDate: so.transDate,
                statusName: so.statusName,
                deliveryStatus: so.deliveryStatus,
                itemCount: soItemCount,
                totalWeightKg: Math.round(soWeight * 100) / 100,
                totalVolumeM3: Math.round(soVolume * 10000) / 10000,
                totalValue: soValue,
                outstandingPcs: soOutstanding,
            });
        }

        // Convert to array and calculate truck estimates
        const areas: AreaGroup[] = [];
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

            areas.push({
                area: group.area,
                cluster: group.cluster,
                cities: [...group.cities].sort(),
                province: group.province,
                soCount: group.soItems.length,
                customerCount: group.customers.size,
                itemCount: group.totalItemCount,
                totalWeightKg: Math.round(group.totalWeightKg * 100) / 100,
                totalVolumeM3: Math.round(group.totalVolumeM3 * 10000) / 10000,
                totalValue: group.totalValue,
                totalOutstandingPcs: group.totalOutstandingPcs,
                oldestSODate: group.oldestDate,
                soItems: group.soItems,
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
            summary: {
                totalAreas: areas.length,
                totalSO: soList.length,
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
