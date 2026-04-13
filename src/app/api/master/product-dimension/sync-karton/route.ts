import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchAllInventory } from '@/lib/accurate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
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

        // Lakukan update massal
        // Prisma tidak support bulk update dengan value dinamis per-baris,
        // jadi kita gunakan loop secara sekuensial atau Promise.all
        const updatePromises = localDims.map(async (dim) => {
            const accurateRatio = ratioMap.get(dim.itemNo);
            // Jika ada ratio di accurate, dan berbeda dengan lokal, update
            if (accurateRatio && accurateRatio !== dim.qtyPerCarton) {
                await prisma.productDimension.update({
                    where: { id: dim.id },
                    data: { qtyPerCarton: accurateRatio }
                });
                updatedCount++;
            }
        });

        await Promise.all(updatePromises);
        
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
