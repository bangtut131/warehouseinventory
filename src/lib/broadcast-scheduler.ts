import cron from 'node-cron';
import { prisma } from './prisma';
import { sendTextMessage, sendFileMessage, checkSession, WahaConfig } from './waha';
import { generateReorderReport, generateAlertReport } from './report-generator';
import { InventoryItem } from './types';
import axios from 'axios';

export type StockUnit = 'pcs' | 'box';

/** Convert qty based on unit preference */
function convertStock(qty: number, item: InventoryItem, unit: StockUnit): string {
    if (unit === 'pcs' || !item.unitConversion || item.unitConversion <= 1) {
        return Math.round(qty).toLocaleString('id-ID');
    }
    const converted = qty / item.unitConversion;
    if (Number.isInteger(converted)) return converted.toLocaleString('id-ID');
    return converted.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Get unit label based on preference */
function getUnit(item: InventoryItem, unit: StockUnit): string {
    if (unit === 'pcs') return item.unit || 'Pcs';
    if (item.salesUnitName) return item.salesUnitName;
    return 'Box';
}

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
    stockUnit: StockUnit;
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
    stockUnit: 'pcs',
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
        // Use explicit env URL if set, otherwise use internal localhost with correct port
        const baseUrl = process.env.NEXTAUTH_URL
            || process.env.NEXT_PUBLIC_BASE_URL
            || `http://localhost:${process.env.PORT || 3000}`;
        const params: Record<string, string> = {};
        if (config.branchId) params.branch = config.branchId.toString();
        if (config.warehouseId) params.warehouse = config.warehouseId.toString();
        const qs = new URLSearchParams(params).toString();
        const url = `${baseUrl}/api/inventory${qs ? '?' + qs : ''}`;

        console.log(`[Broadcast] Fetching inventory data from ${url}`);
        const res = await axios.get(url, { timeout: 120000 });
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
                const criticalItems = items.filter(i => i.status === 'CRITICAL');
                const reorderItems = items.filter(i => i.status === 'REORDER');
                const allReorderItems = [...criticalItems, ...reorderItems];

                if (allReorderItems.length === 0) {
                    console.log('[Broadcast] No reorder items — sending OK message');
                    const textMsg = `✅ *LAPORAN REORDER INVENTORY*\n${formatDate()}\n${config.branchName ? `Cabang: ${config.branchName}` : 'Semua Cabang'}${config.warehouseName ? `\nGudang: ${config.warehouseName}` : ''}\n\nSemua item stok dalam kondisi aman. Tidak ada item yang perlu di-reorder.`;
                    for (const target of config.targetNumbers) {
                        const r = await sendTextMessage(target, textMsg, wahaConfig);
                        if (r.ok) sentCount++;
                        else errors.push(`Text to ${target}: ${r.error}`);
                    }
                } else {
                    // Build comprehensive text report
                    let textMsg = `⚠️ *LAPORAN REORDER INVENTORY*\n${formatDate()}\n${config.branchName ? `Cabang: ${config.branchName}` : 'Semua Cabang'}${config.warehouseName ? `\nGudang: ${config.warehouseName}` : ''}\n\n`;
                    textMsg += `🔴 *Critical:* ${criticalItems.length} item\n`;
                    textMsg += `🟠 *Reorder:* ${reorderItems.length} item\n`;

                    const su = config.stockUnit || 'pcs';

                    // Top 10 Critical Items
                    if (criticalItems.length > 0) {
                        textMsg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
                        textMsg += `🔴 *TOP ${Math.min(10, criticalItems.length)} CRITICAL ITEMS:*\n\n`;
                        criticalItems.slice(0, 10).forEach((item, i) => {
                            textMsg += `${i + 1}. *${item.name}*\n`;
                            textMsg += `   📦 Stock: ${convertStock(item.stock, item, su)} ${getUnit(item, su)} | ROP: ${convertStock(item.reorderPoint, item, su)}\n`;
                            textMsg += `   🛡️ Safety: ${convertStock(item.safetyStock, item, su)}`;
                            if (item.poOutstanding > 0) textMsg += ` | PO: +${convertStock(item.poOutstanding, item, su)}`;
                            if (item.suggestedOrder > 0) textMsg += ` | 📋 Order: ${convertStock(item.suggestedOrder, item, su)}`;
                            textMsg += `\n`;
                        });
                        if (criticalItems.length > 10) {
                            textMsg += `\n_... dan ${criticalItems.length - 10} item critical lainnya_\n`;
                        }
                    }

                    // Full Reorder Items List
                    if (reorderItems.length > 0) {
                        textMsg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
                        textMsg += `🟠 *DAFTAR REORDER (${reorderItems.length} item):*\n\n`;
                        reorderItems.forEach((item, i) => {
                            textMsg += `${i + 1}. *${item.name}*\n`;
                            textMsg += `   📦 Stock: ${convertStock(item.stock, item, su)} ${getUnit(item, su)} | ROP: ${convertStock(item.reorderPoint, item, su)}`;
                            if (item.suggestedOrder > 0) textMsg += ` | Order: ${convertStock(item.suggestedOrder, item, su)}`;
                            textMsg += `\n`;
                        });
                    }

                    textMsg += `\n━━━━━━━━━━━━━━━━━━━━\n📄 _PDF laporan lengkap terlampir._`;

                    // Send text first, then PDF
                    for (const target of config.targetNumbers) {
                        // Send text
                        const r1 = await sendTextMessage(target, textMsg, wahaConfig);
                        if (r1.ok) sentCount++;
                        else errors.push(`Text to ${target}: ${r1.error}`);

                        // Small delay before sending PDF
                        await new Promise(resolve => setTimeout(resolve, 2000));

                        // Generate and send PDF
                        try {
                            const pdfBuffer = await generateReorderReport(items, config.branchName, config.warehouseName, config.stockUnit);
                            console.log(`[Broadcast] PDF generated: ${pdfBuffer.length} bytes`);
                            const filename = `Reorder_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
                            const r2 = await sendFileMessage(target, pdfBuffer, filename, 'Laporan Reorder Inventory', 'application/pdf', wahaConfig);
                            if (r2.ok) {
                                sentCount++;
                                console.log(`[Broadcast] PDF sent to ${target}`);
                            } else {
                                errors.push(`PDF to ${target}: ${r2.error}`);
                                console.error(`[Broadcast] PDF send failed to ${target}: ${r2.error}`);
                            }
                        } catch (pdfErr: any) {
                            errors.push(`PDF generation/send to ${target}: ${pdfErr.message}`);
                            console.error(`[Broadcast] PDF error:`, pdfErr.message);
                        }
                    }
                }
            }

            if (reportType === 'alert-pdf') {
                // Full alert PDF report
                try {
                    const pdfBuffer = await generateAlertReport(items, config.branchName, config.warehouseName, config.stockUnit);
                    console.log(`[Broadcast] Alert PDF generated: ${pdfBuffer.length} bytes`);
                    const filename = `Alert_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
                    const caption = `📊 *LAPORAN ALERT INVENTORY*\n${formatDate()}\n${config.branchName ? `Cabang: ${config.branchName}` : 'Semua Cabang'}`;

                    for (const target of config.targetNumbers) {
                        const r = await sendFileMessage(target, pdfBuffer, filename, caption, 'application/pdf', wahaConfig);
                        if (r.ok) sentCount++;
                        else {
                            errors.push(`Alert PDF to ${target}: ${r.error}`);
                            console.error(`[Broadcast] Alert PDF send failed to ${target}: ${r.error}`);
                        }
                    }
                } catch (pdfErr: any) {
                    errors.push(`Alert PDF generation: ${pdfErr.message}`);
                    console.error(`[Broadcast] Alert PDF error:`, pdfErr.message);
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
