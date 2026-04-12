import cron from 'node-cron';
import { prisma } from './prisma';
import { fetchAllSOData } from './accurate';

// ─── Config ──────────────────────────────────────────────────

export interface SOSchedulerConfig {
    enabled: boolean;
    cronExpression: string;
    intervalLabel: string;
    branchId: number | null;
}

const DEFAULT_CONFIG: SOSchedulerConfig = {
    enabled: false,
    cronExpression: '0 */6 * * *', // every 6 hours
    intervalLabel: 'Setiap 6 Jam',
    branchId: null,
};

const CONFIG_KEY = 'so_scheduler_config';

// ─── Config Helpers ──────────────────────────────────────────

export async function loadSOSchedulerConfig(): Promise<SOSchedulerConfig> {
    try {
        const setting = await prisma.systemSetting.findUnique({ where: { key: CONFIG_KEY } });
        if (setting && setting.value) {
            return { ...DEFAULT_CONFIG, ...(setting.value as any) };
        }
    } catch (err: any) {
        console.warn('[SO Scheduler] DB Load Error:', err.message);
    }
    return { ...DEFAULT_CONFIG };
}

export async function saveSOSchedulerConfig(config: SOSchedulerConfig): Promise<void> {
    try {
        await prisma.systemSetting.upsert({
            where: { key: CONFIG_KEY },
            update: { value: config as any },
            create: { key: CONFIG_KEY, value: config as any },
        });
        console.log('[SO Scheduler] Config saved');
    } catch (err: any) {
        console.error('[SO Scheduler] DB Save Error:', err.message);
        throw new Error('Database Error: ' + err.message);
    }
}

// ─── History ─────────────────────────────────────────────────

export interface SOSyncHistoryEntry {
    id: number;
    startedAt: string;
    completedAt: string | null;
    status: 'success' | 'error' | 'running';
    durationSec: number | null;
    soCount: number | null;
    error: string | null;
    trigger: 'scheduled' | 'manual';
}

export async function loadSOSyncHistory(): Promise<SOSyncHistoryEntry[]> {
    try {
        const logs = await prisma.syncLog.findMany({
            where: { trigger: { in: ['SCHEDULED_SO', 'MANUAL_SO'] } },
            orderBy: { startedAt: 'desc' },
            take: 50,
        });
        return logs.map(log => {
            let soCount: number | null = null;
            if (log.message) {
                const match = log.message.match(/SOs:\s*(\d+)/i);
                if (match) soCount = parseInt(match[1]);
            }
            return {
                id: log.id,
                startedAt: log.startedAt.toISOString(),
                completedAt: log.completedAt ? log.completedAt.toISOString() : null,
                status: (log.status === 'SUCCESS' ? 'success' : log.status === 'FAILED' ? 'error' : 'running') as any,
                durationSec: log.completedAt ? Math.round((log.completedAt.getTime() - log.startedAt.getTime()) / 1000) : null,
                soCount,
                error: log.status === 'FAILED' ? log.message : null,
                trigger: log.trigger === 'SCHEDULED_SO' ? 'scheduled' : 'manual',
            };
        });
    } catch (err: any) {
        console.warn('[SO Scheduler] History load error:', err.message);
        return [];
    }
}

async function createSOLogEntry(trigger: string): Promise<number> {
    try {
        const log = await prisma.syncLog.create({
            data: { status: 'RUNNING', trigger, message: null },
        });
        return log.id;
    } catch (err) {
        console.error('[SO Scheduler] Failed to create log', err);
        return 0;
    }
}

async function updateSOLogEntry(id: number, status: string, message?: string | null): Promise<void> {
    if (!id) return;
    try {
        await prisma.syncLog.update({
            where: { id },
            data: { status, completedAt: new Date(), message },
        });
    } catch (err) {
        console.error('[SO Scheduler] Failed to update log', err);
    }
}

// ─── Sync Execution ─────────────────────────────────────────

const STALE_LOCK_MS = 30 * 60 * 1000; // 30 minutes

