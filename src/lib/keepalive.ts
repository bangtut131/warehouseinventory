import cron from 'node-cron';
import { prisma } from './prisma';

// ─── Supabase Keep-Alive ─────────────────────────────────────
// Prevents Supabase free tier from pausing due to inactivity.
// Runs a lightweight DB query every 3 days (well within the 7-day limit).

let keepAliveTask: ReturnType<typeof cron.schedule> | null = null;

async function pingDatabase(): Promise<void> {
    try {
        // Lightweight query — just read one row from SystemSetting
        await prisma.systemSetting.findFirst();
        console.log(`[Keep-Alive] Ping successful — ${new Date().toISOString()}`);
    } catch (err: any) {
        console.error(`[Keep-Alive] Ping failed:`, err.message);
    }
}

export function startKeepAlive(): void {
    if (keepAliveTask) {
        console.log('[Keep-Alive] Already running — skipping');
        return;
    }

    // Schedule: "At 00:00 every 3rd day" → 0 0 */3 * *
    keepAliveTask = cron.schedule('0 0 */3 * *', () => {
        pingDatabase();
    }, {
        timezone: 'Asia/Jakarta',
    });

    keepAliveTask.start();
    console.log('[Keep-Alive] Cron registered — pinging Supabase every 3 days');

    // Also ping immediately on startup to confirm DB connectivity
    pingDatabase();
}

export { pingDatabase };
