import cron from 'node-cron';
import { prisma } from './prisma';
import { fetchAllSalesData, fetchAllInventory, fetchWarehouseStock, saveWarehouseStockCache, fetchAllPOOutstanding, syncProgress } from './accurate';
import { sendTextMessage, checkSession, WahaConfig } from './waha';
import { loadBroadcastConfig } from './broadcast-scheduler';

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
    // WA Sync Report broadcast
    syncReportEnabled: boolean;
    syncReportTargets: string[];  // WA numbers to send sync report to
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
    syncReportEnabled: false,
    syncReportTargets: [],
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

        return logs.map(log => {
            // Parse itemCount and invoiceCount from message (format: "Items: N, Invoices: M, ...")
            let itemCount: number | null = null;
            let invoiceCount: number | null = null;
            if (log.message) {
                const itemMatch = log.message.match(/Items:\s*(\d+)/i);
                const invMatch = log.message.match(/Invoices:\s*(\d+)/i);
                if (itemMatch) itemCount = parseInt(itemMatch[1]);
                if (invMatch) invoiceCount = parseInt(invMatch[1]);
            }

            return {
                id: log.id,
                startedAt: log.startedAt.toISOString(),
                completedAt: log.completedAt ? log.completedAt.toISOString() : null,
                status: (log.status === 'SUCCESS' ? 'success' : log.status === 'FAILED' ? 'error' : 'running') as any,
                durationSec: log.completedAt ? Math.round((log.completedAt.getTime() - log.startedAt.getTime()) / 1000) : null,
                itemCount,
                invoiceCount,
                error: log.status === 'FAILED' ? log.message : null,
                trigger: log.trigger as any,
            };
        });
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

const STALE_LOCK_MS = 45 * 60 * 1000;   // 45 minutes — consider isRunning stale

/**
 * Execute sync job — simple, single-pass, same approach as Force Sync.
 * No timeout, no retry — just let it run to completion.
 * Cache is written by fetchAllSalesData/fetchAllPOOutstanding internally.
 */
export async function executeSyncJob(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
    const config = await loadConfig();
    const start = Date.now();
    const fromDate = new Date(config.fromDate);
    const branchId = config.branchId ?? undefined;

    console.log(`[Scheduler] Starting ${trigger} sync...`);
    const logId = await createLogEntry(trigger.toUpperCase());

    try {
        // Phase 1+2: Fetch sales data (listing + details + auto-save cache)
        syncProgress.phase = 'listing';
        syncProgress.message = 'Auto-sync: Mengambil daftar invoice...';
        const result = await fetchAllSalesData(fromDate, true, branchId);

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

        await saveWarehouseStockCache(warehouseStockMap);

        // Phase 4: Fetch PO Outstanding (non-critical)
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

        syncProgress.phase = 'done';
        syncProgress.message = 'Auto-sync selesai!';

        const durationSec = Math.round((Date.now() - start) / 1000);
        const msg = `Items: ${result.salesMap.size}, Invoices: ${result.invoiceCount}${poItemCount > 0 ? `, PO: ${poItemCount}` : ''} (${durationSec}s)`;

        await updateLogEntry(logId, 'SUCCESS', msg);
        console.log(`[Scheduler] Sync completed in ${durationSec}s — ${msg}`);

        // Send WA sync report on success
        await sendSyncReport({
            success: true,
            trigger,
            durationSec,
            itemCount: result.salesMap.size,
            invoiceCount: result.invoiceCount,
            poItemCount,
        });
    } catch (err: any) {
        syncProgress.phase = 'done';
        syncProgress.message = `Auto-sync GAGAL: ${err.message}`;

        const durationSec = Math.round((Date.now() - start) / 1000);
        await updateLogEntry(logId, 'FAILED', `${err.message} (${durationSec}s)`);
        console.error(`[Scheduler] Sync failed after ${durationSec}s:`, err.message);

        // Send WA sync report on failure
        await sendSyncReport({
            success: false,
            trigger,
            durationSec,
            error: err.message,
        });
    }
}

// ─── Sync Report WA Broadcast ────────────────────────────────

interface SyncReportData {
    success: boolean;
    trigger: 'scheduled' | 'manual';
    durationSec: number;
    itemCount?: number;
    invoiceCount?: number;
    poItemCount?: number;
    error?: string;
}

async function sendSyncReport(data: SyncReportData): Promise<void> {
    try {
        const config = await loadConfig();
        if (!config.syncReportEnabled || !config.syncReportTargets?.length) return;

        // Reuse WAHA config from broadcast settings
        const broadcastCfg = await loadBroadcastConfig();
        const wahaConfig: WahaConfig = {
            apiUrl: broadcastCfg.wahaUrl,
            session: broadcastCfg.wahaSession,
            apiKey: broadcastCfg.wahaApiKey || undefined,
        };

        // Check WAHA session
        const session = await checkSession(wahaConfig);
        if (!session.ok) {
            console.warn(`[Scheduler] WA sync report skipped — WAHA not ready: ${session.error || session.status}`);
            return;
        }

        // Format date
        const now = new Date();
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const dateStr = `${days[now.getDay()]}, ${dd}/${mm}/${yyyy} ${hh}:${min}`;

        // Format duration
        const durMin = Math.floor(data.durationSec / 60);
        const durSec = data.durationSec % 60;
        const durStr = durMin > 0 ? `${durMin}m ${durSec}s` : `${durSec}s`;

        // Build message
        let msg = '';
        if (data.success) {
            msg = `📊 *SYNC REPORT*\n${dateStr}\n\n`;
            msg += `✅ Status: *Sukses*\n`;
            msg += `⏱ Durasi: ${durStr}\n`;
            if (data.itemCount !== undefined) msg += `📦 Items: ${data.itemCount.toLocaleString('id-ID')}\n`;
            if (data.invoiceCount !== undefined && data.invoiceCount >= 0) {
                msg += `🧾 Faktur: ${data.invoiceCount.toLocaleString('id-ID')}\n`;
            }
            if (data.poItemCount && data.poItemCount > 0) {
                msg += `📋 PO Items: ${data.poItemCount.toLocaleString('id-ID')}\n`;
            }
            msg += `🔄 Trigger: ${data.trigger === 'scheduled' ? '⏰ Auto' : '👤 Manual'}`;
        } else {
            msg = `📊 *SYNC REPORT*\n${dateStr}\n\n`;
            msg += `❌ Status: *GAGAL*\n`;
            msg += `⏱ Durasi: ${durStr}\n`;
            msg += `🔄 Trigger: ${data.trigger === 'scheduled' ? '⏰ Auto' : '👤 Manual'}\n\n`;
            msg += `⚠️ Error:\n${data.error || 'Unknown error'}`;
        }

        // Send to all targets
        for (const target of config.syncReportTargets) {
            try {
                const result = await sendTextMessage(target, msg, wahaConfig);
                if (result.ok) {
                    console.log(`[Scheduler] Sync report sent to ${target}`);
                } else {
                    console.warn(`[Scheduler] Sync report failed to ${target}: ${result.error}`);
                }
            } catch (err: any) {
                console.warn(`[Scheduler] Sync report send error to ${target}:`, err.message);
            }
        }
    } catch (err: any) {
        // Non-critical — don't break sync flow
        console.warn('[Scheduler] Sync report broadcast error:', err.message);
    }
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
