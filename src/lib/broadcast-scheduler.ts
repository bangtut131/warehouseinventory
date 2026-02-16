import cron from 'node-cron';
import { prisma } from './prisma';
import { sendTextMessage, sendFileMessage, checkSession, WahaConfig } from './waha';
import { generateReorderReport, generateAlertReport } from './report-generator';
import { InventoryItem } from './types';
import axios from 'axios';

// ─── CONFIG ──────────────────────────────────────────────────

export interface BroadcastConfig {
    enabled: boolean;
    cronExpression: string;      // e.g. "0 7 * * 1-5" = weekdays 7am
    intervalLabel: string;       // friendly label for UI
    reportTypes: ('reorder' | 'alert-pdf')[];
    targetNumbers: string[];     // WA numbers to send to
    branchId: number | null;
    warehouseId: number | null;
    branchName?: string;
    warehouseName?: string;
    // WAHA connection
    wahaUrl: string;
    wahaSession: string;
    wahaApiKey: string;
}

const DEFAULT_CONFIG: BroadcastConfig = {
    enabled: false,
    cronExpression: '0 7 * * 1-5',
    intervalLabel: 'Senin-Jumat jam 07:00',
    reportTypes: ['reorder'],
    targetNumbers: [],
    branchId: null,
    warehouseId: null,
    wahaUrl: process.env.WAHA_API_URL || 'http://localhost:3000',
    wahaSession: process.env.WAHA_SESSION || 'default',
    wahaApiKey: process.env.WAHA_API_KEY || '',
};

// ─── CONFIG PERSISTENCE ──────────────────────────────────────

export async function loadBroadcastConfig(): Promise<BroadcastConfig> {
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: 'broadcast_config' },
        });
        if (setting?.value) {
            return { ...DEFAULT_CONFIG, ...(setting.value as any) };
        }
    } catch (err: any) {
        console.warn('[Broadcast] DB config load error:', err.message);
    }
    return { ...DEFAULT_CONFIG };
}

export async function saveBroadcastConfig(config: BroadcastConfig): Promise<void> {
    try {
        await prisma.systemSetting.upsert({
            where: { key: 'broadcast_config' },
            update: { value: config as any },
            create: { key: 'broadcast_config', value: config as any },
        });
        console.log('[Broadcast] Config saved');
    } catch (err: any) {
        console.error('[Broadcast] DB config save error:', err.message);
        throw err;
    }
}

// ─── BROADCAST EXECUTION ─────────────────────────────────────

/**
 * Fetch inventory data from our own API, then generate and send reports.
 */
