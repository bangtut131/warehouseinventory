export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { fetchAllSOData, loadSOCache, fetchAllInventory, fetchItemUnitMap } from '@/lib/accurate';
import { SOData } from '@/lib/types';
import { prisma } from '@/lib/prisma';
import { DispatchRecord } from '@/lib/google-sheets';

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
                        const soUnit = (di.unitName || '').toLowerCase().trim();
                        const baseUnit = (unitInfo?.baseUnitName || '').toLowerCase().trim();
                        const salesUnit = (unitInfo?.salesUnitName || '').toLowerCase().trim();

                        // Hanya konversi jika satuan SO = satuan jual grosir (Box/Karton/Sak)
                        // Jika satuan SO = base unit (Bks/Btl/Pcs) atau tidak dikenali → JANGAN kalikan
                        const isSalesUnit = isiPerBox > 1 && salesUnit && soUnit === salesUnit;

                        const qtyPcs = isSalesUnit ? di.quantity * isiPerBox : di.quantity;
                        const shipQtyPcs = isSalesUnit ? di.shipQuantity * isiPerBox : di.shipQuantity;
                        const outstandingPcs = isSalesUnit ? di.outstanding * isiPerBox : di.outstanding;

                        // Join dimension data
                        // Berat sudah per-pcs, volume (P×L×T) per-karton → bagi dengan isi karton
                        const dimInfo = dimMap.get(di.itemNo);
                        const qtyKarton = (dimInfo?.qtyPerCarton && dimInfo.qtyPerCarton > 1) ? dimInfo.qtyPerCarton : 1;
                        const weightKg = dimInfo?.weightKg || undefined;
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

        // Join dispatch (TMS) data: fleet departure status
        try {
            let dispatchRecords: DispatchRecord[] = [];
            
            // Try cache first
            const dispatchCache = await prisma.dataCache.findUnique({ where: { key: 'dispatch-tms-cache' } });
            if (dispatchCache?.data) {
                const c = dispatchCache.data as any;
                dispatchRecords = c.data || [];
            }

            // If cache empty, auto-fetch from Google Sheets
            if (dispatchRecords.length === 0) {
                const { fetchDispatchOrders } = await import('@/lib/google-sheets');
                dispatchRecords = await fetchDispatchOrders();
                // Save to cache
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

            if (dispatchRecords.length > 0) {
                // Load cached DO details to resolve SO -> DO mapping (SLA cache)
                const doCache = await prisma.dataCache.findUnique({ where: { key: 'do-detail-map-cache' } });
                const soToDO = new Map<string, string[]>();
                if (doCache?.data) {
                    const c = doCache.data as any;
                    if (c.data) {
                         Object.values(c.data).forEach((detail: any) => {
                             if (detail.soNumber && detail.doNumber) {
                                 const arr = soToDO.get(detail.soNumber) || [];
                                 arr.push(detail.doNumber.toLowerCase().trim());
                                 soToDO.set(detail.soNumber, arr);
                             }
                         });
                    }
                }

                // Build lookup by taskNumber (DO number)
                const dispatchByTask = new Map<string, DispatchRecord[]>();
                
                for (const dr of dispatchRecords) {
                    if (dr.taskNumber) {
                        const key = dr.taskNumber.toLowerCase().trim();
                        const arr = dispatchByTask.get(key) || [];
                        arr.push(dr);
                        dispatchByTask.set(key, arr);
                    }
                }

                soList = soList.map(so => {
                    const doNumbersArr = soToDO.get(so.soNumber);
                    if (doNumbersArr && doNumbersArr.length > 0) {
                        so.doNumberText = [...new Set(doNumbersArr.map(d => d.toUpperCase()))].join(', ');
                    }

                    // Only assign dispatch status to SOs that have been shipped/invoiced
                    // SOs with status "Diajukan"/"Menunggu diproses" can't logically have dispatched
                    const ds = (so.deliveryStatus || '').toLowerCase();
                    const hasShipped = ds.includes('dikirim') || ds.includes('difaktur');
                    if (!hasShipped) return so;

                    // Match by DO Number (or direct SO Number fallback)
                    let matched: DispatchRecord[] = [];
                    const doNumbers = soToDO.get(so.soNumber);
                    if (doNumbers && doNumbers.length > 0) {
                        for (const doNum of doNumbers) {
                            const matches = dispatchByTask.get(doNum);
                            if (matches) matched.push(...matches);
                        }
                    }
                    // Fallback to strict SO Number match in case user put SO in the sheet
                    if (matched.length === 0) {
                        const matches = dispatchByTask.get(so.soNumber.toLowerCase().trim());
                        if (matches) matched.push(...matches);
                    }

                    if (matched.length > 0) {
                        // Use the most recent dispatch entry
                        const latest = matched[matched.length - 1];
                        const allDeparted = matched.every(d => d.isDeparted);
                        const someDeparted = matched.some(d => d.isDeparted);
                        const allCompleted = matched.every(d => d.isCompleted);
                        
                        let status = 'Belum Berangkat';
                        if (allCompleted) status = 'Selesai';
                        else if (allDeparted) status = 'Sudah Berangkat';
                        else if (someDeparted) status = 'Sebagian Berangkat';

                        return {
                            ...so,
                            dispatchStatus: status,
                            dispatchDriver: latest.driver || undefined,
                            dispatchCoDriver: latest.coDriver || undefined,
                            dispatchDepartedAt: latest.taskStartedAt || undefined,
                            dispatchCompletedAt: latest.taskCompletedAt || undefined,
                            dispatchTaskCount: matched.length,
                            dispatchAssignmentStatus: latest.assignmentStatus || undefined,
                        };
                    }
                    return so;
                });
                console.log(`[SO API] Dispatch merge: ${dispatchRecords.length} records, DO map size=${soToDO.size}`);
            }
        } catch (e: any) {
            console.warn('[SO API] Could not join dispatch data:', e.message);
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
