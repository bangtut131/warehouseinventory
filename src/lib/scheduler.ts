import cron from 'node-cron';
import { prisma } from './prisma';
import { fetchAllSalesData, fetchAllInventory, fetchWarehouseStock, saveWarehouseStockCache, syncProgress } from './accurate';

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
    const setting = await prisma.systemSetting.findUnique({
        where: { key: 'scheduler_config' },
    });
    if (setting && setting.value) {
        return { ...DEFAULT_CONFIG, ...(setting.value as any) };
    }
    return { ...DEFAULT_CONFIG };
}

export async function saveConfig(config: SchedulerConfig): Promise<void> {
    await prisma.systemSetting.upsert({
        where: { key: 'scheduler_config' },
        update: { value: config as any },
        create: { key: 'scheduler_config', value: config as any },
    });
    console.log('[Scheduler] Config saved to DB');
}

export async function loadHistory(): Promise<SyncHistoryEntry[]> {
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
        itemCount: null, // We might want to add these columns to SyncLog if needed, for now simplified
        invoiceCount: null,
        error: log.status === 'FAILED' ? log.message : null,
        trigger: log.trigger as any,
    }));
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

export async function executeSyncJob(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
    const config = await loadConfig();
    const start = Date.now();

    console.log(`[Scheduler] Starting ${trigger} sync...`);
    const logId = await createLogEntry(trigger.toUpperCase());

    try {
        const fromDate = new Date(config.fromDate);
        const branchId = config.branchId ?? undefined;

        // Phase 1+2: Fetch sales data
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

        syncProgress.phase = 'done';
        syncProgress.message = 'Auto-sync selesai!';

        const durationSec = Math.round((Date.now() - start) / 1000);
        await updateLogEntry(logId, 'SUCCESS', `Items: ${result.salesMap.size}, Invoices: ${result.invoiceCount}`);

        console.log(`[Scheduler] Sync completed in ${durationSec}s — ${result.salesMap.size} items, ${result.invoiceCount} invoices`);
    } catch (err: any) {
        const durationSec = Math.round((Date.now() - start) / 1000);
        await updateLogEntry(logId, 'FAILED', err.message);
        console.error(`[Scheduler] Sync failed after ${durationSec}s:`, err.message);
    }
}

// ─── Cron management ─────────────────────────────────────────

let cronTask: ReturnType<typeof cron.schedule> | null = null;
let isRunning = false;

export async function startScheduler(): Promise<void> {
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
        if (isRunning) {
            console.log('[Scheduler] Skipping — previous sync still running');
            return;
        }
        isRunning = true;
        try {
            await executeSyncJob('scheduled');
        } finally {
            isRunning = false;
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
