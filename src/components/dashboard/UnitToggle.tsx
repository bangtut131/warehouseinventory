'use client';

import React from 'react';

export type QtyUnit = 'pcs' | 'box';

interface UnitToggleProps {
    unit: QtyUnit;
    onChange: (unit: QtyUnit) => void;
}

/**
 * Toggle button for switching between PCS and Box display.
 * Placed in the toolbar area above tables.
 */
export function UnitToggle({ unit, onChange }: UnitToggleProps) {
    return (
        <div className="inline-flex items-center rounded-md border border-gray-300 bg-white text-sm overflow-hidden">
            <button
                onClick={() => onChange('pcs')}
                className={`px-3 py-1.5 font-medium transition-colors ${unit === 'pcs'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                    }`}
            >
                Pcs
            </button>
            <button
                onClick={() => onChange('box')}
                className={`px-3 py-1.5 font-medium transition-colors ${unit === 'box'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                    }`}
            >
                Box
            </button>
        </div>
    );
}

/**
 * Check if an item is a bulk/Sak unit (already converted from Kg to Sak in API).
 * These items should NOT be divided by unitConversion again.
 */
function isBulkConverted(itemUnit?: string): boolean {
    if (!itemUnit) return false;
    const lower = itemUnit.toLowerCase();
    return lower === 'sak' || lower === 'karung' || lower === 'galon';
}

/**
 * Convert a PCS quantity to Box quantity.
 * Returns decimal values (e.g., 0.5 box) when qty < 1 box.
 * If unitConversion is 0 or 1, returns original qty (same unit).
 * 
 * IMPORTANT: For Sak/Karung items, the stock is already in selling unit
 * (converted from Kg in the API), so we do NOT divide again.
 */
export function convertQty(qty: number, unitConversion: number, unit: QtyUnit, itemUnit?: string): number {
    if (unit === 'pcs' || !unitConversion || unitConversion <= 1) {
        return qty;
    }
    // Sak/Karung items: already in selling unit, don't convert
    if (isBulkConverted(itemUnit)) {
        return qty;
    }
    return qty / unitConversion;
}

/**
 * Format a quantity for display.
 * - PCS mode: whole number with locale formatting
 * - Box mode: decimal if < 1, otherwise 1 decimal place, or whole number if exact
 */
export function formatQty(qty: number, unitConversion: number, unit: QtyUnit, itemUnit?: string): string {
    const converted = convertQty(qty, unitConversion, unit, itemUnit);

    if (unit === 'pcs' || !unitConversion || unitConversion <= 1) {
        return Math.round(converted).toLocaleString('id-ID');
    }

    // Sak items in box mode — same formatting as box
    // Box mode
    if (Number.isInteger(converted)) {
        return converted.toLocaleString('id-ID');
    }
    // Show 1 decimal for fractions
    return converted.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Get the unit label for display.
 */
export function getUnitLabel(item: { unitConversion: number; salesUnitName: string; unit: string }, unit: QtyUnit): string {
    if (unit === 'pcs') return item.unit || 'Pcs';
    // Sak/Karung items — always show their actual unit
    if (isBulkConverted(item.unit)) return item.unit;
    // Box mode — use specific sales unit name, or generic "Box"
    if (item.salesUnitName) return item.salesUnitName;
    return 'Box';
}

/**
 * Get the correct Box sales quantity, fixing the "Pcs=Box" bug.
 *
 * Root cause: if an item is ALWAYS sold in base unit (e.g. Btl, never per Box),
 * the cache's unitConversion stays 0 and convertQtyBox() is skipped,
 * leaving totalSalesQtyBox === totalSalesQty (both in base unit).
 *
 * Fix: when that bug condition is detected AND we have a master ratio (unitConversion > 1),
 * divide totalSalesQty by unitConversion to get the correct Box qty.
 *
 * Safe for all other item types:
 * - Sak items: unitConversion = 0 → no division
 * - Items correctly sold in Box: totalSalesQtyBox ≠ totalSalesQty → no division
 * - Items without ratio: unitConversion = 0 → no division
 */
export function getSalesQtyBox(
    totalSalesQty: number,
    totalSalesQtyBox: number,
    unitConversion: number
): number {
    // Only fix when: has a master ratio AND qtyBox is identical to qty (bug condition)
    if (unitConversion > 1 && Math.abs(totalSalesQtyBox - totalSalesQty) < 0.01) {
        return parseFloat((totalSalesQty / unitConversion).toFixed(2));
    }
    return totalSalesQtyBox;
}
