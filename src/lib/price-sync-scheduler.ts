import cron from 'node-cron';
import { prisma } from './prisma';
import {
  fetchAllInventory,
  fetchAllPurchasePriceData,
  fetchItemMasterSellingPrices,
} from './accurate';
import { sendTextMessage, checkSession, WahaConfig } from './waha';
import { loadBroadcastConfig } from './broadcast-scheduler';

// ─── Config ──────────────────────────────────────────────────

export interface PriceSyncConfig {
  enabled: boolean;
  cronExpression: string;
  intervalLabel: string;
  fromDate: string;
  // WA Report config
  waReportEnabled: boolean;
  waReportTargets: string[];
  // Calculation & UI settings
  ppnRate: number;
  marginHealthy: number;
  marginThin: number;
}

const DEFAULT_CONFIG: PriceSyncConfig = {
  enabled: false,
  cronExpression: '0 6 * * *',    // default: daily 6am
  intervalLabel: 'Setiap Hari 06:00',
  fromDate: '2025-01-01',
  waReportEnabled: false,
  waReportTargets: [],
  ppnRate: 11,
  marginHealthy: 15,
  marginThin: 5,
};

const CONFIG_KEY = 'price_sync_config';

// ─── Config Persistence ──────────────────────────────────────

export async function loadPriceSyncConfig(): Promise<PriceSyncConfig> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: CONFIG_KEY },
    });
    if (setting?.value) {
      return { ...DEFAULT_CONFIG, ...(setting.value as any) };
    }
  } catch (err: any) {
    console.warn('[PriceSync] Config load error:', err.message);
  }
  return { ...DEFAULT_CONFIG };
}

export async function savePriceSyncConfig(config: PriceSyncConfig): Promise<void> {
  try {
    await prisma.systemSetting.upsert({
      where: { key: CONFIG_KEY },
      update: { value: config as any },
      create: { key: CONFIG_KEY, value: config as any },
    });
    console.log('[PriceSync] Config saved');
  } catch (err: any) {
    console.error('[PriceSync] Config save error:', err.message);
    throw err;
  }
}

// ─── Sync Execution ──────────────────────────────────────────

export interface PriceSyncResult {
  success: boolean;
  trigger: 'scheduled' | 'manual';
  durationSec: number;
  itemCount: number;
  purchasePriceCount: number;
  masterPriceCount: number;
  error?: string;
}

export async function executePriceSyncJob(
  trigger: 'scheduled' | 'manual' = 'scheduled'
): Promise<PriceSyncResult> {
  const config = await loadPriceSyncConfig();
  const start = Date.now();
  const fromDate = new Date(config.fromDate);

  console.log(`[PriceSync] Starting ${trigger} price sync...`);

  try {
    // Step 1: Fetch all inventory items to get IDs
    console.log('[PriceSync] Phase 1: Fetching inventory list...');
    const items = await fetchAllInventory();
    const itemIds = items.map(i => i.id);
    console.log(`[PriceSync] Phase 1 done: ${items.length} items`);

    // Step 2: Force-refresh purchase price data
    console.log('[PriceSync] Phase 2: Refreshing purchase prices...');
    const purchaseResult = await fetchAllPurchasePriceData(fromDate, true, undefined);
    console.log(`[PriceSync] Phase 2 done: ${purchaseResult.priceMap.size} purchase prices`);

    // Step 3: Force-refresh master selling prices
    console.log('[PriceSync] Phase 3: Refreshing master selling prices...');
    const masterPrices = await fetchItemMasterSellingPrices(itemIds, true);
    console.log(`[PriceSync] Phase 3 done: ${masterPrices.size} master prices`);

    const durationSec = Math.round((Date.now() - start) / 1000);

    const result: PriceSyncResult = {
      success: true,
      trigger,
      durationSec,
      itemCount: items.length,
      purchasePriceCount: purchaseResult.priceMap.size,
      masterPriceCount: masterPrices.size,
    };

    // Log to DB
    await logPriceSync('SUCCESS', result);

    // Send WA report
    await sendPriceSyncReport(result);

    console.log(`[PriceSync] Completed in ${durationSec}s`);
    return result;
  } catch (err: any) {
    const durationSec = Math.round((Date.now() - start) / 1000);

    const result: PriceSyncResult = {
      success: false,
      trigger,
      durationSec,
      itemCount: 0,
      purchasePriceCount: 0,
      masterPriceCount: 0,
      error: err.message,
    };

    await logPriceSync('FAILED', result);
    await sendPriceSyncReport(result);

    console.error(`[PriceSync] Failed after ${durationSec}s:`, err.message);
    return result;
  }
}

// ─── Logging ─────────────────────────────────────────────────

async function logPriceSync(status: string, result: PriceSyncResult): Promise<void> {
  try {
    const message = result.success
      ? `Items: ${result.itemCount}, Purchase: ${result.purchasePriceCount}, Master: ${result.masterPriceCount} (${result.durationSec}s)`
      : `${result.error} (${result.durationSec}s)`;

    await prisma.syncLog.create({
      data: {
        status,
        trigger: result.trigger.toUpperCase(),
        message,
        completedAt: new Date(),
      },
    });
  } catch (err: any) {
    console.warn('[PriceSync] Log error:', err.message);
  }
}

// ─── WA Report ───────────────────────────────────────────────

