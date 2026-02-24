import cron from 'node-cron';
import { prisma } from './prisma';
import { fetchAllSalesData, fetchAllInventory, fetchWarehouseStock, saveWarehouseStockCache, saveSalesCache, fetchAllPOOutstanding, syncProgress } from './accurate';

// ─── Config ──────────────────────────────────────────────────

export interface SchedulerConfig {
    enabled: boolean;
    // Cron expression, e.g. "0 */4 * * *" = every 4 hours
    cronExpression: string;
    // Friendly label for UI dropdown
    intervalLabel: string;
    // Branch ID to sync, null = all branches
    branchId: number | null;
    // Start date for sales data (ISO string)
    fromDate: string;
}

export interface SyncHistoryEntry {
    id: number; // Changed to number (Int in DB)
    startedAt: string; // ISO string
    completedAt: string | null;
    status: 'success' | 'error' | 'running';
    durationSec: number | null;
    itemCount: number | null;
    invoiceCount: number | null;
    error: string | null;
    trigger: 'scheduled' | 'manual';
}

// ─── Defaults ────────────────────────────────────────────────

const DEFAULT_CONFIG: SchedulerConfig = {
    enabled: false,
    cronExpression: '0 */4 * * *', // every 4 hours
    intervalLabel: 'Setiap 4 Jam',
    branchId: null,
    fromDate: '2025-01-01',
};

// ─── Helpers ─────────────────────────────────────────────────

export async function loadConfig(): Promise<SchedulerConfig> {
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'scheduler_config' },
        });
        if (setting && setting.value) {
            return { ...DEFAULT_CONFIG, ...(setting.value as any) };
        }
    } catch (err: any) {
        console.warn('[Scheduler] DB Load Error (using default):', err.message);
    }
    return { ...DEFAULT_CONFIG };
}

export async function saveConfig(config: SchedulerConfig): Promise<void> {
    try {
        await prisma.systemSetting.upsert({
            where: { key: 'scheduler_config' },
            update: { value: config as any },
            create: { key: 'scheduler_config', value: config as any },
        });
        console.log('[Scheduler] Config saved to DB');
    } catch (err: any) {
        console.error('[Scheduler] DB Save Error:', err.message);
        throw new Error('Database Error: ' + err.message);
    }
}

export async function loadHistory(): Promise<SyncHistoryEntry[]> {
    try {
        const logs = await prisma.syncLog.findMany({
            orderBy: { startedAt: 'desc' },
            take: 50,
        });

        return logs.map(log => ({
            id: log.id,
            startedAt: log.startedAt.toISOString(),
            completedAt: log.completedAt ? log.completedAt.toISOString() : null,
            status: log.status as any,
            durationSec: log.completedAt ? Math.round((log.completedAt.getTime() - log.startedAt.getTime()) / 1000) : null,
            itemCount: null,
            invoiceCount: null,
            error: log.status === 'FAILED' ? log.message : null,
            trigger: log.trigger as any,
        }));
    } catch (err: any) {
        console.warn('[Scheduler] DB History Error:', err.message);
        return [];
    }
}

// Internal helper for adding logs
async function createLogEntry(trigger: string): Promise<number> {
    try {
        const log = await prisma.syncLog.create({
            data: {
                status: 'RUNNING',
                trigger,
                message: null,
            },
        });
        return log.id;
    } catch (err) {
        console.error('Failed to create sync log', err);
        return 0;
    }
}

async function updateLogEntry(id: number, status: string, message?: string | null): Promise<void> {
    if (!id) return;
    try {
        await prisma.syncLog.update({
            where: { id },
            data: {
                status,
                completedAt: new Date(), // Assuming update happens at completion
                message,
            },
        });
    } catch (err) {
        console.error('Failed to update sync log', err);
    }
}

// ─── Sync execution ─────────────────────────────────────────

const JOB_TIMEOUT_MS = 15 * 60 * 1000;  // 15 minutes max per sync attempt
const RETRY_DELAY_MS = 2 * 60 * 1000;   // 2 minutes between retries
const MAX_RETRIES = 3;
const STALE_LOCK_MS = 20 * 60 * 1000;   // 20 minutes — consider isRunning stale

