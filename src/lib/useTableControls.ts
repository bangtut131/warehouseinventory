'use client';

import { useState, useMemo } from 'react';

export type SortDir = 'asc' | 'desc' | null;

export interface SortState {
    key: string;
    dir: SortDir;
}

export interface FilterOption {
    key: string;
    label: string;
    options: string[];
}

export function useTableControls<T extends Record<string, any>>(
    items: T[],
    searchKeys: string[],
    filterOptions: FilterOption[] = []
) {
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortState>({ key: '', dir: null });
    const [filters, setFilters] = useState<Record<string, string>>({});

    const toggleSort = (key: string) => {
        setSort(prev => {
            if (prev.key !== key) return { key, dir: 'asc' };
            if (prev.dir === 'asc') return { key, dir: 'desc' };
            return { key: '', dir: null };
        });
    };

    const setFilter = (key: string, value: string) => {
        setFilters(prev => {
            const next = { ...prev };
            if (value === '' || value === 'ALL') {
                delete next[key];
            } else {
                next[key] = value;
            }
            return next;
        });
    };

    const clearAll = () => {
        setSearch('');
        setSort({ key: '', dir: null });
        setFilters({});
    };

    const filtered = useMemo(() => {
        let result = [...items];

        // Search
        if (search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(item =>
                searchKeys.some(key => {
                    const val = item[key];
                    return val !== undefined && val !== null && String(val).toLowerCase().includes(q);
                })
            );
        }

        // Filters
        for (const [key, value] of Object.entries(filters)) {
            result = result.filter(item => String(item[key]) === value);
        }

        // Sort
        if (sort.key && sort.dir) {
            result.sort((a, b) => {
                const aVal = a[sort.key];
                const bVal = b[sort.key];
                if (aVal == null && bVal == null) return 0;
                if (aVal == null) return 1;
                if (bVal == null) return -1;
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sort.dir === 'asc' ? aVal - bVal : bVal - aVal;
                }
                const strA = String(aVal).toLowerCase();
                const strB = String(bVal).toLowerCase();
                return sort.dir === 'asc'
                    ? strA.localeCompare(strB)
                    : strB.localeCompare(strA);
            });
        }

        return result;
    }, [items, search, sort, filters, searchKeys]);

    return {
        search, setSearch,
        sort, toggleSort,
        filters, setFilter,
        clearAll,
        filtered,
        activeFilterCount: Object.keys(filters).length + (search ? 1 : 0),
    };
}
