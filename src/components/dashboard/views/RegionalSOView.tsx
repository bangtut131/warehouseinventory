'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────

interface RegionalItem {
    itemNo: string;
    itemName: string;
    totalQty: number;
    totalOutstanding: number;
    totalValue: number;
}

interface RegionalCustomer {
    customerName: string;
    soCount: number;
    totalQty: number;
    totalOutstanding: number;
    totalValue: number;
    soNumbers: string[];
}

interface RegionalEntry {
    city: string;
    province: string;
    customerCount: number;
    soCount: number;
    totalQty: number;
    totalOutstanding: number;
    totalValue: number;
    customers: RegionalCustomer[];
    topItems: RegionalItem[];
}

interface RegionalSummary {
    totalCities: number;
    totalCustomers: number;
    totalSOs: number;
    totalQty: number;
    totalOutstanding: number;
    totalValue: number;
    unmapped: number;
    dateFrom: string | null;
    dateTo: string | null;
}

type SortKey = 'city' | 'customerCount' | 'soCount' | 'totalQty' | 'totalOutstanding' | 'totalValue';

// ─── Helpers ─────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('id-ID');
const fmtRp = (n: number) => `Rp ${(n / 1_000_000).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}jt`;
const fmtDate = (iso: string | null) => {
    if (!iso) return '-';
    const [y, m, d] = iso.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${d} ${months[parseInt(m) - 1]} ${y}`;
};

// ─── Component ───────────────────────────────────────────────

export const RegionalSOView: React.FC = () => {
    const [regional, setRegional] = useState<RegionalEntry[]>([]);
    const [summary, setSummary] = useState<RegionalSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    // Filters & sort
    const [searchCity, setSearchCity] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('totalQty');
    const [sortAsc, setSortAsc] = useState(false);

    // Unit toggle
    const [useBox, setUseBox] = useState(false);

    // Expand
    const [expandedCity, setExpandedCity] = useState<string | null>(null);
    const [expandTab, setExpandTab] = useState<'customers' | 'items'>('customers');

    const fetchData = useCallback(async (refresh = false) => {
        setLoading(true);
        setError(null);
        try {
            const url = refresh ? '/api/so-regional?refresh=true' : '/api/so-regional';
            const res = await fetch(url);
            if (!res.ok) {
                const j = await res.json();
                throw new Error(j.error || 'Gagal memuat data');
            }
            const data = await res.json();
            setRegional(data.regional || []);
            setSummary(data.summary || null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleRefresh = () => {
        setRefreshing(true);
        fetchData(true);
    };

    // Derived: unique provinces — not needed (no province in data)

    // Filtered + sorted
    const filtered = useMemo(() => {
        let data = regional.filter(r => {
            return !searchCity || r.city.toLowerCase().includes(searchCity.toLowerCase());
        });
        data = [...data].sort((a, b) => {
            const av = sortKey === 'city' ? a.city : (a[sortKey] as number);
            const bv = sortKey === 'city' ? b.city : (b[sortKey] as number);
            if (typeof av === 'string') return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
            return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
        });
        return data;
    }, [regional, searchCity, sortKey, sortAsc]);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortAsc(p => !p);
        else { setSortKey(key); setSortAsc(false); }
    };

    const SortIcon = ({ k }: { k: SortKey }) =>
        sortKey === k ? <span className="ml-1">{sortAsc ? '▲' : '▼'}</span> : <span className="ml-1 text-gray-300">⇅</span>;

    // Excel export
    const handleExport = () => {
        const rows = [['Kota', 'Provinsi', 'Customer', 'SO', 'Total Qty (Pcs)', 'Outstanding (Pcs)', 'Total Nilai (Rp)']];
        for (const r of filtered) {
            rows.push([r.city, r.province, r.customerCount, r.soCount, r.totalQty, r.totalOutstanding, r.totalValue] as any);
        }
        const csv = rows.map(r => r.join('\t')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `SO_Regional_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    };

    if (loading) return (
        <div className="flex items-center justify-center h-64 text-gray-500">
            <div className="text-center">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm">Memuat data wilayah SO...</p>
            </div>
        </div>
    );

    if (error) return (
        <div className="flex items-center justify-center h-64">
            <div className="text-center bg-red-50 border border-red-200 rounded-xl p-6">
                <p className="text-red-600 font-semibold mb-2">⚠️ Gagal Memuat Data</p>
                <p className="text-sm text-red-500 mb-4">{error}</p>
                <Button size="sm" onClick={() => fetchData()} className="bg-red-600 hover:bg-red-700 text-white">Coba Lagi</Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {/* ─── Header ───────────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-800">📍 Analisa SO per Wilayah</h2>
                    <p className="text-xs text-gray-500">
                        Distribusi beban SO berdasarkan kota/kabupaten
                        {summary && summary.dateFrom && (
                            <span className="ml-2 bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5 text-[10px] font-medium">
                                📅 {fmtDate(summary.dateFrom)} — {fmtDate(summary.dateTo)}
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {/* Unit Toggle */}
                    <div className="flex items-center bg-gray-100 rounded-lg p-0.5 border">
                        <button
                            onClick={() => setUseBox(false)}
                            className={`px-3 py-1 text-xs rounded-md transition-all font-medium ${!useBox ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >Pcs</button>
                        <button
                            onClick={() => setUseBox(true)}
                            className={`px-3 py-1 text-xs rounded-md transition-all font-medium ${useBox ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >Box</button>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleExport} className="text-xs">📥 Export</Button>
                </div>
            </div>

            {/* ─── Summary Cards ────────────────────────────── */}
            {summary && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {[
                        { label: 'Kota/Kab', value: fmt(summary.totalCities), icon: '🗺️', color: 'bg-blue-50 border-blue-200' },
                        { label: 'Customer', value: fmt(summary.totalCustomers), icon: '🏪', color: 'bg-green-50 border-green-200' },
                        { label: 'Total SO', value: fmt(summary.totalSOs), icon: '📋', color: 'bg-purple-50 border-purple-200' },
                        { label: 'Total Qty', value: fmt(summary.totalQty) + ' pcs', icon: '📦', color: 'bg-amber-50 border-amber-200' },
                        { label: 'Outstanding', value: fmt(summary.totalOutstanding) + ' pcs', icon: '⏳', color: 'bg-orange-50 border-orange-200' },
                        { label: 'Total Nilai', value: fmtRp(summary.totalValue), icon: '💰', color: 'bg-indigo-50 border-indigo-200' },
                    ].map(card => (
                        <Card key={card.label} className={`border ${card.color}`}>
                            <CardContent className="p-3">
                                <p className="text-lg">{card.icon}</p>
                                <p className="text-xs text-gray-500 mt-0.5">{card.label}</p>
                                <p className="text-sm font-bold text-gray-800 mt-0.5">{card.value}</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
            {summary && summary.unmapped > 0 && (
                <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    ⚠️ {summary.unmapped} SO tidak ditemukan data kotanya (customer mungkin belum ada kota di Accurate).
                    Ditampilkan dalam baris &quot;Tidak Diketahui&quot;.
                </div>
            )}

            {/* ─── Filters ──────────────────────────────────── */}
            <div className="flex flex-wrap gap-2 items-center">
                <input
                    type="text"
                    value={searchCity}
                    onChange={e => setSearchCity(e.target.value)}
                    placeholder="🔍 Cari kota..."
                    className="text-xs border rounded-lg px-3 py-1.5 bg-white w-44 focus:ring-1 focus:ring-blue-300 outline-none"
                />
                <span className="text-xs text-gray-400 ml-1">{filtered.length} kota</span>
            </div>

            {/* ─── Table ────────────────────────────────────── */}
            <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="text-left px-3 py-2.5 text-gray-500 font-semibold w-8">#</th>
                                <th
                                    className="text-left px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none"
                                    onClick={() => handleSort('city')}
                                >Kota/Kab <SortIcon k="city" /></th>
                                <th
                                    className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none"
                                    onClick={() => handleSort('customerCount')}
                                >Customer <SortIcon k="customerCount" /></th>
                                <th
                                    className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none"
                                    onClick={() => handleSort('soCount')}
                                >SO <SortIcon k="soCount" /></th>
                                <th
                                    className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none"
                                    onClick={() => handleSort('totalQty')}
                                >{useBox ? 'Qty (Box)' : 'Qty (Pcs)'} <SortIcon k="totalQty" /></th>
                                <th
                                    className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none"
                                    onClick={() => handleSort('totalOutstanding')}
                                >Outstanding <SortIcon k="totalOutstanding" /></th>
                                <th
                                    className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none"
                                    onClick={() => handleSort('totalValue')}
                                >Nilai <SortIcon k="totalValue" /></th>
                                <th className="text-center px-3 py-2.5 text-gray-500 font-semibold">Detail</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 && (
                                <tr><td colSpan={9} className="text-center py-12 text-gray-400">Tidak ada data</td></tr>
                            )}
                            {filtered.map((row, idx) => {
                                const isExpanded = expandedCity === row.city;
                                return (
                                    <React.Fragment key={row.city}>
                                        <tr
                                            className={`border-b transition-colors ${isExpanded ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50'} ${row.city === 'Tidak Diketahui' ? 'text-gray-400' : ''}`}
                                        >
                                            <td className="px-3 py-2.5 text-gray-400">{idx + 1}</td>
                                            <td className="px-3 py-2.5 font-semibold text-gray-800">
                                                {row.city}
                                            </td>
                                            <td className="px-3 py-2.5 text-right">
                                                <span className="font-medium text-green-700">{fmt(row.customerCount)}</span>
                                            </td>
                                            <td className="px-3 py-2.5 text-right">
                                                <span className="font-medium text-purple-700">{fmt(row.soCount)}</span>
                                            </td>
                                            <td className="px-3 py-2.5 text-right font-medium text-blue-700">
                                                {fmt(row.totalQty)}
                                            </td>
                                            <td className="px-3 py-2.5 text-right">
                                                {row.totalOutstanding > 0
                                                    ? <span className="text-orange-600 font-medium">{fmt(row.totalOutstanding)}</span>
                                                    : <span className="text-gray-300">-</span>}
                                            </td>
                                            <td className="px-3 py-2.5 text-right text-gray-700 font-medium">
                                                {fmtRp(row.totalValue)}
                                            </td>
                                            <td className="px-3 py-2.5 text-center">
                                                <button
                                                    onClick={() => {
                                                        setExpandedCity(isExpanded ? null : row.city);
                                                        setExpandTab('customers');
                                                    }}
                                                    className="text-blue-600 hover:text-blue-800 font-medium text-[11px] border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50 transition"
                                                >
                                                    {isExpanded ? '▲ Tutup' : '▼ Detail'}
                                                </button>
                                            </td>
                                        </tr>

                                        {/* Expanded row */}
                                        {isExpanded && (
                                            <tr className="bg-blue-50/30">
                                                <td colSpan={9} className="px-4 py-3">
                                                    {/* Tab switcher */}
                                                    <div className="flex gap-2 mb-3">
                                                        <button
                                                            onClick={() => setExpandTab('customers')}
                                                            className={`text-xs px-3 py-1 rounded-lg border font-medium transition ${expandTab === 'customers' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                                        >
                                                            🏪 Customer ({row.customerCount})
                                                        </button>
                                                        <button
                                                            onClick={() => setExpandTab('items')}
                                                            className={`text-xs px-3 py-1 rounded-lg border font-medium transition ${expandTab === 'items' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                                        >
                                                            📦 Top Item ({row.topItems.length})
                                                        </button>
                                                    </div>

                                                    {/* Customers tab */}
                                                    {expandTab === 'customers' && (
                                                        <div className="bg-white rounded-lg border overflow-hidden">
                                                            <table className="w-full text-xs">
                                                                <thead className="bg-gray-50 border-b">
                                                                    <tr>
                                                                        <th className="text-left px-3 py-2 text-gray-500">Customer</th>
                                                                        <th className="text-right px-3 py-2 text-gray-500">SO</th>
                                                                        <th className="text-right px-3 py-2 text-gray-500">Qty</th>
                                                                        <th className="text-right px-3 py-2 text-gray-500">Outstanding</th>
                                                                        <th className="text-right px-3 py-2 text-gray-500">Nilai</th>
                                                                        <th className="text-left px-3 py-2 text-gray-500">No. SO</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {row.customers.map(c => (
                                                                        <tr key={c.customerName} className="border-b border-gray-50 hover:bg-gray-50">
                                                                            <td className="px-3 py-2 font-medium text-gray-700">{c.customerName}</td>
                                                                            <td className="px-3 py-2 text-right text-purple-600">{c.soCount}</td>
                                                                            <td className="px-3 py-2 text-right text-blue-600 font-medium">{fmt(c.totalQty)}</td>
                                                                            <td className="px-3 py-2 text-right">
                                                                                {c.totalOutstanding > 0
                                                                                    ? <span className="text-orange-500">{fmt(c.totalOutstanding)}</span>
                                                                                    : <span className="text-gray-300">-</span>}
                                                                            </td>
                                                                            <td className="px-3 py-2 text-right text-gray-600">{fmtRp(c.totalValue)}</td>
                                                                            <td className="px-3 py-2 text-gray-400 text-[10px] max-w-xs truncate">
                                                                                {c.soNumbers.slice(0, 5).join(', ')}
                                                                                {c.soNumbers.length > 5 && ` +${c.soNumbers.length - 5} lagi`}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}

                                                    {/* Items tab */}
                                                    {expandTab === 'items' && (
                                                        <div className="bg-white rounded-lg border overflow-hidden">
                                                            <table className="w-full text-xs">
                                                                <thead className="bg-gray-50 border-b">
                                                                    <tr>
                                                                        <th className="text-left px-3 py-2 text-gray-500">#</th>
                                                                        <th className="text-left px-3 py-2 text-gray-500">Kode</th>
                                                                        <th className="text-left px-3 py-2 text-gray-500">Produk</th>
                                                                        <th className="text-right px-3 py-2 text-gray-500">Total Qty</th>
                                                                        <th className="text-right px-3 py-2 text-gray-500">Outstanding</th>
                                                                        <th className="text-right px-3 py-2 text-gray-500">Nilai</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {row.topItems.map((item, i) => (
                                                                        <tr key={item.itemNo} className="border-b border-gray-50 hover:bg-gray-50">
                                                                            <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                                                                            <td className="px-3 py-2 text-gray-500 font-mono text-[10px]">{item.itemNo}</td>
                                                                            <td className="px-3 py-2 text-gray-700 font-medium">{item.itemName}</td>
                                                                            <td className="px-3 py-2 text-right text-blue-600 font-medium">{fmt(item.totalQty)}</td>
                                                                            <td className="px-3 py-2 text-right">
                                                                                {item.totalOutstanding > 0
                                                                                    ? <span className="text-orange-500">{fmt(item.totalOutstanding)}</span>
                                                                                    : <span className="text-gray-300">-</span>}
                                                                            </td>
                                                                            <td className="px-3 py-2 text-right text-gray-600">{fmtRp(item.totalValue)}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
