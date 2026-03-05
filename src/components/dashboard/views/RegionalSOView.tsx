'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
    address: string;
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

// ─── Status options ───────────────────────────────────────────

const STATUS_OPTIONS = [
    { key: 'menunggu', label: 'Menunggu Diproses', color: 'text-yellow-700 bg-yellow-50 border-yellow-300' },
    { key: 'sebagian', label: 'Sebagian Diproses', color: 'text-orange-700 bg-orange-50 border-orange-300' },
    { key: 'disetujui', label: 'Disetujui', color: 'text-blue-700 bg-blue-50 border-blue-300' },
    { key: 'terproses', label: 'Terproses', color: 'text-green-700 bg-green-50 border-green-300' },
];

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

    // ─ Filter controls
    const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['menunggu', 'sebagian']);
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');

    // ─ Table filters & sort
    const [searchCity, setSearchCity] = useState('');
    const [filterProvince, setFilterProvince] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('totalQty');
    const [sortAsc, setSortAsc] = useState(false);

    // ─ Expand
    const [expandedCity, setExpandedCity] = useState<string | null>(null);
    const [expandTab, setExpandTab] = useState<'customers' | 'items'>('customers');

    const buildParams = useCallback((forceCity = false) => {
        const params = new URLSearchParams();
        // Status
        if (selectedStatuses.length === 0 || selectedStatuses.length === STATUS_OPTIONS.length) {
            params.set('status', 'all');
        } else {
            params.set('status', selectedStatuses.join(','));
        }
        // Date
        if (fromDate) params.set('from', fromDate);
        if (toDate) params.set('to', toDate);
        if (forceCity) params.set('refresh', 'true');
        return params.toString();
    }, [selectedStatuses, fromDate, toDate]);

    const fetchData = useCallback(async (forceCity = false) => {
        setLoading(true);
        setError(null);
        setExpandedCity(null);
        try {
            const qs = buildParams(forceCity);
            const res = await fetch(`/api/so-regional?${qs}`);
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
    }, [buildParams]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const toggleStatus = (key: string) => {
        setSelectedStatuses(prev =>
            prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
        );
    };
    const selectAllStatuses = () => setSelectedStatuses(STATUS_OPTIONS.map(s => s.key));
    const clearStatuses = () => setSelectedStatuses([]);

    const handleApply = () => fetchData(false);
    const handleRefreshCity = () => { setRefreshing(true); fetchData(true); };

    // Derived
    const provinces = useMemo(() =>
        [...new Set(regional.map(r => r.province).filter(p => p && p !== '-'))].sort(),
        [regional]
    );

    const filtered = useMemo(() => {
        let data = regional.filter(r => {
            const matchCity = !searchCity || r.city.toLowerCase().includes(searchCity.toLowerCase());
            const matchProv = !filterProvince || r.province === filterProvince;
            return matchCity && matchProv;
        });
        data = [...data].sort((a, b) => {
            const av = sortKey === 'city' ? a.city : (a[sortKey] as number);
            const bv = sortKey === 'city' ? b.city : (b[sortKey] as number);
            if (typeof av === 'string') return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
            return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
        });
        return data;
    }, [regional, searchCity, filterProvince, sortKey, sortAsc]);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortAsc(p => !p);
        else { setSortKey(key); setSortAsc(false); }
    };

    const SortIcon = ({ k }: { k: SortKey }) =>
        sortKey === k ? <span className="ml-0.5">{sortAsc ? '▲' : '▼'}</span> : <span className="ml-0.5 text-gray-300">⇅</span>;

    const handleExport = () => {
        const rows = [['Kota', 'Provinsi', 'Customer', 'SO', 'Total Qty', 'Outstanding', 'Total Nilai (Rp)']];
        for (const r of filtered) {
            rows.push([r.city, r.province, r.customerCount, r.soCount, r.totalQty, r.totalOutstanding, r.totalValue] as any);
        }
        const csv = rows.map(r => r.join('\t')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `SO_Wilayah_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    };

    // ─── Render ───────────────────────────────────────────────

    return (
        <div className="space-y-4">

            {/* ─── Filter Panel ─────────────────────────────── */}
            <div className="bg-white border rounded-xl p-4 shadow-sm space-y-3">
                {/* Row 1: Status checkboxes */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-gray-600 mr-1">Status SO:</span>
                    {STATUS_OPTIONS.map(opt => (
                        <button
                            key={opt.key}
                            onClick={() => toggleStatus(opt.key)}
                            className={`text-[11px] px-2.5 py-1 rounded-full border font-medium transition-all ${selectedStatuses.includes(opt.key)
                                ? opt.color + ' ring-1 ring-offset-1 ring-current'
                                : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                                }`}
                        >
                            {selectedStatuses.includes(opt.key) ? '✓ ' : ''}{opt.label}
                        </button>
                    ))}
                    <button onClick={selectAllStatuses} className="text-[11px] text-blue-600 hover:underline px-1">Semua</button>
                    <span className="text-gray-300">|</span>
                    <button onClick={clearStatuses} className="text-[11px] text-gray-500 hover:underline px-1">Kosongkan</button>
                </div>

                {/* Row 2: Date range + apply */}
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-semibold text-gray-600">Periode:</span>
                    <div className="flex items-center gap-2">
                        <input
                            type="date"
                            value={fromDate}
                            onChange={e => setFromDate(e.target.value)}
                            className="text-xs border rounded-lg px-2 py-1.5 bg-white focus:ring-1 focus:ring-blue-300 outline-none"
                        />
                        <span className="text-xs text-gray-400">s/d</span>
                        <input
                            type="date"
                            value={toDate}
                            onChange={e => setToDate(e.target.value)}
                            className="text-xs border rounded-lg px-2 py-1.5 bg-white focus:ring-1 focus:ring-blue-300 outline-none"
                        />
                        {(fromDate || toDate) && (
                            <button
                                onClick={() => { setFromDate(''); setToDate(''); }}
                                className="text-[11px] text-gray-400 hover:text-red-500"
                            >✕ Reset</button>
                        )}
                    </div>
                    <Button size="sm" onClick={handleApply} disabled={loading} className="text-xs h-7 bg-blue-600 hover:bg-blue-700">
                        {loading ? '⟳ Memuat...' : '🔍 Tampilkan'}
                    </Button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
                    ⚠️ {error}
                    <Button size="sm" onClick={() => fetchData()} className="ml-3 bg-red-600 hover:bg-red-700 text-white text-xs">Coba Lagi</Button>
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center h-40 text-gray-400">
                    <div className="text-center">
                        <div className="w-7 h-7 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-xs">Memuat data wilayah SO...</p>
                    </div>
                </div>
            )}

            {!loading && !error && (
                <>
                    {/* ─── Header row ───────────────────────────── */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-bold text-gray-800">📍 Analisa SO per Wilayah</h2>
                            <p className="text-xs text-gray-500">
                                {summary && summary.dateFrom
                                    ? <><span className="font-medium">{summary.totalSOs}</span> SO &middot; 📅 {fmtDate(summary.dateFrom)} — {fmtDate(summary.dateTo)}</>
                                    : 'Tidak ada data SO untuk filter ini'
                                }
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={handleExport} className="text-xs">📥 Export</Button>
                            <Button
                                variant="outline" size="sm" onClick={handleRefreshCity} disabled={refreshing}
                                className="text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                                title="Refresh data kota dari Accurate (maks 1x per 6 jam auto-cache)"
                            >
                                {refreshing ? '⟳ Memuat...' : '🔄 Refresh Kota'}
                            </Button>
                        </div>
                    </div>

                    {/* ─── Summary Cards ───────────────────────── */}
                    {summary && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                            {[
                                { label: 'Kota/Kab', value: fmt(summary.totalCities), icon: '🗺️', color: 'bg-blue-50 border-blue-200' },
                                { label: 'Customer', value: fmt(summary.totalCustomers), icon: '🏪', color: 'bg-green-50 border-green-200' },
                                { label: 'Total SO', value: fmt(summary.totalSOs), icon: '📋', color: 'bg-purple-50 border-purple-200' },
                                { label: 'Total Qty', value: fmt(summary.totalQty), icon: '📦', color: 'bg-amber-50 border-amber-200' },
                                { label: 'Outstanding', value: fmt(summary.totalOutstanding), icon: '⏳', color: 'bg-orange-50 border-orange-200' },
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
                            ⚠️ {summary.unmapped} SO tidak ditemukan data kotanya — ditampilkan di baris &quot;Tidak Diketahui&quot;.
                            Pastikan alamat customer sudah diisi di Accurate, lalu klik <strong>Refresh Kota</strong>.
                        </div>
                    )}

                    {/* ─── Table Filters ───────────────────────── */}
                    <div className="flex flex-wrap gap-2 items-center">
                        <input
                            type="text"
                            value={searchCity}
                            onChange={e => setSearchCity(e.target.value)}
                            placeholder="🔍 Cari kota..."
                            className="text-xs border rounded-lg px-3 py-1.5 bg-white w-40 focus:ring-1 focus:ring-blue-300 outline-none"
                        />
                        <select
                            value={filterProvince}
                            onChange={e => setFilterProvince(e.target.value)}
                            className="text-xs border rounded-lg px-3 py-1.5 bg-white focus:ring-1 focus:ring-blue-300 outline-none"
                        >
                            <option value="">Semua Provinsi</option>
                            {provinces.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <span className="text-xs text-gray-400">{filtered.length} kota ditampilkan</span>
                    </div>

                    {/* ─── Table ───────────────────────────────── */}
                    {regional.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <p className="text-4xl mb-3">📭</p>
                            <p className="text-sm">Tidak ada SO untuk filter yang dipilih</p>
                        </div>
                    ) : (
                        <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-50 border-b">
                                        <tr>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold w-8">#</th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('city')}>
                                                Kota/Kab <SortIcon k="city" />
                                            </th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">Provinsi</th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('customerCount')}>
                                                Customer <SortIcon k="customerCount" />
                                            </th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('soCount')}>
                                                SO <SortIcon k="soCount" />
                                            </th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('totalQty')}>
                                                Total Qty <SortIcon k="totalQty" />
                                            </th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('totalOutstanding')}>
                                                Outstanding <SortIcon k="totalOutstanding" />
                                            </th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('totalValue')}>
                                                Nilai <SortIcon k="totalValue" />
                                            </th>
                                            <th className="text-center px-3 py-2.5 text-gray-500 font-semibold">Detail</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map((row, idx) => {
                                            const isExpanded = expandedCity === row.city;
                                            return (
                                                <React.Fragment key={row.city}>
                                                    <tr className={`border-b transition-colors ${isExpanded ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50'} ${row.city === 'Tidak Diketahui' ? 'opacity-60' : ''}`}>
                                                        <td className="px-3 py-2.5 text-gray-400">{idx + 1}</td>
                                                        <td className="px-3 py-2.5 font-semibold text-gray-800">{row.city}</td>
                                                        <td className="px-3 py-2.5 text-gray-500 text-[11px]">{row.province}</td>
                                                        <td className="px-3 py-2.5 text-right font-medium text-green-700">{fmt(row.customerCount)}</td>
                                                        <td className="px-3 py-2.5 text-right font-medium text-purple-700">{fmt(row.soCount)}</td>
                                                        <td className="px-3 py-2.5 text-right font-medium text-blue-700">{fmt(row.totalQty)}</td>
                                                        <td className="px-3 py-2.5 text-right">
                                                            {row.totalOutstanding > 0
                                                                ? <span className="text-orange-600 font-medium">{fmt(row.totalOutstanding)}</span>
                                                                : <span className="text-gray-300">-</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right text-gray-700 font-medium">{fmtRp(row.totalValue)}</td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            <button
                                                                onClick={() => { setExpandedCity(isExpanded ? null : row.city); setExpandTab('customers'); }}
                                                                className="text-blue-600 hover:text-blue-800 font-medium text-[11px] border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50 transition"
                                                            >
                                                                {isExpanded ? '▲' : '▼'} Detail
                                                            </button>
                                                        </td>
                                                    </tr>

                                                    {/* ─ Expanded ─ */}
                                                    {isExpanded && (
                                                        <tr className="bg-blue-50/30">
                                                            <td colSpan={9} className="px-4 py-3">
                                                                {/* Tabs */}
                                                                <div className="flex gap-2 mb-3">
                                                                    {[
                                                                        { key: 'customers', label: `🏪 Customer (${row.customerCount})` },
                                                                        { key: 'items', label: `📦 Top Item (${row.topItems.length})` },
                                                                    ].map(tab => (
                                                                        <button key={tab.key}
                                                                            onClick={() => setExpandTab(tab.key as any)}
                                                                            className={`text-xs px-3 py-1 rounded-lg border font-medium transition ${expandTab === tab.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                                                        >{tab.label}</button>
                                                                    ))}
                                                                </div>

                                                                {/* Customer tab */}
                                                                {expandTab === 'customers' && (
                                                                    <div className="bg-white rounded-lg border overflow-hidden">
                                                                        <table className="w-full text-xs">
                                                                            <thead className="bg-gray-50 border-b">
                                                                                <tr>
                                                                                    <th className="text-left px-3 py-2 text-gray-500">Customer</th>
                                                                                    <th className="text-left px-3 py-2 text-gray-500">Alamat</th>
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
                                                                                        <td className="px-3 py-2 font-medium text-gray-700 max-w-[160px]">{c.customerName}</td>
                                                                                        <td className="px-3 py-2 text-gray-400 text-[10px] max-w-[160px] truncate" title={c.address}>{c.address || '-'}</td>
                                                                                        <td className="px-3 py-2 text-right text-purple-600">{c.soCount}</td>
                                                                                        <td className="px-3 py-2 text-right text-blue-600 font-medium">{fmt(c.totalQty)}</td>
                                                                                        <td className="px-3 py-2 text-right">
                                                                                            {c.totalOutstanding > 0
                                                                                                ? <span className="text-orange-500">{fmt(c.totalOutstanding)}</span>
                                                                                                : <span className="text-gray-300">-</span>}
                                                                                        </td>
                                                                                        <td className="px-3 py-2 text-right text-gray-600">{fmtRp(c.totalValue)}</td>
                                                                                        <td className="px-3 py-2 text-gray-400 text-[10px]">
                                                                                            {c.soNumbers.slice(0, 4).join(', ')}
                                                                                            {c.soNumbers.length > 4 && <span className="italic"> +{c.soNumbers.length - 4} lagi</span>}
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
                                                                                    <th className="text-right px-3 py-2 text-gray-500">Qty</th>
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
                    )}
                </>
            )}
        </div>
    );
};
