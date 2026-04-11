export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
    getSOSchedulerStatus,
    updateSOSchedulerConfig,
    loadSOSyncHistory,
    executeSOSyncJob,
    type SOSchedulerConfig,
} from '@/lib/so-scheduler';

// ─── GET: Get SO scheduler status + history ──────────────────
export async function GET() {
    try {
        const status = await getSOSchedulerStatus();
        const history = await loadSOSyncHistory();

        return NextResponse.json({
            ...status,
            history: history.slice(0, 20),
        });
    } catch (err: any) {
        return NextResponse.json({
            error: err.message,
            stack: err.stack,
        }, { status: 500 });
    }
}

// ─── POST: Update config or trigger manual sync ──────────────
export async function POST(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const action = url.searchParams.get('action');

        if (action === 'trigger') {
            executeSOSyncJob('manual').catch(err => {
                console.error('[SO Scheduler API] Manual sync error:', err.message);
            });
            return NextResponse.json({ message: 'SO sync manual dimulai' });
        }

        const body: Partial<SOSchedulerConfig> = await request.json();
        const newConfig = await updateSOSchedulerConfig(body);

        return NextResponse.json({
            message: 'SO scheduler config updated',
            config: newConfig,
        });
    } catch (err: any) {
        console.error('[SO Scheduler API] POST Error:', err);
        return NextResponse.json({
            error: err.message,
            stack: err.stack,
        }, { status: 500 });
    }
}
