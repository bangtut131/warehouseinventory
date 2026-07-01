'use client';

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { PriceAnalysisItem, CategoryPrice } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useMask } from '@/lib/SessionContext';

const fmt = (n: number) => n.toLocaleString('id-ID');
const fmtRp = (n: number) => `Rp ${fmt(n)}`;

const statusConfig = {
    HEALTHY: { label: '✅ Sehat', color: 'bg-green-50 text-green-700 border-green-200' },
    THIN: { label: '⚠️ Tipis', color: 'bg-amber-50 text-amber-700 border-amber-200' },
    NEGATIVE: { label: '🔴 Rugi', color: 'bg-red-50 text-red-700 border-red-200' },
    NO_DATA: { label: '⬜ No Data', color: 'bg-gray-50 text-gray-500 border-gray-200' },
};

function computeStatus(margin: number, hasData: boolean, marginHealthy: number, marginThin: number): keyof typeof statusConfig {
    if (!hasData) return 'NO_DATA';
    if (margin < marginThin) return 'NEGATIVE';
    if (margin < marginHealthy) return 'THIN';
    return 'HEALTHY';
}

/** Compute dynamic margin for an item based on category filter (supports multiple) */
function getItemMargin(item: PriceAnalysisItem, catFilter: string[], marginHealthy: number, marginThin: number): { margin: number; status: keyof typeof statusConfig } {
    if (item.lastPurchasePrice <= 0) return { margin: 0, status: 'NO_DATA' };
    const prices = item.categoryPrices?.filter(cp => cp.price > 0) || [];
    if (prices.length === 0) return { margin: 0, status: 'NO_DATA' };

    let margin: number;
    if (catFilter.length > 0) {
        // Specific categories: average margin of selected
        const selected = prices.filter(c => catFilter.includes(c.categoryName));
        if (selected.length === 0) return { margin: 0, status: 'NO_DATA' };
        const sum = selected.reduce((s, cp) => s + cp.marginVsLastPurchase, 0);
        margin = sum / selected.length;
    } else {
        // All categories: average margin
        const sum = prices.reduce((s, cp) => s + cp.marginVsLastPurchase, 0);
        margin = sum / prices.length;
    }
    return { margin: Math.round(margin * 100) / 100, status: computeStatus(margin, true, marginHealthy, marginThin) };
}

