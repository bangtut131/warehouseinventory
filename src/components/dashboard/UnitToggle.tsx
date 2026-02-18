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
 * Convert a PCS quantity to Box quantity.
 * Returns decimal values (e.g., 0.5 box) when qty < 1 box.
 * If unitConversion is 0 or 1, returns original qty (same unit).
 */
export function convertQty(qty: number, unitConversion: number, unit: QtyUnit): number {
    if (unit === 'pcs' || !unitConversion || unitConversion <= 1) {
        return qty;
    }
    return qty / unitConversion;
}

/**
 * Format a quantity for display.
 * - PCS mode: whole number with locale formatting
 * - Box mode: decimal if < 1, otherwise 1 decimal place, or whole number if exact
 */
export function formatQty(qty: number, unitConversion: number, unit: QtyUnit): string {
    const converted = convertQty(qty, unitConversion, unit);

    if (unit === 'pcs' || !unitConversion || unitConversion <= 1) {
        return Math.round(converted).toLocaleString('id-ID');
    }

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
    // Box mode — use specific sales unit name, or generic "Box"
    if (item.salesUnitName) return item.salesUnitName;
    return 'Box';
}