export async function executeSOSyncJob(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
    const config = await loadSOSchedulerConfig();
    const start = Date.now();
    const branchId = config.branchId ?? undefined;
    const triggerKey = trigger === 'scheduled' ? 'SCHEDULED_SO' : 'MANUAL_SO';

    console.log(`[SO Scheduler] Starting ${trigger} SO sync...`);
    const logId = await createSOLogEntry(triggerKey);

    try {
        const result = await fetchAllSOData(true, branchId, undefined, undefined, undefined, (done, total) => {
            // Progress callback (not used by scheduler but available)
        });

        const durationSec = Math.round((Date.now() - start) / 1000);
        let msg = `SOs: ${result.soList.length}, Total: ${result.soCount} (${durationSec}s)`;
        if (result.failedSOs && result.failedSOs.length > 0) {
            msg += ` | Gagal: ${result.failedSOs.slice(0, 5).join(', ')}${result.failedSOs.length > 5 ? ' dll' : ''}`;
        }

        await updateSOLogEntry(logId, 'SUCCESS', msg);
        console.log(`[SO Scheduler] Sync completed in ${durationSec}s — ${msg}`);
    } catch (err: any) {
        const durationSec = Math.round((Date.now() - start) / 1000);
        await updateSOLogEntry(logId, 'FAILED', `${err.message} (${durationSec}s)`);
        console.error(`[SO Scheduler] Sync failed after ${durationSec}s:`, err.message);
    }
}

// ─── Cron Management ─────────────────────────────────────────

let soCronTask: ReturnType<typeof cron.schedule> | null = null;
let soIsRunning = false;
let soIsRunningTimestamp = 0;
let soSchedulerInitialized = false;

export async function startSOScheduler(): Promise<void> {
    if (soSchedulerInitialized && soCronTask) {
        console.log('[SO Scheduler] Already initialized — skipping');
        return;
    }
    soSchedulerInitialized = true;

    const config = await loadSOSchedulerConfig();

    if (!config.enabled) {
        console.log('[SO Scheduler] Disabled — not starting cron');
        return;
    }

    if (!cron.validate(config.cronExpression)) {
        console.error(`[SO Scheduler] Invalid cron: ${config.cronExpression}`);
        return;
    }

    stopSOScheduler();

    console.log(`[SO Scheduler] Starting cron: "${config.cronExpression}" (${config.intervalLabel})`);

    soCronTask = cron.schedule(config.cronExpression, async () => {
        if (soIsRunning) {
            const staleDuration = Date.now() - soIsRunningTimestamp;
            if (staleDuration > STALE_LOCK_MS) {
                console.warn(`[SO Scheduler] Force-resetting stale lock (${Math.round(staleDuration / 60000)}min)`);
                soIsRunning = false;
            } else {
                console.log('[SO Scheduler] Skipping — previous sync still running');
                return;
            }
        }
        soIsRunning = true;
        soIsRunningTimestamp = Date.now();
        try {
            await executeSOSyncJob('scheduled');
        } finally {
            soIsRunning = false;
            soIsRunningTimestamp = 0;
        }
    }, {
        timezone: 'Asia/Jakarta',
    });

    soCronTask.start();
}

export function stopSOScheduler(): void {
    if (soCronTask) {
        soCronTask.stop();
        soCronTask = null;
        console.log('[SO Scheduler] Cron stopped');
    }
}

export async function restartSOScheduler(): Promise<void> {
    stopSOScheduler();
    soSchedulerInitialized = false;
    await startSOScheduler();
}

export async function getSOSchedulerStatus(): Promise<{
    config: SOSchedulerConfig;
    isRunning: boolean;
    isSyncing: boolean;
    cronActive: boolean;
}> {
    const config = await loadSOSchedulerConfig();
    return {
        config,
        isRunning: soCronTask !== null,
        isSyncing: soIsRunning,
        cronActive: soCronTask !== null && config.enabled,
    };
}

export async function updateSOSchedulerConfig(updates: Partial<SOSchedulerConfig>): Promise<SOSchedulerConfig> {
    const config = await loadSOSchedulerConfig();
    const newConfig = { ...config, ...updates };
    await saveSOSchedulerConfig(newConfig);
    await restartSOScheduler();
    return newConfig;
}
