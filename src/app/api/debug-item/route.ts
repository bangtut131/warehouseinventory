import { NextRequest, NextResponse } from 'next/server';
import { fetchAllInventory } from '@/lib/accurate';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
    try {
        // Fetch all items from Accurate
        const items = await fetchAllInventory();
        
        // Get sales data for unitConversion info
        const salesInvoices = await prisma.salesInvoice.findMany({
            select: {
                itemNo: true,
                unitConversion: true,
            },
            distinct: ['itemNo'],
        });
        const salesConversionMap = new Map<string, number>();
        salesInvoices.forEach(inv => {
            if (inv.unitConversion && inv.unitConversion > 0) {
                salesConversionMap.set(inv.itemNo, inv.unitConversion);
            }
        });

        // Get sales qty data for sanity check
        const salesQtyData = await prisma.salesInvoice.groupBy({
            by: ['itemNo'],
            _sum: {
                quantity: true,
                quantityInBox: true,
            },
        });
        const salesQtyMap = new Map<string, { totalQty: number; totalQtyBox: number }>();
        salesQtyData.forEach(s => {
            salesQtyMap.set(s.itemNo, {
                totalQty: s._sum.quantity || 0,
                totalQtyBox: s._sum.quantityInBox || 0,
            });
        });

        const activeItems = items.filter(i => !i.suspended);
        
        const conversionData = activeItems.map(item => {
            const salesConversion = salesConversionMap.get(item.no) || 0;
            let sakConversion = salesConversion || (item.ratio2 && item.ratio2 > 1 ? item.ratio2 : 0);
            const itemNameLower = (item.name || '').toLowerCase();
            const isKgItem = itemNameLower.includes('kg');
            
            const baseUnit = (item.unit1Name || '').toLowerCase();
            const alreadyInSellingUnit = baseUnit === 'sak' || baseUnit === 'karung' || baseUnit === 'galon';
            
            const salesQty = salesQtyMap.get(item.no);
            const filteredTotalQty = salesQty?.totalQty || 0;
            const filteredTotalQtyBox = salesQty?.totalQtyBox || 0;
            
            const salesAlreadyInSellingUnit = filteredTotalQtyBox > 0 && filteredTotalQty > 0
                && Math.abs(filteredTotalQty - filteredTotalQtyBox) / filteredTotalQty < 0.05;
            
            const skipConversion = alreadyInSellingUnit || salesAlreadyInSellingUnit;
            
            let conversionSource = 'none';
            if (salesConversion > 0) conversionSource = 'salesInvoice';
            else if (item.ratio2 && item.ratio2 > 1) conversionSource = 'ratio2';
            
            // Fallback: name-based extraction
            if (isKgItem && !skipConversion && sakConversion < 25) {
                const weightMatch = (item.name || '').match(/(\d+)\s*[Kk][Gg]/);
                if (weightMatch) {
                    const nameWeight = parseInt(weightMatch[1], 10);
                    if (nameWeight >= 20) {
                        sakConversion = nameWeight;
                        conversionSource = 'nameExtract';
                    }
                }
            }
            
            const isBulkUnit = isKgItem && sakConversion >= 25 && !skipConversion;
            const useSakQty = isBulkUnit || (skipConversion && isKgItem);
            
            let displayStock = item.quantity;
            let displayUnit = item.unit1Name || '';
            
            if (isBulkUnit) {
                displayStock = parseFloat((item.quantity / sakConversion).toFixed(2));
                displayUnit = 'Sak';
            } else if (skipConversion && isKgItem) {
                displayUnit = item.unit1Name || 'Sak';
            }
            
            return {
                itemNo: item.no,
                name: item.name,
                isKgItem,
                unit1Name: item.unit1Name,
                unit2Name: item.unit2Name || null,
                ratio2: item.ratio2 || 0,
                rawStock: item.quantity,
                sakConversion: sakConversion || null,
                conversionSource,
                alreadyInSellingUnit,
                salesAlreadyInSellingUnit,
                skipConversion,
                isBulkUnit,
                useSakQty,
                displayStock,
                displayUnit,
                salesTotalQty: filteredTotalQty,
                salesTotalQtyBox: filteredTotalQtyBox,
            };
        });

        // Categorize
        const converted = conversionData.filter(c => c.isBulkUnit);
        const skipped = conversionData.filter(c => c.skipConversion && c.isKgItem);
        const noConversion = conversionData.filter(c => !c.isBulkUnit && !(c.skipConversion && c.isKgItem));
        const kgNoConvert = noConversion.filter(c => c.isKgItem);

        return NextResponse.json({
            summary: {
                totalActive: activeItems.length,
                converted: converted.length,
                skippedAlreadySak: skipped.length,
                noConversion: noConversion.length,
                kgButNoConvert: kgNoConvert.length,
            },
            converted,
            skippedAlreadySak: skipped,
            kgButNoConvert: kgNoConvert,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
