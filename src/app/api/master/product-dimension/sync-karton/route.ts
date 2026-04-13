import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchAllInventory } from '@/lib/accurate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Auto-migrate: ensure qtyPerCarton column exists
let schemaMigrated = false;
async function ensureSchema() {
    if (schemaMigrated) return;
    try {
        await prisma.$executeRawUnsafe(
            `ALTER TABLE "ProductDimension" ADD COLUMN IF NOT EXISTS "qtyPerCarton" INTEGER`
        );
        schemaMigrated = true;
    } catch (e: any) {
        schemaMigrated = true;
    }
}

export async function POST(request: NextRequest) {
    try {
        await ensureSchema();
        console.log('[Sync Karton] Memulai tarik data master item dari Accurate...');
        const accurateItems = await fetchAllInventory();
        let updatedCount = 0;

        // Buat map ratio2 berdasarkan itemNo dari Accurate
        // Asumsi: ratio2 adalah representasi Isi Karton (misal 1 Box = 24 Pcs -> ratio2: 24)
        const ratioMap = new Map<string, number>();
        accurateItems.forEach(item => {
            if (item.ratio2 && item.ratio2 > 1) {
                ratioMap.set(item.no, item.ratio2);
            }
        });

        // Ambil semua data dimensi produk yang sudah ada di database lokal
        const localDims = await prisma.productDimension.findMany();

        // Filter items yang perlu diupdate
        const toUpdate = localDims.filter(dim => {
            const accurateRatio = ratioMap.get(dim.itemNo);
            return accurateRatio && accurateRatio !== dim.qtyPerCarton;
        });

        // Update secara batch (10 item per batch) untuk hindari max connections
        const BATCH_SIZE = 10;
        for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
            const batch = toUpdate.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(dim =>
                prisma.productDimension.update({
                    where: { id: dim.id },
                    data: { qtyPerCarton: ratioMap.get(dim.itemNo)! }
                })
            ));
            updatedCount += batch.length;
        }
        
        console.log(`[Sync Karton] Selesai. Diperbarui: ${updatedCount} item.`);
        return NextResponse.json({
            success: true,
            totalItemsAccurate: accurateItems.length,
            updatedCount: updatedCount,
            message: `Berhasil menarik ${accurateItems.length} item dari Accurate dan memperbarui ${updatedCount} data Isi Karton.`
        });

    } catch (err: any) {
        console.error('[Sync Karton] Error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
