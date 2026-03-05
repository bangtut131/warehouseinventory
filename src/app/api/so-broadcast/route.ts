export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkSession, sendTextMessage, WahaConfig } from '@/lib/waha';
import cron from 'node-cron';
import axios from 'axios';

// ─── Config ──────────────────────────────────────────────────

interface SOBroadcastConfig {
    enabled: boolean;
    cronExpression: string;
    intervalLabel: string;
    targetNumbers: string[];
    wahaUrl: string;
    wahaSession: string;
    wahaApiKey: string;
    soRegionalStatuses: string;
}

const CONFIG_KEY = 'so_broadcast_config';

const DEFAULT_CONFIG: SOBroadcastConfig = {
    enabled: false,
    cronExpression: '0 7 * * 1-5',
    intervalLabel: 'Senin-Jumat jam 07:00',
    targetNumbers: [],
    wahaUrl: process.env.WAHA_API_URL || 'http://localhost:3000',
    wahaSession: process.env.WAHA_SESSION || 'default',
    wahaApiKey: process.env.WAHA_API_KEY || '',
    soRegionalStatuses: 'menunggu,sebagian',
};

async function loadConfig(): Promise<SOBroadcastConfig> {
    try {
        const s = await prisma.systemSetting.findUnique({ where: { key: CONFIG_KEY } });
        if (s?.value) return { ...DEFAULT_CONFIG, ...(s.value as any) };
    } catch { }
    return { ...DEFAULT_CONFIG };
}

async function saveConfig(config: SOBroadcastConfig): Promise<void> {
    await prisma.systemSetting.upsert({
        where: { key: CONFIG_KEY },
        update: { value: config as any },
        create: { key: CONFIG_KEY, value: config as any },
    });
}

// ─── Message Formatter ───────────────────────────────────────

function fmtNum(n: number): string {
    return Math.round(n).toLocaleString('id-ID');
}

