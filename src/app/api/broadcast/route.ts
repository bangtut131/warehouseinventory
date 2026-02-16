export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
    getBroadcastStatus,
    updateBroadcastConfig,
    executeBroadcast,
    startBroadcastScheduler,
    type BroadcastConfig,
} from '@/lib/broadcast-scheduler';
import { checkSession, sendTextMessage, WahaConfig } from '@/lib/waha';
import { prisma } from '@/lib/prisma';

// Lazy-init
let initialized = false;
async function ensureStarted() {
    if (!initialized) {
        initialized = true;
        await startBroadcastScheduler();
    }
}

// ─── GET: Get broadcast config + history ─────────────────────
export async function GET() {
    try {
        await ensureStarted();
        const status = await getBroadcastStatus();

        // Fetch recent broadcast logs
        const logs = await prisma.broadcastLog.findMany({
            orderBy: { sentAt: 'desc' },
            take: 30,
        });

        return NextResponse.json({
            ...status,
            history: logs.map(l => ({
                id: l.id,
                type: l.type,
                sentAt: l.sentAt.toISOString(),
                status: l.status,
                target: l.target,
                branchId: l.branchId,
                warehouseId: l.warehouseId,
                message: l.message,
                itemCount: l.itemCount,
            })),
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ─── POST: Update config, trigger broadcast, or test connection ──
export async function POST(request: NextRequest) {
    try {
        await ensureStarted();
        const url = new URL(request.url);
        const action = url.searchParams.get('action');

        // Test WAHA connection
        if (action === 'test-connection') {
            const body = await request.json();
            const wahaConfig: WahaConfig = {
                apiUrl: body.wahaUrl || 'http://localhost:3000',
                session: body.wahaSession || 'default',
                apiKey: body.wahaApiKey || undefined,
            };
            const result = await checkSession(wahaConfig);
            return NextResponse.json(result);
        }

        // Test send message
        if (action === 'test-send') {
            const body = await request.json();
            const wahaConfig: WahaConfig = {
                apiUrl: body.wahaUrl || 'http://localhost:3000',
                session: body.wahaSession || 'default',
                apiKey: body.wahaApiKey || undefined,
            };
            const testMsg = `✅ *Test Broadcast*\nInventory Analysis System\n${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\nKoneksi WAHA berhasil!`;
            const result = await sendTextMessage(body.targetNumber || '', testMsg, wahaConfig);
            return NextResponse.json(result);
        }

        // Trigger manual broadcast
        if (action === 'trigger') {
            executeBroadcast('manual').catch(err => {
                console.error('[Broadcast API] Manual trigger error:', err.message);
            });
            return NextResponse.json({ message: 'Broadcast dimulai' });
        }

        // Update config
        const body: Partial<BroadcastConfig> = await request.json();
        const newConfig = await updateBroadcastConfig(body);

        return NextResponse.json({
            message: 'Config updated',
            config: newConfig,
        });
    } catch (err: any) {
        console.error('[Broadcast API] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
