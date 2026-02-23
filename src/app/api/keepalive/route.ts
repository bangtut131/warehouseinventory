import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/keepalive
 * 
 * Lightweight endpoint to keep Supabase free tier active.
 * Can be called by external cron services (e.g. cron-job.org)
 * to ensure database activity at least once a week.
 */
export async function GET() {
    try {
        // Simple read query — counts as Supabase API activity
        await prisma.systemSetting.findFirst();

        return NextResponse.json({
            status: 'ok',
            message: 'Supabase connection is active. Keep-alive ping successful.',
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error('[Keep-Alive API] Ping failed:', error.message);
        return NextResponse.json(
            {
                status: 'error',
                message: 'Failed to ping Supabase database.',
                error: error.message,
            },
            { status: 500 }
        );
    }
}
