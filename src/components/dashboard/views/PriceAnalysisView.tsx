'use client';

import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { PriceAnalysisItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

const fmt = (n: number) => n.toLocaleString('id-ID');
const fmtRp = (n: number) => `Rp ${fmt(n)}`;

const statusConfig = {
    HEALTHY: { label: '✅ Sehat', color: 'bg-green-50 text-green-700 border-green-200' },
    THIN: { label: '⚠️ Tipis', color: 'bg-amber-50 text-amber-700 border-amber-200' },
    NEGATIVE: { label: '🔴 Rugi', color: 'bg-red-50 text-red-700 border-red-200' },
    NO_DATA: { label: '⬜ No Data', color: 'bg-gray-50 text-gray-500 border-gray-200' },
};

function MarginBadge({ margin, hasData }: { margin: number; hasData: boolean }) {
    if (!hasData) return <span className="text-xs text-gray-400">—</span>;
    const color = margin >= 15 ? 'text-green-700 bg-green-50' :
        margin >= 5 ? 'text-amber-700 bg-amber-50' :
            margin >= 0 ? 'text-orange-700 bg-orange-50' :
                'text-red-700 bg-red-50 font-bold';
    return (
        <span className={`text-xs px-1.5 py-0.5 rounded ${color}`}>
            {margin > 0 ? '+' : ''}{margin.toFixed(1)}%
        </span>
    );
}

// Tooltip for price conversion detail
function PriceCell({ price, rawPrice, unitName, ratio, baseUnit }: {
    price: number; rawPrice: number; unitName: string; ratio: number; baseUnit: string;
}) {
    const isConverted = ratio > 1;
    return (
        <div className="group relative">
            <span className="font-mono text-sm">{fmtRp(price)}</span>
            <span className="text-[10px] text-muted-foreground ml-0.5">/{baseUnit}</span>
            {isConverted && (
                <div className="absolute z-50 hidden group-hover:block bottom-full left-0 mb-1 p-2 bg-slate-800 text-white text-[11px] rounded-lg shadow-lg whitespace-nowrap min-w-[200px]">
                    <div className="font-medium mb-1">📦 Detail Konversi</div>
                    <div>Harga faktur: {fmtRp(rawPrice)}/{unitName}</div>
                    <div>Konversi: 1 {unitName} = {ratio} {baseUnit}</div>
                    <div className="border-t border-slate-600 mt-1 pt-1 font-medium">
                        = {fmtRp(price)}/{baseUnit}
                    </div>
                </div>
            )}
        </div>
    );
}

export function PriceAnalysisView() {
    const [items, setItems] = useState<PriceAnalysisItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [sortBy, setSortBy] = useState<string>('status');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 100;

    const fetchData = async (force = false) => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams();
            params.set('from', '2025-01-01');
            if (force) params.set('force', 'true');
            const res = await axios.get(`/api/price-analysis?${params}`);
            if (Array.isArray(res.data)) {
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

    // Summary KPIs
    const summary = useMemo(() => {
        const withData = items.filter(i => i.status !== 'NO_DATA');
        return {
            total: items.length,
            analyzed: withData.length,
            healthy: items.filter(i => i.status === 'HEALTHY').length,
            thin: items.filter(i => i.status === 'THIN').length,
            negative: items.filter(i => i.status === 'NEGATIVE').length,
            noData: items.filter(i => i.status === 'NO_DATA').length,
            avgMargin: withData.length > 0
                ? withData.reduce((s, i) => s + i.marginVsLastPurchase, 0) / withData.length
                : 0,
        };
    }, [items]);

    // All branch names from data
    const allBranches = useMemo(() => {
        const branchSet = new Map<number, string>();
        items.forEach(item => {
            item.branchPrices.forEach(bp => {
                branchSet.set(bp.branchId, bp.branchName);
            });
        });
        return Array.from(branchSet.entries())
            .sort((a, b) => a[1].localeCompare(b[1]));
    }, [items]);

    // Filtered & sorted items
    const filtered = useMemo(() => {
        let list = [...items];

        // Search
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(i =>
                i.itemNo.toLowerCase().includes(q) ||
                i.itemName.toLowerCase().includes(q)
            );
        }

        // Status filter
        if (statusFilter !== 'all') {
            list = list.filter(i => i.status === statusFilter);
        }

        // Sort
        const statusOrder = { NEGATIVE: 0, THIN: 1, NO_DATA: 2, HEALTHY: 3 };
        list.sort((a, b) => {
            let diff = 0;
            switch (sortBy) {
                case 'status':
                    diff = statusOrder[a.status] - statusOrder[b.status];
                    break;
                case 'margin':
                    diff = a.marginVsLastPurchase - b.marginVsLastPurchase;
                    break;
                case 'name':
                    diff = a.itemName.localeCompare(b.itemName);
                    break;
                case 'lastBuy':
                    diff = a.lastPurchasePrice - b.lastPurchasePrice;
                    break;
            }
            return sortDir === 'asc' ? diff : -diff;
        });

        return list;
    }, [items, search, statusFilter, sortBy, sortDir]);

    // Reset page when filter/search changes
    useEffect(() => { setPage(1); }, [search, statusFilter, sortBy, sortDir]);

    // Pagination
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginatedItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const startIdx = (page - 1) * PAGE_SIZE + 1;
    const endIdx = Math.min(page * PAGE_SIZE, filtered.length);

    const handleSort = (col: string) => {
        if (sortBy === col) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(col);
            setSortDir('asc');
        }
    };

    const SortIcon = ({ col }: { col: string }) => {
        if (sortBy !== col) return <span className="text-gray-300 ml-0.5">↕</span>;
        return <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
    };

    if (loading && items.length === 0) {
        return (
            <div className="p-12 text-center">
                <div className="inline-block w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-muted-foreground text-lg">Mengambil data harga dari Accurate...</p>
                <p className="text-sm text-muted-foreground mt-1">Purchase Invoice + Sales Invoice</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 text-center">
                <p className="text-red-600 text-lg mb-2">❌ Gagal mengambil data</p>
                <p className="text-sm text-muted-foreground mb-4">{error}</p>
                <Button variant="outline" onClick={() => fetchData(true)}>
                    🔄 Coba Lagi
                </Button>
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
                    <div className="text-xs text-green-600">&gt;15% margin</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-amber-600 mb-1">⚠️ Margin Tipis</div>
                    <div className="text-2xl font-bold text-amber-700">{fmt(summary.thin)}</div>
                    <div className="text-xs text-amber-600">5-15% margin</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-red-600 mb-1">🔴 Margin Negatif</div>
                    <div className="text-2xl font-bold text-red-700">{fmt(summary.negative)}</div>
                    <div className="text-xs text-red-600">&lt;5% atau rugi</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-blue-600 mb-1">📈 Avg Margin</div>
                    <div className="text-2xl font-bold text-blue-700">{summary.avgMargin.toFixed(1)}%</div>
                    <div className="text-xs text-blue-600">vs harga beli terakhir</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 shadow-sm">
                    <div className="text-xs text-gray-500 mb-1">⬜ Tanpa Data</div>
                    <div className="text-2xl font-bold text-gray-600">{fmt(summary.noData)}</div>
                    <div className="text-xs text-gray-400">belum ada transaksi</div>
                </div>
            </div>

            {/* Tax info banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex items-center gap-2 text-sm">
                <span>💡</span>
                <span className="text-blue-700">
                    Semua harga <strong>sudah termasuk PPN</strong> (inclusive tax). Harga sudah dinormalisasi ke <strong>per satuan dasar</strong> (Pcs/Kg).
                    Hover pada harga untuk melihat detail konversi.
                </span>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    placeholder="🔍 Cari item..."
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
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchData(true)}
                    disabled={loading}
                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                >
                    {loading ? '⏳ Loading...' : '🔃 Force Sync'}
                </Button>
                <span className="text-xs text-muted-foreground ml-auto">
                    {fmt(filtered.length)} item · Hal {page}/{totalPages}
                </span>
            </div>

            {/* Main Table */}
            <div className="border rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b">
                                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground sticky left-0 bg-slate-50 z-10 min-w-[80px]">
                                    <button onClick={() => handleSort('name')} className="flex items-center hover:text-foreground">
                                        Item <SortIcon col="name" />
                                    </button>
                                </th>
                                <th className="px-3 py-2.5 text-left font-medium text-xs text-muted-foreground min-w-[60px]">Satuan</th>
                                <th className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground min-w-[130px]">
                                    <button onClick={() => handleSort('lastBuy')} className="flex items-center justify-end hover:text-foreground">
                                        Beli Terakhir <SortIcon col="lastBuy" />
                                    </button>
                                </th>
                                <th className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground min-w-[130px]">Beli Rata²</th>
                                {allBranches.map(([brId, brName]) => (
                                    <th key={brId} className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground min-w-[130px]">
                                        🏢 {brName.replace('Cabang ', '').replace('PT. GAMA AGRO SEJATI ', '')}
                                    </th>
                                ))}
                                <th className="px-3 py-2.5 text-right font-medium text-xs text-muted-foreground min-w-[90px]">
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
                            {paginatedItems.map((item, idx) => {
                                const sc = statusConfig[item.status];
                                const bgRow = item.status === 'NEGATIVE' ? 'bg-red-50/40' :
                                    item.status === 'THIN' ? 'bg-amber-50/30' : '';

                                return (
                                    <tr key={item.itemNo} className={`border-b hover:bg-slate-50/80 transition-colors ${bgRow}`}>
                                        {/* Item */}
                                        <td className="px-3 py-2 sticky left-0 bg-white z-10">
                                            <div className="font-medium text-xs">{item.itemNo}</div>
                                            <div className="text-[11px] text-muted-foreground truncate max-w-[200px]" title={item.itemName}>
                                                {item.itemName}
                                            </div>
                                        </td>

                                        {/* Satuan */}
                                        <td className="px-3 py-2 text-xs text-muted-foreground">
                                            {item.baseUnitName}
                                            {item.unitConversion > 0 && (
                                                <div className="text-[10px]">
                                                    1 {item.salesUnitName}={item.unitConversion}
                                                </div>
                                            )}
                                        </td>

                                        {/* Harga Beli Terakhir */}
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

                                        {/* Harga Beli Rata2 */}
                                        <td className="px-3 py-2 text-right">
                                            {item.avgPurchasePrice > 0 ? (
                                                <div>
                                                    <span className="font-mono text-sm">{fmtRp(item.avgPurchasePrice)}</span>
                                                    <span className="text-[10px] text-muted-foreground ml-0.5">/{item.baseUnitName}</span>
                                                    <div className="text-[10px] text-muted-foreground">
                                                        {fmt(item.purchaseInvoiceCount)} faktur
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400">—</span>
                                            )}
                                        </td>

                                        {/* Branch Selling Prices */}
                                        {allBranches.map(([brId]) => {
                                            const bp = item.branchPrices.find(b => b.branchId === brId);
                                            if (!bp) return (
                                                <td key={brId} className="px-3 py-2 text-right">
                                                    <span className="text-xs text-gray-400">—</span>
                                                </td>
                                            );
                                            return (
                                                <td key={brId} className="px-3 py-2 text-right">
                                                    <PriceCell
                                                        price={bp.sellingPrice}
                                                        rawPrice={bp.sellingPriceRaw}
                                                        unitName={bp.saleUnitName}
                                                        ratio={bp.unitRatio}
                                                        baseUnit={item.baseUnitName}
                                                    />
                                                    <div className="flex items-center justify-end gap-1 mt-0.5">
                                                        <MarginBadge
                                                            margin={bp.marginVsLastPurchase}
                                                            hasData={item.lastPurchasePrice > 0}
                                                        />
                                                    </div>
                                                </td>
                                            );
                                        })}

                                        {/* Overall Margin */}
                                        <td className="px-3 py-2 text-right">
                                            <MarginBadge
                                                margin={item.marginVsLastPurchase}
                                                hasData={item.status !== 'NO_DATA'}
                                            />
                                            {item.status !== 'NO_DATA' && item.marginVsAvgPurchase !== item.marginVsLastPurchase && (
                                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                                    avg: {item.marginVsAvgPurchase > 0 ? '+' : ''}{item.marginVsAvgPurchase.toFixed(1)}%
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

                {/* Pagination Controls */}
                <div className="px-4 py-3 bg-slate-50 border-t flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                        Menampilkan {fmt(startIdx)}-{fmt(endIdx)} dari {fmt(filtered.length)} item
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(1)}
                            disabled={page === 1}
                            className="h-8 px-2 text-xs"
                        >
                            ⟪
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="h-8 px-3 text-xs"
                        >
                            ← Prev
                        </Button>
                        {/* Page numbers */}
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
                                    <Button
                                        key={p}
                                        variant={p === page ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setPage(p)}
                                        className={`h-8 w-8 p-0 text-xs ${p === page ? 'bg-slate-800 text-white' : ''}`}
                                    >
                                        {p}
                                    </Button>
                                )
                            ))
                        }
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="h-8 px-3 text-xs"
                        >
                            Next →
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(totalPages)}
                            disabled={page === totalPages}
                            className="h-8 px-2 text-xs"
                        >
                            ⟫
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
