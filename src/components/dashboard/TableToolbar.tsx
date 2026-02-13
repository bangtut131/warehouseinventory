'use client';

import React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FilterOption, SortState } from '@/lib/useTableControls';

interface TableToolbarProps {
    search: string;
    onSearchChange: (value: string) => void;
    filterOptions?: FilterOption[];
    filters?: Record<string, string>;
    onFilterChange?: (key: string, value: string) => void;
    onClearAll?: () => void;
    activeFilterCount?: number;
    totalItems: number;
    filteredItems: number;
}

export function TableToolbar({
    search,
    onSearchChange,
    filterOptions = [],
    filters = {},
    onFilterChange,
    onClearAll,
    activeFilterCount = 0,
    totalItems,
    filteredItems,
}: TableToolbarProps) {
    return (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
                <Input
                    placeholder="Cari kode, nama barang..."
                    value={search}
                    onChange={e => onSearchChange(e.target.value)}
                    className="pl-8 h-9 text-sm"
                />
            </div>

            {/* Filters */}
            {filterOptions.map(opt => (
                <select
                    key={opt.key}
                    value={filters[opt.key] || 'ALL'}
                    onChange={e => onFilterChange?.(opt.key, e.target.value)}
                    className="h-9 px-2 text-sm border rounded-md bg-white hover:bg-gray-50 cursor-pointer min-w-[110px]"
                >
                    <option value="ALL">{opt.label}: Semua</option>
                    {opt.options.map(v => (
                        <option key={v} value={v}>{v}</option>
                    ))}
                </select>
            ))}

            {/* Clear + Count */}
            <div className="flex items-center gap-2">
                {activeFilterCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={onClearAll} className="h-9 text-xs text-red-500 hover:text-red-700">
                        ✕ Reset
                    </Button>
                )}
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {filteredItems === totalItems
                        ? `${totalItems} item`
                        : `${filteredItems} / ${totalItems} item`
                    }
                </span>
            </div>
        </div>
    );
}

// Sortable table header helper
interface SortableHeaderProps {
    label: string;
    sortKey: string;
    sort: SortState;
    onSort: (key: string) => void;
    className?: string;
}

export function SortableHead({ label, sortKey, sort, onSort, className = '' }: SortableHeaderProps) {
    const isActive = sort.key === sortKey;
    const arrow = isActive ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';

    return (
        <th
            onClick={() => onSort(sortKey)}
            className={`h-12 px-4 text-left align-middle font-bold cursor-pointer select-none hover:opacity-80 transition-opacity ${className}`}
        >
            {label}{arrow}
        </th>
    );
}