/**
 * Core sync logic — runs ALL phases and returns results in memory.
 * Does NOT write to cache. Throws on any critical failure.
 */
async function executeSyncPhases(config: SchedulerConfig) {
    const fromDate = new Date(config.fromDate);
    const branchId = config.branchId ?? undefined;

    // Phase 1+2: Fetch sales data (listing + details) — skipCacheOps=true for atomicity
    syncProgress.phase = 'listing';
    syncProgress.message = 'Auto-sync: Mengambil daftar invoice...';
    const result = await fetchAllSalesData(fromDate, true, branchId, true); // skipCacheOps=true!

    // Phase 3: Fetch warehouse stock
    syncProgress.phase = 'warehouseStock';
    syncProgress.done = 0;
    syncProgress.message = 'Auto-sync: Mengambil stock per gudang...';

    const allItems = await fetchAllInventory();
    const itemNos = allItems.map(item => item.no).filter(Boolean);
    syncProgress.total = itemNos.length;

    const warehouseStockMap = await fetchWarehouseStock(itemNos, 10, (done, total) => {
        syncProgress.done = done;
        syncProgress.total = total;
        syncProgress.message = `Auto-sync: Stock gudang ${done}/${total}`;
    });

    // Phase 4: Fetch PO Outstanding (non-critical — failure doesn't abort sync)
    let poItemCount = 0;
    try {
        syncProgress.phase = 'poOutstanding';
        syncProgress.done = 0;
        syncProgress.total = 0;
        syncProgress.message = 'Auto-sync: Mengambil PO Outstanding...';

        const poResult = await fetchAllPOOutstanding(true, branchId, (done, total) => {
            syncProgress.done = done;
            syncProgress.total = total;
            syncProgress.message = `Auto-sync: PO Outstanding ${done}/${total}`;
        });
        poItemCount = poResult.poMap.size;
    } catch (poErr: any) {
        console.warn('[Scheduler] PO Outstanding fetch failed (non-critical):', poErr.message);
    }

    // Return everything — caller decides when to write cache
    return { result, warehouseStockMap, poItemCount, fromDate, branchId };
}

/**
 * Single sync attempt with job timeout.
 * Returns results if success, throws on failure/timeout.
 */