function formatDate(): string {
    const now = new Date();
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${days[now.getDay()]}, ${dd}/${mm}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const STATUS_LABELS: Record<string, string> = {
    'menunggu': 'Menunggu Diproses',
    'sebagian': 'Sebagian Diproses',
    'disetujui': 'Disetujui',
    'terproses': 'Terproses',
    'all': 'Semua Status',
};

function generateMessage(regional: any[], summary: any, statuses: string): string {
    const statusList = statuses.split(',').map(s => STATUS_LABELS[s.trim()] || s.trim()).join(' & ');
    let msg = `📦 *LAPORAN SO PER WILAYAH*\n${formatDate()}\nStatus: ${statusList}\n`;

    if (summary.dateFrom || summary.dateTo) {
        const from = summary.dateFrom ? summary.dateFrom.split('-').reverse().join('/') : '?';
        const to = summary.dateTo ? summary.dateTo.split('-').reverse().join('/') : '?';
        msg += `Periode: ${from} - ${to}\n`;
    }

    msg += `\n━━━━━━━━━━━━━━━━━━━━\n📊 *RINGKASAN*\n`;
    msg += `🏙 Kota: ${summary.totalCities} wilayah\n`;
    msg += `👥 Customer: ${fmtNum(summary.totalCustomers)}\n`;
    msg += `📋 Total SO: ${fmtNum(summary.totalSOs)}\n`;
    msg += `📦 Total Qty: ${fmtNum(summary.totalQty)}\n`;
    msg += `📦 Outstanding: ${fmtNum(summary.totalOutstanding)}\n`;

    const unitBd = summary.unitBreakdown || {};
    const unitKeys = Object.keys(unitBd).sort((a, b) => unitBd[b] - unitBd[a]);
    if (unitKeys.length > 0) {
        msg += `\n📦 *REKAP SATUAN:*\n`;
        const outBd = summary.outstandingBreakdown || {};
        for (const unit of unitKeys) {
            const out = outBd[unit] ? ` (sisa ${fmtNum(outBd[unit])})` : '';
            msg += `  ${unit}: ${fmtNum(unitBd[unit])}${out}\n`;
        }
    }

    const topN = Math.min(10, regional.length);
    if (topN > 0) {
        msg += `\n━━━━━━━━━━━━━━━━━━━━\n🏆 *TOP ${topN} WILAYAH*\n`;
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        for (let i = 0; i < topN; i++) {
            const r = regional[i];
            msg += `\n${emojis[i] || `${i + 1}.`} *${r.city}* (${r.customerCount} cust, ${r.soCount} SO)\n`;
            msg += `   Qty: ${fmtNum(r.totalQty)}  |  Sisa: ${fmtNum(r.totalOutstanding)}\n`;
            const cb = r.unitBreakdown || {};
            const co = r.outstandingBreakdown || {};
            const cUnits = Object.keys(cb).filter(u => cb[u] > 0);
            if (cUnits.length > 0) {
                const parts = cUnits.map(u => {
                    const out = co[u] ? ` (${fmtNum(co[u])})` : '';
                    return `${u}: ${fmtNum(cb[u])}${out}`;
                });
                msg += `   📦 ${parts.join(' | ')}\n`;
            }
        }
        if (regional.length > topN) msg += `\n_... dan ${regional.length - topN} wilayah lainnya_\n`;
    }

    if (summary.unmapped > 0) msg += `\n⚠️ _${summary.unmapped} SO belum terpetakan ke wilayah_\n`;
    msg += `\n━━━━━━━━━━━━━━━━━━━━\n📱 _Inventory Analysis System_`;
    return msg;
}

// ─── Broadcast Execution ─────────────────────────────────────

async function executeSOBroadcast(trigger: 'scheduled' | 'manual' = 'scheduled') {
    const config = await loadConfig();
    console.log(`[SO Broadcast] Starting ${trigger}...`);

    if (config.targetNumbers.length === 0) {
        console.warn('[SO Broadcast] No target numbers');
        return { success: false, error: 'Tidak ada nomor WA tujuan', sentCount: 0 };
    }

    const wahaConfig: WahaConfig = { apiUrl: config.wahaUrl, session: config.wahaSession, apiKey: config.wahaApiKey || undefined };
    const sessionCheck = await checkSession(wahaConfig);
    if (!sessionCheck.ok) {
        const msg = `WAHA session not ready: ${sessionCheck.error || sessionCheck.status}`;
        console.error(`[SO Broadcast] ${msg}`);
        return { success: false, error: msg, sentCount: 0 };
    }

    // Fetch SO Regional data
    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const url = `${baseUrl}/api/so-regional?status=${encodeURIComponent(config.soRegionalStatuses)}`;

    let regional: any[], summary: any;
    try {
        console.log(`[SO Broadcast] Fetching from ${url}`);
        const res = await axios.get(url, { timeout: 120000 });
        regional = res.data.regional;
        summary = res.data.summary;
    } catch (err: any) {
        const msg = `Failed to fetch SO data: ${err.message}`;
        console.error(`[SO Broadcast] ${msg}`);
        await logBroadcast(config, 'FAILED', msg);
        return { success: false, error: msg, sentCount: 0 };
    }

    const textMsg = generateMessage(regional, summary, config.soRegionalStatuses);
    let sentCount = 0;
    const errors: string[] = [];

    for (const target of config.targetNumbers) {
        const r = await sendTextMessage(target, textMsg, wahaConfig);
        if (r.ok) sentCount++;
        else errors.push(`${target}: ${r.error}`);
    }

    const status = sentCount > 0 ? 'SUCCESS' : 'FAILED';
    const logMsg = errors.length > 0 ? errors.join('; ') : `Sent ${sentCount} messages`;
    await logBroadcast(config, status, logMsg);
    console.log(`[SO Broadcast] Done: ${sentCount} sent, ${errors.length} errors`);
    return { success: errors.length === 0, error: errors.join('; ') || undefined, sentCount };
}

async function logBroadcast(config: SOBroadcastConfig, status: string, message: string) {
    try {
        for (const target of config.targetNumbers) {
            await prisma.broadcastLog.create({
                data: { type: 'so-regional', status, target, branchId: null, warehouseId: null, message, itemCount: 0 },
            });
        }
    } catch (err: any) {
        console.error('[SO Broadcast] Log error:', err.message);
    }
}

// ─── Cron ────────────────────────────────────────────────────

let soCron: ReturnType<typeof cron.schedule> | null = null;
let isBroadcasting = false;

async function startScheduler() {
    const config = await loadConfig();
    if (soCron) { soCron.stop(); soCron = null; }
    if (!config.enabled || !cron.validate(config.cronExpression)) return;

    console.log(`[SO Broadcast] Starting cron: "${config.cronExpression}" (${config.intervalLabel})`);
    soCron = cron.schedule(config.cronExpression, async () => {
        if (isBroadcasting) return;
        isBroadcasting = true;
        try { await executeSOBroadcast('scheduled'); } finally { isBroadcasting = false; }
    }, { timezone: 'Asia/Jakarta' });
    soCron.start();
}

let initialized = false;
async function ensureStarted() {
    if (!initialized) { initialized = true; await startScheduler(); }
}

// ─── API Routes ──────────────────────────────────────────────

export async function GET() {
    try {
        await ensureStarted();
        const config = await loadConfig();
        const logs = await prisma.broadcastLog.findMany({
            where: { type: 'so-regional' },
            orderBy: { sentAt: 'desc' },
            take: 20,
        });

        return NextResponse.json({
            config,
            cronActive: soCron !== null && config.enabled,
            isBroadcasting,
            history: logs.map(l => ({
                id: l.id, type: l.type, sentAt: l.sentAt.toISOString(),
                status: l.status, target: l.target, message: l.message,
            })),
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        await ensureStarted();
        const url = new URL(request.url);
        const action = url.searchParams.get('action');

        if (action === 'test-connection') {
            const body = await request.json();
            const wahaConfig: WahaConfig = { apiUrl: body.wahaUrl, session: body.wahaSession, apiKey: body.wahaApiKey || undefined };
            return NextResponse.json(await checkSession(wahaConfig));
        }

        if (action === 'trigger') {
            executeSOBroadcast('manual').catch(err => console.error('[SO Broadcast] Manual trigger error:', err.message));
            return NextResponse.json({ message: 'SO Broadcast dimulai' });
        }

        // Update config
        const body = await request.json();
        const current = await loadConfig();
        const newConfig = { ...current, ...body };
        await saveConfig(newConfig);
        if (soCron) { soCron.stop(); soCron = null; }
        await startScheduler();
        return NextResponse.json({ message: 'Config updated', config: newConfig });
    } catch (err: any) {
        console.error('[SO Broadcast API] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
