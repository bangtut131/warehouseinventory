import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fetchAllSalesData, fetchAllInventory, fetchWarehouseStock, saveWarehouseStockCache, syncProgress } from './accurate';

// ─── Config ──────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'scheduler-config.json');
const HISTORY_FILE = path.join(DATA_DIR, 'sync-history.json');
const MAX_HISTORY = 50;

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
    id: string;
    startedAt: string;
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

function ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

export function loadConfig(): SchedulerConfig {
    try {
        ensureDataDir();
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
            return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        }
    } catch (err: any) {
        console.warn('[Scheduler] Failed to load config:', err.message);
    }
    return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: SchedulerConfig): void {
    try {
        ensureDataDir();
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        console.log('[Scheduler] Config saved');
    } catch (err: any) {
        console.warn('[Scheduler] Failed to save config:', err.message);
    }
}

export function loadHistory(): SyncHistoryEntry[] {
    try {
        ensureDataDir();
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        }
    } catch {
        // ignore
    }
    return [];
}

function saveHistory(history: SyncHistoryEntry[]): void {
    try {
        ensureDataDir();
        const trimmed = history.slice(0, MAX_HISTORY);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
    } catch {
        // ignore
    }
}

function addHistoryEntry(entry: SyncHistoryEntry): void {
    const history = loadHistory();
    history.unshift(entry);
    saveHistory(history);
}

function updateHistoryEntry(id: string, updates: Partial<SyncHistoryEntry>): void {
    const history = loadHistory();
    const idx = history.findIndex(h => h.id === id);
    if (idx >= 0) {
        history[idx] = { ...history[idx], ...updates };
        saveHistory(history);
    }
}

// ─── Sync execution ─────────────────────────────────────────

export async function executeSyncJob(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
    const config = loadConfig();
    const entryId = `sync-${Date.now()}`;
    const startedAt = new Date().toISOString();

    console.log(`[Scheduler] Starting ${trigger} sync...`);

    addHistoryEntry({
        id: entryId,
        startedAt,
        completedAt: null,
        status: 'running',
        durationSec: null,
        itemCount: null,
        invoiceCount: null,
        error: null,
        trigger,
    });

    const start = Date.now();

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

        saveWarehouseStockCache(warehouseStockMap);

        syncProgress.phase = 'done';
        syncProgress.message = 'Auto-sync selesai!';

        const durationSec = Math.round((Date.now() - start) / 1000);

        updateHistoryEntry(entryId, {
            completedAt: new Date().toISOString(),
            status: 'success',
            durationSec,
            itemCount: result.salesMap.size,
            invoiceCount: result.invoiceCount,
        });

        console.log(`[Scheduler] Sync completed in ${durationSec}s — ${result.salesMap.size} items, ${result.invoiceCount} invoices`);
    } catch (err: any) {
        const durationSec = Math.round((Date.now() - start) / 1000);
        updateHistoryEntry(entryId, {
            completedAt: new Date().toISOString(),
            status: 'error',
            durationSec,
            error: err.message,
        });
        console.error(`[Scheduler] Sync failed after ${durationSec}s:`, err.message);
    }
}

// ─── Cron management ─────────────────────────────────────────

let cronTask: ReturnType<typeof cron.schedule> | null = null;
let isRunning = false;

export function startScheduler(): void {
    const config = loadConfig();

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

export function restartScheduler(): void {
    stopScheduler();
    startScheduler();
}

export function getSchedulerStatus(): {
    config: SchedulerConfig;
    isRunning: boolean;
    isSyncing: boolean;
    cronActive: boolean;
} {
    const config = loadConfig();
    return {
        config,
        isRunning: cronTask !== null,
        isSyncing: isRunning,
        cronActive: cronTask !== null && config.enabled,
    };
}

export function updateConfig(updates: Partial<SchedulerConfig>): SchedulerConfig {
    const config = loadConfig();
    const newConfig = { ...config, ...updates };
    saveConfig(newConfig);
    restartScheduler();
    return newConfig;
}
