export async function register() {
    // Scheduler is initialized lazily via /api/scheduler on first access
    // This avoids Edge Runtime bundling issues with node-cron / fs / path
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        console.log('[Instrumentation] Node.js runtime detected — Starting Scheduler...');
        try {
            const { startScheduler } = await import('@/lib/scheduler');
            await startScheduler();
        } catch (err) {
            console.error('[Instrumentation] Failed to start scheduler:', err);
        }
    }
}
