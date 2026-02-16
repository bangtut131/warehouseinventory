import { NextRequest, NextResponse } from 'next/server';
import { fetchAllSalesData, fetchAllInventory, fetchWarehouseStock, saveWarehouseStockCache, fetchAllPOOutstanding, clearSalesCache, syncProgress } from '@/lib/accurate';

// ─── In-memory sync state ────────────────────────────────────
interface SyncState {
    status: 'idle' | 'running' | 'done' | 'error';
    progress: number;    // 0-100
    phase: string;
    message: string;
    startedAt?: number;
    completedAt?: number;
    elapsedSec?: number;
    error?: string;
    itemCount?: number;
    invoiceCount?: number;
}

let syncState: SyncState = {
    status: 'idle',
    progress: 0,
    phase: '',
    message: 'Idle'
};

// ─── GET: Poll sync status ───────────────────────────────────
export async function GET() {
    // Merge real-time progress from accurate.ts
    if (syncState.status === 'running') {
        const elapsed = syncState.startedAt ? Math.round((Date.now() - syncState.startedAt) / 1000) : 0;
        let progress = 5; // default = listing phase
        if (syncProgress.phase === 'details' && syncProgress.total > 0) {
            // 5-60% = invoice detail fetching
            progress = 5 + Math.round((syncProgress.done / syncProgress.total) * 55);
        } else if (syncProgress.phase === 'aggregating') {
            progress = 62;
        } else if (syncProgress.phase === 'warehouseStock' && syncProgress.total > 0) {
            // 65-95% = warehouse stock fetching
            progress = 65 + Math.round((syncProgress.done / syncProgress.total) * 30);
        } else if (syncProgress.phase === 'poOutstanding' && syncProgress.total > 0) {
            // 68-93% = PO outstanding fetching
            progress = 68 + Math.round((syncProgress.done / syncProgress.total) * 25);
        } else if (syncProgress.phase === 'done') {
            progress = 100;
        }
        return NextResponse.json({
            ...syncState,
            progress,
            message: syncProgress.message || syncState.message,
            phase: syncProgress.phase,
            elapsedSec: elapsed,
        });
    }
    return NextResponse.json(syncState);
}

// ─── POST: Start background sync ─────────────────────────────
export async function POST(request: NextRequest) {
    // Don't start if already running
    if (syncState.status === 'running') {
        return NextResponse.json(
            { error: 'Sync sudah berjalan', state: syncState },
            { status: 409 }
        );
    }

    const body = await request.json().catch(() => ({}));
    const fromDate = body.from ? new Date(body.from) : new Date(2025, 0, 1);
    const branchId = body.branch ? parseInt(body.branch) : undefined;

    // Reset progress tracker
    syncProgress.phase = '';
    syncProgress.done = 0;
    syncProgress.total = 0;
    syncProgress.message = '';

    // Reset state
    syncState = {
        status: 'running',
        progress: 0,
        phase: 'starting',
        message: `Memulai sync dari Accurate API...${branchId ? ` (Branch ${branchId})` : ''}`,
        startedAt: Date.now(),
    };

    // Start background sync (don't await — fire and forget)
    (async () => {
        try {
            // Phase 1+2: Fetch sales data (listing + details)
            const result = await fetchAllSalesData(fromDate, true, branchId);

            // Phase 3: Fetch warehouse stock for all items
            syncProgress.phase = 'warehouseStock';
            syncProgress.done = 0;
            syncProgress.message = 'Mengambil stock per gudang...';

            // Get all item numbers from inventory list
            const allItems = await fetchAllInventory();
            const itemNos = allItems.map(item => item.no).filter(Boolean);
            syncProgress.total = itemNos.length;

            const warehouseStockMap = await fetchWarehouseStock(itemNos, 10, (done, total) => {
                syncProgress.done = done;
                syncProgress.total = total;
                syncProgress.message = `Stock gudang: ${done}/${total} items`;
            });

            // Save warehouse stock cache
            await saveWarehouseStockCache(warehouseStockMap);

            // Phase 4: Fetch PO Outstanding
            syncProgress.phase = 'poOutstanding';
            syncProgress.done = 0;
            syncProgress.total = 0;
            syncProgress.message = 'Mengambil PO Outstanding...';

            const poResult = await fetchAllPOOutstanding(true, branchId, (done, total) => {
                syncProgress.done = done;
                syncProgress.total = total;
                syncProgress.message = `PO Outstanding: ${done}/${total} PO`;
            });

            syncProgress.phase = 'done';
            syncProgress.message = 'Selesai!';

            syncState = {
                status: 'done',
                progress: 100,
                phase: 'done',
                message: `Selesai! ${result.salesMap.size} item, ${result.invoiceCount} invoice, stock ${warehouseStockMap.size} gudang, ${poResult.poMap.size} PO outstanding`,
                startedAt: syncState.startedAt,
                completedAt: Date.now(),
                elapsedSec: syncState.startedAt ? Math.round((Date.now() - syncState.startedAt) / 1000) : 0,
                itemCount: result.salesMap.size,
                invoiceCount: result.invoiceCount,
            };
        } catch (err: any) {
            syncState = {
                status: 'error',
                progress: 0,
                phase: 'error',
                message: `Error: ${err.message}`,
                startedAt: syncState.startedAt,
                error: err.message,
            };
        }
    })();

    return NextResponse.json({ message: 'Sync dimulai', state: syncState });
}