async function sendPriceSyncReport(result: PriceSyncResult): Promise<void> {
  try {
    const config = await loadPriceSyncConfig();
    if (!config.waReportEnabled || !config.waReportTargets?.length) return;

    // Reuse WAHA config from broadcast settings
    const broadcastCfg = await loadBroadcastConfig();
    const wahaConfig: WahaConfig = {
      apiUrl: broadcastCfg.wahaUrl,
      session: broadcastCfg.wahaSession,
      apiKey: broadcastCfg.wahaApiKey || undefined,
    };

    // Check WAHA session
    const session = await checkSession(wahaConfig);
    if (!session.ok) {
      console.warn(`[PriceSync] WA report skipped — WAHA not ready: ${session.error || session.status}`);
      return;
    }

    // Format date
    const now = new Date();
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const dateStr = `${days[now.getDay()]}, ${dd}/${mm}/${yyyy} ${hh}:${min}`;

    // Format duration
    const durMin = Math.floor(result.durationSec / 60);
    const durSec = result.durationSec % 60;
    const durStr = durMin > 0 ? `${durMin}m ${durSec}s` : `${durSec}s`;

    // Build message
    let msg = `💰 *SYNC ANALISA HARGA*\n${dateStr}\n\n`;

    if (result.success) {
      msg += `✅ Status: *Berhasil*\n`;
      msg += `⏱ Durasi: ${durStr}\n\n`;
      msg += `📊 *Data Tersinkron:*\n`;
      msg += `• 📦 Total Item: ${result.itemCount.toLocaleString('id-ID')}\n`;
      msg += `• 🛒 Harga Beli: ${result.purchasePriceCount.toLocaleString('id-ID')} item\n`;
      msg += `• 🏷️ Harga Jual Master: ${result.masterPriceCount.toLocaleString('id-ID')} item\n`;
      msg += `\n🔄 Trigger: ${result.trigger === 'scheduled' ? '⏰ Auto' : '👤 Manual'}`;
    } else {
      msg += `❌ Status: *GAGAL*\n`;
      msg += `⏱ Durasi: ${durStr}\n`;
      msg += `🔄 Trigger: ${result.trigger === 'scheduled' ? '⏰ Auto' : '👤 Manual'}\n\n`;
      msg += `⚠️ Error:\n${result.error || 'Unknown error'}`;
    }

    // Send to all targets
    for (const target of config.waReportTargets) {
      try {
        const r = await sendTextMessage(target, msg, wahaConfig);
        if (r.ok) {
          console.log(`[PriceSync] WA report sent to ${target}`);
        } else {
          console.warn(`[PriceSync] WA report failed to ${target}: ${r.error}`);
        }
      } catch (err: any) {
        console.warn(`[PriceSync] WA report send error to ${target}:`, err.message);
      }
    }
  } catch (err: any) {
    console.warn('[PriceSync] WA report error:', err.message);
  }
}

// ─── Cron Management ─────────────────────────────────────────

let priceSyncCron: ReturnType<typeof cron.schedule> | null = null;
let isSyncing = false;
let priceSyncInitialized = false;

export async function startPriceSyncScheduler(): Promise<void> {
  if (priceSyncInitialized && priceSyncCron) {
    console.log('[PriceSync] Already initialized — skipping duplicate start');
    return;
  }
  priceSyncInitialized = true;

  const config = await loadPriceSyncConfig();

  if (!config.enabled) {
    console.log('[PriceSync] Scheduler disabled — not starting cron');
    return;
  }

  if (!cron.validate(config.cronExpression)) {
    console.error(`[PriceSync] Invalid cron expression: ${config.cronExpression}`);
    return;
  }

  stopPriceSyncScheduler();

  console.log(`[PriceSync] Starting cron: "${config.cronExpression}" (${config.intervalLabel})`);

  priceSyncCron = cron.schedule(config.cronExpression, async () => {
    if (isSyncing) {
      console.log('[PriceSync] Skipping — previous sync still running');
      return;
    }
    isSyncing = true;
    try {
      await executePriceSyncJob('scheduled');
    } finally {
      isSyncing = false;
    }
  }, {
    timezone: 'Asia/Jakarta',
  });

  priceSyncCron.start();
}

export function stopPriceSyncScheduler(): void {
  if (priceSyncCron) {
    priceSyncCron.stop();
    priceSyncCron = null;
    console.log('[PriceSync] Cron stopped');
  }
}

export async function restartPriceSyncScheduler(): Promise<void> {
  stopPriceSyncScheduler();
  priceSyncInitialized = false;
  await startPriceSyncScheduler();
}

export async function getPriceSyncStatus(): Promise<{
  config: PriceSyncConfig;
  cronActive: boolean;
  isSyncing: boolean;
  history: any[];
}> {
  const config = await loadPriceSyncConfig();

  // Load recent price-sync logs (filter by message pattern)
  let history: any[] = [];
  try {
    const logs = await prisma.syncLog.findMany({
      where: {
        OR: [
          { message: { contains: 'Master:' } },
          { message: { contains: 'Purchase:' } },
        ],
      },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });

    history = logs.map(log => ({
      id: log.id,
      startedAt: log.startedAt.toISOString(),
      completedAt: log.completedAt?.toISOString() || null,
      status: log.status === 'SUCCESS' ? 'success' : log.status === 'FAILED' ? 'error' : 'running',
      durationSec: log.completedAt ? Math.round((log.completedAt.getTime() - log.startedAt.getTime()) / 1000) : null,
      message: log.message,
      trigger: log.trigger?.toLowerCase() || 'manual',
    }));
  } catch (err: any) {
    console.warn('[PriceSync] History load error:', err.message);
  }

  return {
    config,
    cronActive: priceSyncCron !== null && config.enabled,
    isSyncing,
    history,
  };
}

export async function updatePriceSyncConfig(updates: Partial<PriceSyncConfig>): Promise<PriceSyncConfig> {
  const config = await loadPriceSyncConfig();
  const newConfig = { ...config, ...updates };
  await savePriceSyncConfig(newConfig);
  await restartPriceSyncScheduler();
  return newConfig;
}
