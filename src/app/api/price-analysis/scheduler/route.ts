export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  getPriceSyncStatus,
  updatePriceSyncConfig,
  executePriceSyncJob,
  type PriceSyncConfig,
} from '@/lib/price-sync-scheduler';

// ─── GET: Get price sync status + config + history ───────────
export async function GET() {
  try {
    const status = await getPriceSyncStatus();
    return NextResponse.json(status);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── POST: Update config or trigger manual sync ──────────────
export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // Manual trigger
    if (action === 'trigger') {
      executePriceSyncJob('manual').catch(err => {
        console.error('[PriceSync API] Manual sync error:', err.message);
      });
      return NextResponse.json({ message: 'Price sync manual dimulai' });
    }

    // Update config
    const body: Partial<PriceSyncConfig> = await request.json();
    const newConfig = await updatePriceSyncConfig(body);

    return NextResponse.json({
      message: 'Config updated',
      config: newConfig,
    });
  } catch (err: any) {
    console.error('[PriceSync API] POST Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
