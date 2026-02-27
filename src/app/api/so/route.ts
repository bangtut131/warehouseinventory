export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { fetchAllSOData, loadSOCache, fetchAllInventory } from '@/lib/accurate';
import { SOData } from '@/lib/types';

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

        // Join stock data from inventory
        try {
            const items = await fetchAllInventory();
            const stockMap = new Map<string, number>();
            items.forEach(item => stockMap.set(item.no, item.quantity || 0));

            soList = soList.map(so => ({
                ...so,
                detailItems: so.detailItems.map(di => ({
                    ...di,
                    stock: stockMap.get(di.itemNo) ?? undefined,
                })),
            }));
        } catch {
            console.warn('[SO API] Could not join stock data');
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

    const body = await request.json().catch(() => ({}));
    const branchId = body.branch ? parseInt(body.branch) : undefined;
    const fromDate = body.from || undefined;
    const toDate = body.to || undefined;

    soSyncState = { status: 'running', progress: 0, message: 'Memulai sync SO...' };

    // Fire and forget
    (async () => {
        try {
            const { soList, soCount } = await fetchAllSOData(true, branchId, fromDate, toDate, (done, total) => {
                soSyncState.progress = Math.round((done / total) * 100);
                soSyncState.message = `SO: ${done}/${total}`;
            });

            soSyncState = {
                status: 'done',
                progress: 100,
                message: `Selesai! ${soList.length} SO outstanding dari ${soCount} total`,
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
