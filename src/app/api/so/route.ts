export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { fetchAllSOData, loadSOCache, fetchAllInventory, fetchItemUnitMap } from '@/lib/accurate';
import { SOData } from '@/lib/types';
import { prisma } from '@/lib/prisma';

// ─── In-memory sync state ────────────────────────────────────
let soSyncState = {
    status: 'idle' as 'idle' | 'running' | 'done' | 'error',
    progress: 0,
    message: '',
};

// ─── GET: Read SO data (from cache) + join stock ─────────────
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const branchFilter = searchParams.get('branch') ? parseInt(searchParams.get('branch')!) : undefined;
        const statusFilter = searchParams.get('status') || undefined;
        const fromDate = searchParams.get('from') || undefined;
        const toDate = searchParams.get('to') || undefined;

        // Read from cache
        let soList = await loadSOCache();

        if (!soList) {
            return NextResponse.json({
                soList: [],
                syncState: soSyncState,
                message: 'No SO data. Click Sync SO to fetch.',
            });
        }

        // Apply client-side filters
        if (branchFilter) {
            soList = soList.filter(so => so.branchId === branchFilter);
        }
        if (statusFilter) {
            soList = soList.filter(so => so.statusName.toLowerCase() === statusFilter.toLowerCase());
        }
        if (fromDate) {
            soList = soList.filter(so => {
                const parts = so.transDate.split('/');
                if (parts.length === 3) {
                    const soDate = `${parts[2]}-${parts[1]}-${parts[0]}`; // yyyy-mm-dd
                    return soDate >= fromDate;
                }
                return true;
            });
        }
        if (toDate) {
            soList = soList.filter(so => {
                const parts = so.transDate.split('/');
                if (parts.length === 3) {
                    const soDate = `${parts[2]}-${parts[1]}-${parts[0]}`; // yyyy-mm-dd
                    return soDate <= toDate;
                }
                return true;
            });
        }
        const deliveryStatusFilter = searchParams.get('deliveryStatus') || undefined;
        if (deliveryStatusFilter) {
            soList = soList.filter(so => (so.deliveryStatus || 'Belum dikirim').toLowerCase() === deliveryStatusFilter.toLowerCase());
        }

        // Load master data: city clusters + product dimensions
        let clusterMap = new Map<string, { area: string; cluster: string | null; subCluster: string | null }>();
        let dimMap = new Map<string, { weightKg: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null; qtyPerCarton: number | null }>();
        try {
            const [clusters, dims] = await Promise.all([
                prisma.cityCluster.findMany(),
                prisma.productDimension.findMany(),
            ]);
            clusters.forEach(c => clusterMap.set(c.city, { area: c.area, cluster: c.cluster, subCluster: c.subCluster }));
            dims.forEach(d => dimMap.set(d.itemNo, { weightKg: d.weightKg, lengthCm: d.lengthCm, widthCm: d.widthCm, heightCm: d.heightCm, qtyPerCarton: d.qtyPerCarton }));
        } catch (e: any) {
            console.warn('[SO API] Could not load master data:', e.message);
        }

        // Join stock data from inventory
        try {
            const items = await fetchAllInventory();
            const stockMap = new Map<string, number>();
            items.forEach(item => stockMap.set(item.no, item.quantity || 0));

            // Join unit conversion data
            const unitMap = await fetchItemUnitMap();

            soList = soList.map(so => {
                // Join cluster data by city
                const clusterInfo = so.shipCity ? clusterMap.get(so.shipCity) : undefined;

                return {
                    ...so,
                    area: clusterInfo?.area || undefined,
                    cluster: clusterInfo?.cluster || undefined,
                    subCluster: clusterInfo?.subCluster || undefined,
                    detailItems: so.detailItems.map(di => {
                        const unitInfo = unitMap.get(di.itemNo);
                        const isiPerBox = unitInfo?.unitConversion || 0;
                        const unitNameLower = (di.unitName || '').toLowerCase();
                        const isBaseUnit = !unitInfo || isiPerBox <= 1 ||
                            unitNameLower === (unitInfo?.baseUnitName || 'pcs').toLowerCase();

                        // Convert to smallest unit (Pcs)
                        const qtyPcs = isBaseUnit ? di.quantity : di.quantity * isiPerBox;
                        const shipQtyPcs = isBaseUnit ? di.shipQuantity : di.shipQuantity * isiPerBox;
                        const outstandingPcs = isBaseUnit ? di.outstanding : di.outstanding * isiPerBox;

                        // Join dimension data — divide by qtyPerCarton to get per-pcs values
                        const dimInfo = dimMap.get(di.itemNo);
                        const qtyKarton = (dimInfo?.qtyPerCarton && dimInfo.qtyPerCarton > 1) ? dimInfo.qtyPerCarton : 1;
                        const weightKg = dimInfo?.weightKg ? dimInfo.weightKg / qtyKarton : undefined;
                        const volumeM3 = (dimInfo?.lengthCm && dimInfo?.widthCm && dimInfo?.heightCm)
                            ? (dimInfo.lengthCm * dimInfo.widthCm * dimInfo.heightCm) / 1_000_000 / qtyKarton
                            : undefined;

                        // Calculated totals (per pcs qty)
                        const totalWeightKg = weightKg && qtyPcs ? weightKg * qtyPcs : undefined;
                        const totalVolumeM3 = volumeM3 && qtyPcs ? volumeM3 * qtyPcs : undefined;

                        return {
                            ...di,
                            stock: stockMap.get(di.itemNo) ?? undefined,
                            isiPerBox: isiPerBox > 1 ? isiPerBox : undefined,
                            baseUnitName: unitInfo?.baseUnitName,
                            salesUnitName: unitInfo?.salesUnitName,
                            qtyPcs,
                            shipQtyPcs,
                            outstandingPcs,
                            weightKg,
                            volumeM3,
                            totalWeightKg,
                            totalVolumeM3,
                        };
                    }),
                };
            });
        } catch {
            console.warn('[SO API] Could not join stock/unit data');
        }

        return NextResponse.json({
            soList,
            syncState: soSyncState,
            total: soList.length,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ─── POST: Trigger SO sync ───────────────────────────────────
export async function POST(request: NextRequest) {
    if (soSyncState.status === 'running') {
        return NextResponse.json(
            { error: 'SO sync sudah berjalan', state: soSyncState },
            { status: 409 }
        );
    }
    
    // Set status synchronously to prevent race conditions from double clicks
    soSyncState.status = 'running';

    const body = await request.json().catch(() => ({}));
    const branchId = body.branch ? parseInt(body.branch) : undefined;
    
    // Convert frontend yyyy-mm-dd to Accurate dd/mm/yyyy
    const convertDate = (d: string | undefined): string | undefined => {
        if (!d) return undefined;
        const parts = d.split('-');
        if (parts.length === 3 && parts[0].length === 4) {
            return `${parts[2]}/${parts[1]}/${parts[0]}`; // dd/mm/yyyy
        }
        return d; // already dd/mm/yyyy or other format
    };
    const fromDate = convertDate(body.from);
    const toDate = convertDate(body.to);
    const statuses: string[] | undefined = body.statuses?.length > 0 ? body.statuses : undefined;

    soSyncState = { status: 'running', progress: 0, message: 'Memulai sync SO...' };

    // Fire and forget
    (async () => {
        try {
            const { soList, soCount, failedSOs } = await fetchAllSOData(true, branchId, fromDate, toDate, statuses, (done, total) => {
                soSyncState.progress = Math.round((done / total) * 100);
                soSyncState.message = `SO: ${done}/${total}`;
            });

            let doneMsg = `Selesai! ${soList.length} SO outstanding dari ${soCount} total`;
            if (failedSOs && failedSOs.length > 0) {
                doneMsg += `. Gagal narik: ${failedSOs.length} SO (${failedSOs.slice(0, 5).join(', ')}${failedSOs.length > 5 ? ' dll' : ''})`;
            }

            soSyncState = {
                status: 'done',
                progress: 100,
                message: doneMsg,
            };
        } catch (err: any) {
            soSyncState = {
                status: 'error',
                progress: 0,
                message: `Error: ${err.message}`,
            };
        }
    })();

    return NextResponse.json({ message: 'SO sync dimulai', state: soSyncState });
}