function MarginBadge({ margin, hasData, healthy, thin }: { margin: number; hasData: boolean; healthy: number; thin: number }) {
    if (!hasData) return <span className="text-xs text-gray-400">—</span>;
    const color = margin >= healthy ? 'text-green-700 bg-green-50' :
        margin >= thin ? 'text-amber-700 bg-amber-50' :
            margin >= 0 ? 'text-orange-700 bg-orange-50' :
                'text-red-700 bg-red-50 font-bold';
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded ${color}`}>
            {margin > 0 ? '+' : ''}{margin.toFixed(1)}%
        </span>
    );
}

function PriceCell({ price, rawPrice, unitName, ratio, baseUnit }: {
    price: number; rawPrice: number; unitName: string; ratio: number; baseUnit: string;
}) {
    const { isHidden } = useMask();
    const hp = isHidden('col:price');
    const isConverted = ratio > 1;
    return (
        <div className="group relative">
            <span className="font-mono text-sm">{hp ? '***' : fmtRp(price)}</span>
            <span className="text-[10px] text-muted-foreground ml-0.5">/{baseUnit}</span>
            {isConverted && !hp && (
                <div className="absolute z-50 hidden group-hover:block bottom-full left-0 mb-1 p-2 bg-slate-800 text-white text-[11px] rounded-lg shadow-lg whitespace-nowrap min-w-[200px]">
                    <div className="font-medium mb-1">📦 Detail Konversi</div>
                    <div>Harga master: {fmtRp(rawPrice)}/{unitName}</div>
                    <div>Konversi: 1 {unitName} = {ratio} {baseUnit}</div>
                    <div className="border-t border-slate-600 mt-1 pt-1 font-medium">
                        = {fmtRp(price)}/{baseUnit}
                    </div>
                </div>
            )}
        </div>
    );
}

// Auto-fit column widths
function autoWidth(ws: XLSX.WorkSheet, data: Record<string, any>[]) {
    if (data.length === 0) return;
    const keys = Object.keys(data[0]);
    ws['!cols'] = keys.map(key => {
        const maxLen = Math.max(
            key.length,
            ...data.map(row => String(row[key] ?? '').length)
        );
        return { wch: Math.min(maxLen + 2, 45) };
    });
}

/** Multi-select dropdown for category filter */
function CategoryMultiSelect({ allCategories, selected, onChange }: {
    allCategories: [string, number][];
    selected: string[];
    onChange: (val: string[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const [catSearch, setCatSearch] = useState('');
    const ref = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const isAllSelected = selected.length === 0; // empty = all
    const filteredCats = catSearch
        ? allCategories.filter(([name]) => name.toLowerCase().includes(catSearch.toLowerCase()))
        : allCategories;

    const toggleCategory = (name: string) => {
        if (selected.includes(name)) {
            onChange(selected.filter(s => s !== name));
        } else {
            onChange([...selected, name]);
        }
    };

    const selectAll = () => onChange([]);
    const deselectAll = () => onChange(allCategories.map(([name]) => name));
    const label = isAllSelected
        ? `Semua Kategori (${allCategories.length})`
        : selected.length === 1
            ? selected[0]
            : `${selected.length} Kategori dipilih`;

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="bg-white border rounded-lg px-3 py-2 text-sm flex items-center gap-2 min-w-[200px] hover:border-slate-400 transition-colors"
            >
                <span className="flex-1 text-left truncate">{label}</span>
                {!isAllSelected && (
                    <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {selected.length}
                    </span>
                )}
                <span className="text-muted-foreground text-xs">{open ? '▲' : '▼'}</span>
            </button>

            {open && (
                <div className="absolute top-full left-0 mt-1 bg-white border rounded-xl shadow-xl z-50 w-[300px] max-h-[380px] flex flex-col overflow-hidden">
                    {/* Search */}
                    <div className="p-2 border-b">
                        <input
                            type="text"
                            placeholder="🔍 Cari kategori..."
                            value={catSearch}
                            onChange={e => setCatSearch(e.target.value)}
                            className="w-full border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                            autoFocus
                        />
                    </div>

                    {/* Quick actions */}
                    <div className="flex gap-1 px-2 py-1.5 border-b bg-slate-50">
                        <button
                            onClick={selectAll}
                            className={`text-[11px] px-2 py-1 rounded-md transition-colors ${
                                isAllSelected
                                    ? 'bg-amber-100 text-amber-800 font-medium'
                                    : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            ✅ Semua
                        </button>
                        <button
                            onClick={deselectAll}
                            className="text-[11px] px-2 py-1 rounded-md text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                            ☐ Pilih Manual
                        </button>
                        {!isAllSelected && selected.length > 0 && (
                            <button
                                onClick={() => onChange([])}
                                className="text-[11px] px-2 py-1 rounded-md text-red-600 hover:bg-red-50 ml-auto transition-colors"
                            >
                                ✕ Reset
                            </button>
                        )}
                    </div>

                    {/* Category list */}
                    <div className="overflow-y-auto flex-1">
                        {filteredCats.map(([name, id]) => {
                            const isChecked = isAllSelected || selected.includes(name);
                            return (
                                <label
                                    key={id}
                                    className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-amber-50/60 transition-colors text-sm border-b border-slate-50 ${
                                        isChecked && !isAllSelected ? 'bg-amber-50/40' : ''
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                            if (isAllSelected) {
                                                // Switching from 'all' to manual: select only this one
                                                onChange([name]);
                                            } else {
                                                toggleCategory(name);
                                            }
                                        }}
                                        className="w-3.5 h-3.5 rounded accent-amber-600"
                                    />
                                    <span className="truncate">{name}</span>
                                </label>
                            );
                        })}
                        {filteredCats.length === 0 && (
                            <div className="px-3 py-4 text-center text-sm text-muted-foreground">Tidak ditemukan</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export function PriceAnalysisView() {
    const { isHidden } = useMask();
    const hidePrice = isHidden('col:price');
    const hideCost = isHidden('col:cost');
    const hideMargin = isHidden('col:margin');

    const [items, setItems] = useState<PriceAnalysisItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [categoryFilter, setCategoryFilter] = useState<string[]>([]);  // empty = all
    const [sortBy, setSortBy] = useState<string>('status');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 100;

    // Config margin dari backend
    const [marginThresholds, setMarginThresholds] = useState({ healthy: 15, thin: 5 });

    // Refs untuk sinkronisasi scroll horizontal
    const topScrollRef = useRef<HTMLDivElement>(null);
    const tableScrollRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<HTMLTableElement>(null);
    const [tableWidth, setTableWidth] = useState(0);

    const fetchData = async (force = false) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams();
            params.set('from', '2025-01-01');
            if (force) params.set('force', 'true');
            const res = await axios.get(`/api/price-analysis?${params}`);
            
            // Handle res.data if it has data & config format
            if (res.data && Array.isArray(res.data.data)) {
                setItems(res.data.data);
                if (res.data.config) {
                    setMarginThresholds({
                        healthy: res.data.config.marginHealthy ?? 15,
                        thin: res.data.config.marginThin ?? 5,
                    });
                }
            } else if (Array.isArray(res.data)) {
                // Fallback if structured differently
                setItems(res.data);
            } else {
                setError(res.data?.error || 'Unknown error');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    // Effect untuk mengatur dummy width dari top scrollbar
    useEffect(() => {
        if (!tableRef.current) return;
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                setTableWidth(entry.contentRect.width);
            }
        });
        resizeObserver.observe(tableRef.current);
        return () => resizeObserver.disconnect();
    }, [items]);

    // All unique categories across all items
    const allCategories = useMemo(() => {
        const catSet = new Map<string, number>();
        items.forEach(item => {
            item.categoryPrices?.forEach(cp => {
                if (!catSet.has(cp.categoryName)) {
                    catSet.set(cp.categoryName, cp.categoryId);
                }
            });
        });
        return Array.from(catSet.entries())
            .sort((a, b) => a[0].localeCompare(b[0]));
    }, [items]);

    // Filtered categories to display as columns
    const displayCategories = useMemo(() => {
        if (categoryFilter.length === 0) return allCategories;
        return allCategories.filter(([name]) => categoryFilter.includes(name));
    }, [allCategories, categoryFilter]);

    // Summary KPIs — dynamic based on category filter
    const summary = useMemo(() => {
        const computed = items.map(i => getItemMargin(i, categoryFilter, marginThresholds.healthy, marginThresholds.thin));
        const withData = computed.filter(c => c.status !== 'NO_DATA');
        return {
            total: items.length,
            analyzed: withData.length,
            healthy: computed.filter(c => c.status === 'HEALTHY').length,
            thin: computed.filter(c => c.status === 'THIN').length,
            negative: computed.filter(c => c.status === 'NEGATIVE').length,
            noData: computed.filter(c => c.status === 'NO_DATA').length,
            avgMargin: withData.length > 0
                ? withData.reduce((s, c) => s + c.margin, 0) / withData.length
                : 0,
            totalCategories: allCategories.length,
        };
    }, [items, allCategories, categoryFilter, marginThresholds]);

    // Filtered & sorted items — using dynamic margin/status
    const filtered = useMemo(() => {
        let list = [...items];
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(i =>
                i.itemNo.toLowerCase().includes(q) ||
                i.itemName.toLowerCase().includes(q)
            );
        }
        if (statusFilter !== 'all') {
            // Filter by dynamic status (based on category filter)
            list = list.filter(i => getItemMargin(i, categoryFilter, marginThresholds.healthy, marginThresholds.thin).status === statusFilter);
        }
        const statusOrder: Record<string, number> = { NEGATIVE: 0, THIN: 1, NO_DATA: 2, HEALTHY: 3 };
        list.sort((a, b) => {
            let diff = 0;
            switch (sortBy) {
                case 'status': diff = statusOrder[getItemMargin(a, categoryFilter, marginThresholds.healthy, marginThresholds.thin).status] - statusOrder[getItemMargin(b, categoryFilter, marginThresholds.healthy, marginThresholds.thin).status]; break;
                case 'margin': diff = getItemMargin(a, categoryFilter, marginThresholds.healthy, marginThresholds.thin).margin - getItemMargin(b, categoryFilter, marginThresholds.healthy, marginThresholds.thin).margin; break;
                case 'name': diff = a.itemName.localeCompare(b.itemName); break;
                case 'sku': diff = a.itemNo.localeCompare(b.itemNo); break;
                case 'lastBuy': diff = a.lastPurchasePrice - b.lastPurchasePrice; break;
            }
            return sortDir === 'asc' ? diff : -diff;
        });
        return list;
    }, [items, search, statusFilter, sortBy, sortDir, categoryFilter, marginThresholds]);

    useEffect(() => { setPage(1); }, [search, statusFilter, sortBy, sortDir, categoryFilter]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginatedItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const startIdx = (page - 1) * PAGE_SIZE + 1;
    const endIdx = Math.min(page * PAGE_SIZE, filtered.length);

    const handleSort = (col: string) => {
        if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortBy(col); setSortDir('asc'); }
    };

    const SortIcon = ({ col }: { col: string }) => {
        if (sortBy !== col) return <span className="text-gray-300 ml-0.5">↕</span>;
        return <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
    };

    // ─── EXPORT TO EXCEL ────────────────────────────────────
    const exportToExcel = () => {
        const wb = XLSX.utils.book_new();

        // Sheet 1: Price Analysis (semua data)
        const rows = filtered.map((item, idx) => {
            const row: Record<string, any> = {
                'No': idx + 1,
                'SKU': item.itemNo,
                'Nama Barang': item.itemName,
                'Kategori': item.category,
                'Satuan Dasar': item.baseUnitName,
                'Satuan Jual': item.salesUnitName || '-',
                'Konversi': item.unitConversion || 1,
                'Beli Terakhir (per base)': item.lastPurchasePrice || '-',
                'Tgl Beli Terakhir': item.lastPurchaseDate || '-',
                'No Faktur Beli': item.lastPurchaseInvoice || '-',
                'Beli Rata² (per base)': item.avgPurchasePrice || '-',
                'Jml Faktur Beli': item.purchaseInvoiceCount || 0,
            };
            // Add each category price
            allCategories.forEach(([catName]) => {
                const cp = item.categoryPrices?.find(c => c.categoryName === catName);
                row[`Jual: ${catName}`] = cp ? cp.price : '-';
                row[`Margin: ${catName}`] = cp && item.lastPurchasePrice > 0
                    ? `${cp.marginVsLastPurchase.toFixed(1)}%` : '-';
            });
            row['Status'] = item.status;
            row['Margin Min'] = item.marginVsLastPurchase !== 0 ? `${item.marginVsLastPurchase.toFixed(1)}%` : '-';
            return row;
        });
        const ws1 = XLSX.utils.json_to_sheet(rows);
        autoWidth(ws1, rows);
        XLSX.utils.book_append_sheet(wb, ws1, 'Analisa Harga');

        // Sheet 2: Summary
        const summaryRows = [
            { 'Metrik': 'Total SKU', 'Nilai': summary.total },
            { 'Metrik': 'SKU Teranalisa', 'Nilai': summary.analyzed },
            { 'Metrik': 'Margin Sehat (>15%)', 'Nilai': summary.healthy },
            { 'Metrik': 'Margin Tipis (5-15%)', 'Nilai': summary.thin },
            { 'Metrik': 'Margin Negatif (<5%)', 'Nilai': summary.negative },
            { 'Metrik': 'Tanpa Data', 'Nilai': summary.noData },
            { 'Metrik': 'Rata² Margin', 'Nilai': `${summary.avgMargin.toFixed(1)}%` },
            { 'Metrik': 'Jumlah Kategori Harga', 'Nilai': summary.totalCategories },
        ];
        const ws2 = XLSX.utils.json_to_sheet(summaryRows);
        autoWidth(ws2, summaryRows);
        XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

        // Sheet 3: Items yang perlu perhatian (NEGATIVE + THIN)
        const alertRows = filtered
            .filter(i => i.status === 'NEGATIVE' || i.status === 'THIN')
            .map((item, idx) => {
                const row: Record<string, any> = {
                    'No': idx + 1,
                    'Status': item.status === 'NEGATIVE' ? '🔴 RUGI' : '⚠️ TIPIS',
                    'SKU': item.itemNo,
                    'Nama Barang': item.itemName,
                    'Beli Terakhir': item.lastPurchasePrice,
                    'Beli Rata²': item.avgPurchasePrice,
                };
                // Show lowest selling price and which category
                const sorted = [...(item.categoryPrices || [])].filter(c => c.price > 0)
                    .sort((a, b) => a.price - b.price);
                if (sorted.length > 0) {
                    row['Harga Jual Terendah'] = sorted[0].price;
                    row['Kategori Terendah'] = sorted[0].categoryName;
                    row['Margin Terendah'] = `${sorted[0].marginVsLastPurchase.toFixed(1)}%`;
                }
                if (sorted.length > 1) {
                    row['Harga Jual Tertinggi'] = sorted[sorted.length - 1].price;
                    row['Kategori Tertinggi'] = sorted[sorted.length - 1].categoryName;
                    row['Margin Tertinggi'] = `${sorted[sorted.length - 1].marginVsLastPurchase.toFixed(1)}%`;
                }
                return row;
            });
        if (alertRows.length > 0) {
            const ws3 = XLSX.utils.json_to_sheet(alertRows);
            autoWidth(ws3, alertRows);
            XLSX.utils.book_append_sheet(wb, ws3, 'Perlu Perhatian');
        }

        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        XLSX.writeFile(wb, `Analisa_Harga_${dateStr}.xlsx`);
    };

    if (loading && items.length === 0) {
        return (
            <div className="p-12 text-center">
                <div className="inline-block w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-muted-foreground text-lg">Mengambil data harga dari Accurate...</p>
                <p className="text-sm text-muted-foreground mt-1">Purchase Invoice + Item Master Selling Prices</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 text-center">
                <p className="text-red-600 text-lg mb-2">❌ Gagal mengambil data</p>
                <p className="text-sm text-muted-foreground mb-4">{error}</p>
                <Button variant="outline" onClick={() => fetchData(true)}>🔄 Coba Lagi</Button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="bg-white border rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-muted-foreground mb-1">📊 Total SKU</div>
                    <div className="text-2xl font-bold">{fmt(summary.total)}</div>
                    <div className="text-xs text-muted-foreground">{fmt(summary.analyzed)} teranalisa</div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-green-600 mb-1">✅ Margin Sehat</div>
                    <div className="text-2xl font-bold text-green-700">{fmt(summary.healthy)}</div>
                    <div className="text-xs text-green-600">&gt;={marginThresholds.healthy}% margin</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-amber-600 mb-1">⚠️ Margin Tipis</div>
                    <div className="text-2xl font-bold text-amber-700">{fmt(summary.thin)}</div>
                    <div className="text-xs text-amber-600">{marginThresholds.thin}-{marginThresholds.healthy}% margin</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-red-600 mb-1">🔴 Margin Negatif</div>
                    <div className="text-2xl font-bold text-red-700">{fmt(summary.negative)}</div>
                    <div className="text-xs text-red-600">&lt;{marginThresholds.thin}% atau rugi</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-blue-600 mb-1">📈 Avg Margin</div>
                    <div className="text-2xl font-bold text-blue-700">{summary.avgMargin.toFixed(1)}%</div>
                    <div className="text-xs text-blue-600">vs harga beli terakhir</div>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-purple-600 mb-1">🏷️ Kategori Harga</div>
                    <div className="text-2xl font-bold text-purple-700">{fmt(summary.totalCategories)}</div>
                    <div className="text-xs text-purple-600">dari item master</div>
                </div>
            </div>

            {/* Info banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex items-center gap-2 text-sm">
                <span>💡</span>
                <span className="text-blue-700">
                    Harga jual diambil dari <strong>Master Item Accurate</strong> (per kategori penjualan).
                    Harga sudah dinormalisasi ke <strong>per satuan dasar</strong>. Hover untuk detail konversi.
                </span>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    placeholder="🔍 Cari SKU / nama item..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-64"
                />
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="bg-white border rounded-lg px-3 py-2 text-sm"
                >
                    <option value="all">Semua Status</option>
                    <option value="NEGATIVE">🔴 Margin Negatif</option>
                    <option value="THIN">⚠️ Margin Tipis</option>
                    <option value="HEALTHY">✅ Margin Sehat</option>
                    <option value="NO_DATA">⬜ Tanpa Data</option>
                </select>
                <CategoryMultiSelect
                    allCategories={allCategories}
                    selected={categoryFilter}
                    onChange={setCategoryFilter}
                />
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchData(true)}
                    disabled={loading}
                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                >
                    {loading ? '⏳ Loading...' : '🔃 Force Sync'}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={exportToExcel}
                    disabled={items.length === 0}
                    className="border-green-300 text-green-700 hover:bg-green-50"
                >
                    📥 Export Excel
                </Button>
                <span className="text-xs text-muted-foreground ml-auto">
                    {fmt(filtered.length)} item · Hal {page}/{totalPages}
                </span>
            </div>

            {/* Top Scrollbar for Table (Synced) */}
            <div
                ref={topScrollRef}
                className="overflow-x-auto overflow-y-hidden border rounded-t-xl border-b-0 bg-slate-50"
                onScroll={() => {
                    if (tableScrollRef.current && topScrollRef.current) {
                        if (Math.abs(tableScrollRef.current.scrollLeft - topScrollRef.current.scrollLeft) > 1) {
                            tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
                        }
                    }
                }}
            >
                <div style={{ width: tableWidth || '100%', height: '1px' }}></div>
            </div>

            {/* Main Table */}
            <div className="border rounded-b-xl overflow-hidden shadow-sm">
                <div 
                    ref={tableScrollRef}
                    className="overflow-x-auto"
                    onScroll={() => {
                        if (tableScrollRef.current && topScrollRef.current) {
                            if (Math.abs(topScrollRef.current.scrollLeft - tableScrollRef.current.scrollLeft) > 1) {
                                topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
                            }
                        }
                    }}
                >
                    <table ref={tableRef} className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b">
                                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground sticky left-0 bg-slate-50 z-10 min-w-[70px]">
                                    <button onClick={() => handleSort('sku')} className="flex items-center hover:text-foreground">
                                        SKU <SortIcon col="sku" />
                                    </button>
                                </th>
                                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground min-w-[150px]">
                                    <button onClick={() => handleSort('name')} className="flex items-center hover:text-foreground">
                                        Nama Barang <SortIcon col="name" />
                                    </button>
                                </th>
                                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground min-w-[60px]">Satuan</th>
                                <th className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground min-w-[120px]">
                                    <button onClick={() => handleSort('lastBuy')} className="flex items-center justify-end hover:text-foreground">
                                        Beli Terakhir <SortIcon col="lastBuy" />
                                    </button>
                                </th>
                                <th className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground min-w-[120px]">Beli Rata²</th>
                                {displayCategories.map(([catName, catId]) => (
                                    <th key={catId} className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground min-w-[120px]">
                                        🏷️ {catName}
                                    </th>
                                ))}
                                <th className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground min-w-[80px]">
                                    <button onClick={() => handleSort('margin')} className="flex items-center justify-end hover:text-foreground">
                                        Margin <SortIcon col="margin" />
                                    </button>
                                </th>
                                <th className="px-3 py-2.5 text-center font-medium text-xs text-muted-foreground min-w-[80px]">
                                    <button onClick={() => handleSort('status')} className="flex items-center justify-center hover:text-foreground">
                                        Status <SortIcon col="status" />
                                    </button>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedItems.map((item) => {
                                const { margin: dynMargin, status: dynStatus } = getItemMargin(item, categoryFilter, marginThresholds.healthy, marginThresholds.thin);
                                const sc = statusConfig[dynStatus];
                                const bgRow = dynStatus === 'NEGATIVE' ? 'bg-red-50/40' :
                                    dynStatus === 'THIN' ? 'bg-amber-50/30' : '';

                                return (
                                    <tr key={item.itemNo} className={`border-b hover:bg-slate-50/80 transition-colors ${bgRow}`}>
                                        {/* SKU */}
                                        <td className="px-3 py-2 sticky left-0 bg-white z-10">
                                            <div className="font-mono text-xs font-medium">{item.itemNo}</div>
                                        </td>

                                        {/* Nama Barang */}
                                        <td className="px-3 py-2">
                                            <div className="text-xs truncate max-w-[250px]" title={item.itemName}>
                                                {item.itemName}
                                            </div>
                                        </td>

                                        {/* Satuan */}
                                        <td className="px-3 py-2 text-xs text-muted-foreground">
                                            {item.baseUnitName}
                                            {item.unitConversion > 0 ? (
                                                <div className="text-[10px]">
                                                    1 {item.salesUnitName}={item.unitConversion}
                                                </div>
                                            ) : (
                                                <div className="text-[10px] text-muted-foreground">1:1</div>
                                            )}
                                        </td>

                                        {/* Beli Terakhir */}
                                        <td className="px-3 py-2 text-right">
                                            {item.lastPurchasePrice > 0 ? (
                                                <PriceCell
                                                    price={item.lastPurchasePrice}
                                                    rawPrice={item.lastPurchaseRawPrice}
                                                    unitName={item.lastPurchaseUnit}
                                                    ratio={item.lastPurchaseRatio}
                                                    baseUnit={item.baseUnitName}
                                                />
                                            ) : (
                                                <span className="text-xs text-gray-400">—</span>
                                            )}
                                            {item.lastPurchaseDate && (
                                                <div className="text-[10px] text-muted-foreground">{item.lastPurchaseDate}</div>
                                            )}
                                        </td>

                                        {/* Beli Rata2 */}
                                        <td className="px-3 py-2 text-right">
                                            {item.avgPurchasePrice > 0 ? (
                                                <div>
                                                    <span className="font-mono text-sm">{hideCost ? '***' : fmtRp(item.avgPurchasePrice)}</span>
                                                    <span className="text-[10px] text-muted-foreground ml-0.5">/{item.baseUnitName}</span>
                                                    <div className="text-[10px] text-muted-foreground">
                                                        {fmt(item.purchaseInvoiceCount)} faktur
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400">—</span>
                                            )}
                                        </td>

                                        {/* Category Selling Prices */}
                                        {displayCategories.map(([catName, catId]) => {
                                            const cp = item.categoryPrices?.find(c => c.categoryName === catName);
                                            if (!cp || cp.price <= 0) return (
                                                <td key={catId} className="px-3 py-2 text-right">
                                                    <span className="text-xs text-gray-400">—</span>
                                                </td>
                                            );
                                            return (
                                                <td key={catId} className="px-3 py-2 text-right">
                                                    <PriceCell
                                                        price={cp.price}
                                                        rawPrice={cp.priceRaw}
                                                        unitName={cp.unitName}
                                                        ratio={cp.unitRatio}
                                                        baseUnit={item.baseUnitName}
                                                    />
                                                    <div className="flex items-center justify-end gap-1 mt-0.5">
                                                        <MarginBadge
                                                            margin={cp.marginVsLastPurchase}
                                                            hasData={item.lastPurchasePrice > 0}
                                                            healthy={marginThresholds.healthy}
                                                            thin={marginThresholds.thin}
                                                        />
                                                    </div>
                                                </td>
                                            );
                                        })}

                                        {/* Overall Margin — dynamic */}
                                        <td className="px-3 py-2 text-right">
                                            <MarginBadge
                                                margin={dynMargin}
                                                hasData={dynStatus !== 'NO_DATA'}
                                                healthy={marginThresholds.healthy}
                                                thin={marginThresholds.thin}
                                            />
                                            {dynStatus !== 'NO_DATA' && (
                                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                                    {categoryFilter.length === 0
                                                        ? 'avg semua kategori'
                                                        : categoryFilter.length === 1
                                                            ? categoryFilter[0]
                                                            : `avg ${categoryFilter.length} kategori`
                                                    }
                                                </div>
                                            )}
                                        </td>

                                        {/* Status */}
                                        <td className="px-3 py-2 text-center">
                                            <Badge variant="outline" className={`text-[10px] ${sc.color}`}>
                                                {sc.label}
                                            </Badge>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="px-4 py-3 bg-slate-50 border-t flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                        Menampilkan {fmt(startIdx)}-{fmt(endIdx)} dari {fmt(filtered.length)} item
                    </span>
                    <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" onClick={() => setPage(1)} disabled={page === 1} className="h-8 px-2 text-xs">⟪</Button>
                        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="h-8 px-3 text-xs">← Prev</Button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                            .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                            .reduce<(number | 'dots')[]>((acc, p, i, arr) => {
                                if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('dots');
                                acc.push(p);
                                return acc;
                            }, [])
                            .map((p, i) => (
                                p === 'dots' ? (
                                    <span key={`dots-${i}`} className="px-1 text-muted-foreground">…</span>
                                ) : (
                                    <Button key={p} variant={p === page ? 'default' : 'outline'} size="sm" onClick={() => setPage(p)}
                                        className={`h-8 w-8 p-0 text-xs ${p === page ? 'bg-slate-800 text-white' : ''}`}>{p}</Button>
                                )
                            ))
                        }
                        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="h-8 px-3 text-xs">Next →</Button>
                        <Button variant="outline" size="sm" onClick={() => setPage(totalPages)} disabled={page === totalPages} className="h-8 px-2 text-xs">⟫</Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