async function attemptSync(config: SchedulerConfig) {
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Sync timeout: exceeded ${JOB_TIMEOUT_MS / 60000} minutes`)), JOB_TIMEOUT_MS);
    });

    // Race the sync against the timeout
    return Promise.race([
        executeSyncPhases(config),
        timeoutPromise,
    ]);
}

/**
 * Main entry point: Execute sync with atomic cache write + auto-retry.
 * - All data is collected in memory first
 * - Cache is written ONLY if ALL phases succeed
 * - On failure, retries up to MAX_RETRIES times
 */
export async function executeSyncJob(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
    const config = await loadConfig();
    const start = Date.now();

    console.log(`[Scheduler] Starting ${trigger} sync...`);
    const logId = await createLogEntry(trigger.toUpperCase());

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (attempt > 1) {
                console.log(`[Scheduler] Retry attempt ${attempt}/${MAX_RETRIES}...`);
                await updateLogEntry(logId, 'RETRYING', `Attempt ${attempt}/${MAX_RETRIES}`);
                syncProgress.message = `Auto-sync: Retry ${attempt}/${MAX_RETRIES}...`;
            }

            // ── Run all phases (data stays in memory) ──
            const { result, warehouseStockMap, poItemCount, fromDate, branchId } = await attemptSync(config);

            // ── ALL phases succeeded → NOW write ALL caches (truly atomic) ──
            syncProgress.phase = 'done';
            syncProgress.message = 'Auto-sync: Menyimpan cache...';

            // Save sales cache (was skipped during fetch due to skipCacheOps=true)
            await saveSalesCache(fromDate, result.salesMap, branchId);
            // Save warehouse stock cache
            await saveWarehouseStockCache(warehouseStockMap);

            const durationSec = Math.round((Date.now() - start) / 1000);
            const msg = `Items: ${result.salesMap.size}, Invoices: ${result.invoiceCount}${poItemCount > 0 ? `, PO: ${poItemCount}` : ''}${attempt > 1 ? ` (after ${attempt} attempts)` : ''}`;

            await updateLogEntry(logId, 'SUCCESS', msg);
            syncProgress.message = 'Auto-sync selesai!';

            console.log(`[Scheduler] Sync completed in ${durationSec}s — ${msg}`);
            return; // ✅ Success — exit

        } catch (err: any) {
            lastError = err;
            const durationSec = Math.round((Date.now() - start) / 1000);
            console.error(`[Scheduler] Attempt ${attempt}/${MAX_RETRIES} failed after ${durationSec}s:`, err.message);

            if (attempt < MAX_RETRIES) {
                // Wait before retrying
                syncProgress.message = `Auto-sync gagal, retry dalam ${RETRY_DELAY_MS / 60000} menit... (${attempt}/${MAX_RETRIES})`;
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            }
        }
    }

    // ❌ All retries exhausted
    const durationSec = Math.round((Date.now() - start) / 1000);
    await updateLogEntry(logId, 'FAILED', `${lastError?.message || 'Unknown error'} (after ${MAX_RETRIES} attempts, ${durationSec}s)`);
    syncProgress.phase = 'done';
    syncProgress.message = `Auto-sync GAGAL setelah ${MAX_RETRIES}x percobaan.`;
    console.error(`[Scheduler] Sync FAILED after ${MAX_RETRIES} attempts (${durationSec}s total)`);
}

// ─── Cron management ─────────────────────────────────────────

let cronTask: ReturnType<typeof cron.schedule> | null = null;
let isRunning = false;
let isRunningTimestamp = 0; // Track when isRunning was set to detect stale locks
let schedulerInitialized = false;

export async function startScheduler(): Promise<void> {
    // Guard: prevent duplicate cron registration from multiple call sites
    if (schedulerInitialized && cronTask) {
        console.log('[Scheduler] Already initialized — skipping duplicate start');
        return;
    }
    schedulerInitialized = true;

    const config = await loadConfig();

    if (!config.enabled) {
        console.log('[Scheduler] Disabled — not starting cron');
        return;
    }

    if (!cron.validate(config.cronExpression)) {
        console.error(`[Scheduler] Invalid cron expression: ${config.cronExpression}`);
        return;
    }

    // Stop existing task if any
    stopScheduler();

    console.log(`[Scheduler] Starting cron: "${config.cronExpression}" (${config.intervalLabel})`);

    cronTask = cron.schedule(config.cronExpression, async () => {
        // Stale lock detection: if isRunning for > 20 minutes, force-reset
        if (isRunning) {
            const staleDuration = Date.now() - isRunningTimestamp;
            if (staleDuration > STALE_LOCK_MS) {
                console.warn(`[Scheduler] Force-resetting stale isRunning lock (was stuck for ${Math.round(staleDuration / 60000)}min)`);
                isRunning = false;
            } else {
                console.log('[Scheduler] Skipping — previous sync still running');
                return;
            }
        }
        isRunning = true;
        isRunningTimestamp = Date.now();
        try {
            await executeSyncJob('scheduled');
        } finally {
            isRunning = false;
            isRunningTimestamp = 0;
        }
    }, {
        timezone: 'Asia/Jakarta',
    });

    cronTask.start();
}

export function stopScheduler(): void {
    if (cronTask) {
        cronTask.stop();
        cronTask = null;
        console.log('[Scheduler] Cron stopped');
    }
}

export async function restartScheduler(): Promise<void> {
    stopScheduler();
    schedulerInitialized = false; // Allow re-initialization on restart
    await startScheduler();
}

export async function getSchedulerStatus(): Promise<{
    config: SchedulerConfig;
    isRunning: boolean;
    isSyncing: boolean;
    cronActive: boolean;
}> {
    const config = await loadConfig();
    return {
        config,
        isRunning: cronTask !== null,
        isSyncing: isRunning,
        cronActive: cronTask !== null && config.enabled,
    };
}

export async function updateConfig(updates: Partial<SchedulerConfig>): Promise<SchedulerConfig> {
    const config = await loadConfig();
    const newConfig = { ...config, ...updates };
    await saveConfig(newConfig);
    await restartScheduler();
    return newConfig;
}