export async function executeBroadcast(
    trigger: 'scheduled' | 'manual' = 'scheduled'
): Promise<{ success: boolean; error?: string; sentCount: number }> {
    const config = await loadBroadcastConfig();
    console.log(`[Broadcast] Starting ${trigger} broadcast...`);

    if (config.targetNumbers.length === 0) {
        console.warn('[Broadcast] No target numbers configured');
        return { success: false, error: 'Tidak ada nomor WA tujuan', sentCount: 0 };
    }

    if (config.reportTypes.length === 0) {
        console.warn('[Broadcast] No report types selected');
        return { success: false, error: 'Tidak ada jenis laporan dipilih', sentCount: 0 };
    }

    const wahaConfig: WahaConfig = {
        apiUrl: config.wahaUrl,
        session: config.wahaSession,
        apiKey: config.wahaApiKey || undefined,
    };

    // 1. Check WAHA session
    const sessionCheck = await checkSession(wahaConfig);
    if (!sessionCheck.ok) {
        const msg = `WAHA session not ready: ${sessionCheck.error || sessionCheck.status}`;
        console.error(`[Broadcast] ${msg}`);
        await logBroadcast(config, 'FAILED', msg, 0);
        return { success: false, error: msg, sentCount: 0 };
    }

    // 2. Fetch inventory data from our own API
    let items: InventoryItem[];
    try {
        const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const params: Record<string, string> = {};
        if (config.branchId) params.branch = config.branchId.toString();
        if (config.warehouseId) params.warehouse = config.warehouseId.toString();
        const qs = new URLSearchParams(params).toString();
        const url = `${baseUrl}/api/inventory${qs ? '?' + qs : ''}`;

        console.log(`[Broadcast] Fetching inventory data from ${url}`);
        const res = await axios.get(url, { timeout: 60000 });
        items = res.data;
        console.log(`[Broadcast] Got ${items.length} inventory items`);
    } catch (err: any) {
        const msg = `Failed to fetch inventory: ${err.message}`;
        console.error(`[Broadcast] ${msg}`);
        await logBroadcast(config, 'FAILED', msg, 0);
        return { success: false, error: msg, sentCount: 0 };
    }

    let sentCount = 0;
    const errors: string[] = [];

    // 3. Generate and send each report type
    for (const reportType of config.reportTypes) {
        try {
            if (reportType === 'reorder') {
                // Text report for reorder items
                const reorderItems = items.filter(i => i.status === 'CRITICAL' || i.status === 'REORDER');
                if (reorderItems.length === 0) {
                    console.log('[Broadcast] No reorder items — sending OK message');
                    const textMsg = `✅ *LAPORAN REORDER INVENTORY*\n${formatDate()}\n${config.branchName ? `Cabang: ${config.branchName}` : 'Semua Cabang'}\n\nSemua item stok dalam kondisi aman. Tidak ada item yang perlu di-reorder.`;
                    for (const target of config.targetNumbers) {
                        const r = await sendTextMessage(target, textMsg, wahaConfig);
                        if (r.ok) sentCount++;
                        else errors.push(`Text to ${target}: ${r.error}`);
                    }
                } else {
                    // Send reorder summary text + PDF
                    const critical = reorderItems.filter(i => i.status === 'CRITICAL');
                    const reorder = reorderItems.filter(i => i.status === 'REORDER');

                    let textMsg = `⚠️ *LAPORAN REORDER INVENTORY*\n${formatDate()}\n${config.branchName ? `Cabang: ${config.branchName}` : 'Semua Cabang'}\n\n`;
                    textMsg += `🔴 *Critical:* ${critical.length} item\n`;
                    textMsg += `🟠 *Reorder:* ${reorder.length} item\n\n`;

                    if (critical.length > 0) {
                        textMsg += `*Top Critical Items:*\n`;
                        critical.slice(0, 10).forEach((item, i) => {
                            textMsg += `${i + 1}. ${item.name} — Stock: ${item.stock}, ROP: ${item.reorderPoint}${item.suggestedOrder > 0 ? `, Order: ${item.suggestedOrder}` : ''}\n`;
                        });
                        if (critical.length > 10) textMsg += `... dan ${critical.length - 10} item lainnya\n`;
                    }

                    textMsg += `\n📄 PDF laporan lengkap terlampir.`;

                    // Send text first, then PDF
                    for (const target of config.targetNumbers) {
                        const r1 = await sendTextMessage(target, textMsg, wahaConfig);
                        if (r1.ok) sentCount++;
                        else errors.push(`Text to ${target}: ${r1.error}`);

                        // Generate and send PDF
                        const pdfBuffer = generateReorderReport(items, config.branchName, config.warehouseName);
                        const filename = `Reorder_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
                        const r2 = await sendFileMessage(target, pdfBuffer, filename, 'Laporan Reorder Inventory', 'application/pdf', wahaConfig);
                        if (r2.ok) sentCount++;
                        else errors.push(`PDF to ${target}: ${r2.error}`);
                    }
                }
            }

            if (reportType === 'alert-pdf') {
                // Full alert PDF report
                const pdfBuffer = generateAlertReport(items, config.branchName, config.warehouseName);
                const filename = `Alert_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
                const caption = `📊 *LAPORAN ALERT INVENTORY*\n${formatDate()}\n${config.branchName ? `Cabang: ${config.branchName}` : 'Semua Cabang'}`;

                for (const target of config.targetNumbers) {
                    const r = await sendFileMessage(target, pdfBuffer, filename, caption, 'application/pdf', wahaConfig);
                    if (r.ok) sentCount++;
                    else errors.push(`Alert PDF to ${target}: ${r.error}`);
                }
            }
        } catch (err: any) {
            errors.push(`Report ${reportType}: ${err.message}`);
        }
    }

    // 4. Log result
    const status = errors.length === 0 ? 'SUCCESS' : (sentCount > 0 ? 'SUCCESS' : 'FAILED');
    const logMsg = errors.length > 0 ? errors.join('; ') : `Sent ${sentCount} messages`;
    await logBroadcast(config, status, logMsg, items.length);

    console.log(`[Broadcast] Done: ${sentCount} sent, ${errors.length} errors`);
    return { success: errors.length === 0, error: errors.join('; ') || undefined, sentCount };
}

// ─── LOGGING ─────────────────────────────────────────────────

async function logBroadcast(config: BroadcastConfig, status: string, message: string, itemCount: number): Promise<void> {
    try {
        for (const type of config.reportTypes) {
            for (const target of config.targetNumbers) {
                await prisma.broadcastLog.create({
                    data: {
                        type,
                        status,
                        target,
                        branchId: config.branchId,
                        warehouseId: config.warehouseId,
                        message,
                        itemCount,
                    },
                });
            }
        }
    } catch (err: any) {
        console.error('[Broadcast] Log error:', err.message);
    }
}

// ─── DATE FORMATTING ─────────────────────────────────────────

function formatDate(): string {
    const now = new Date();
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${days[now.getDay()]}, ${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

// ─── CRON MANAGEMENT ─────────────────────────────────────────

let broadcastCron: ReturnType<typeof cron.schedule> | null = null;
let isBroadcasting = false;

export async function startBroadcastScheduler(): Promise<void> {
    const config = await loadBroadcastConfig();

    if (!config.enabled) {
        console.log('[Broadcast] Scheduler disabled');
        return;
    }

    if (!cron.validate(config.cronExpression)) {
        console.error(`[Broadcast] Invalid cron: ${config.cronExpression}`);
        return;
    }

    stopBroadcastScheduler();

    console.log(`[Broadcast] Starting cron: "${config.cronExpression}" (${config.intervalLabel})`);

    broadcastCron = cron.schedule(config.cronExpression, async () => {
        if (isBroadcasting) {
            console.log('[Broadcast] Skipping — previous broadcast still running');
            return;
        }
        isBroadcasting = true;
        try {
            await executeBroadcast('scheduled');
        } finally {
            isBroadcasting = false;
        }
    }, {
        timezone: 'Asia/Jakarta',
    });

    broadcastCron.start();
}

export function stopBroadcastScheduler(): void {
    if (broadcastCron) {
        broadcastCron.stop();
        broadcastCron = null;
        console.log('[Broadcast] Cron stopped');
    }
}

export async function restartBroadcastScheduler(): Promise<void> {
    stopBroadcastScheduler();
    await startBroadcastScheduler();
}

export async function getBroadcastStatus(): Promise<{
    config: BroadcastConfig;
    cronActive: boolean;
    isBroadcasting: boolean;
}> {
    const config = await loadBroadcastConfig();
    return {
        config,
        cronActive: broadcastCron !== null && config.enabled,
        isBroadcasting,
    };
}

export async function updateBroadcastConfig(updates: Partial<BroadcastConfig>): Promise<BroadcastConfig> {
    const config = await loadBroadcastConfig();
    const newConfig = { ...config, ...updates };
    await saveBroadcastConfig(newConfig);
    await restartBroadcastScheduler();
    return newConfig;
}
