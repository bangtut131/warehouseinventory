export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
    getSchedulerStatus,
    updateConfig,
    loadHistory,
    executeSyncJob,
    startScheduler,
    type SchedulerConfig,
} from '@/lib/scheduler';

// Lazy-init: start scheduler on first API access
let initialized = false;
async function ensureSchedulerStarted() {
    if (!initialized) {
        initialized = true;
        await startScheduler();
    }
}

// ─── GET: Get scheduler status + history ─────────────────────
export async function GET() {
    try {
        await ensureSchedulerStarted();
        const status = await getSchedulerStatus();
        const history = await loadHistory();

        return NextResponse.json({
            ...status,
            history: history.slice(0, 20),
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ─── POST: Update config or trigger manual sync ──────────────
export async function POST(request: NextRequest) {
    try {
        await ensureSchedulerStarted();
        const url = new URL(request.url);
        const action = url.searchParams.get('action');

        // Manual trigger
        if (action === 'trigger') {
            executeSyncJob('manual').catch(err => {
                console.error('[Scheduler API] Manual sync error:', err.message);
            });
            return NextResponse.json({ message: 'Sync manual dimulai' });
        }

        // Update config
        const body: Partial<SchedulerConfig> = await request.json();
        const newConfig = await updateConfig(body);

        return NextResponse.json({
            message: 'Config updated',
            config: newConfig,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
