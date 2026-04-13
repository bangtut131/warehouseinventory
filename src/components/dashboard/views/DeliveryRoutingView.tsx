'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ─── Types ──────────────────────────────────────────────────

interface AreaSOItem {
    soNumber: string;
    customerName: string;
    customerNo?: string;
    transDate: string;
    statusName: string;
    deliveryStatus?: string;
    itemCount: number;
    totalWeightKg: number;
    totalVolumeM3: number;
    totalValue: number;
    outstandingPcs: number;
}

interface AreaGroup {
    area: string;
    cluster: string;
    cities: string[];
    province: string;
    soCount: number;
    customerCount: number;
    itemCount: number;
    totalWeightKg: number;
    totalVolumeM3: number;
    totalValue: number;
    totalOutstandingPcs: number;
    oldestSODate: string;
    soItems: AreaSOItem[];
}

interface Summary {
    totalAreas: number;
    totalSO: number;
    totalWeight: number;
    totalVolume: number;
    totalValue: number;
    totalTrucks: number;
    truckWeightKg: number;
    truckVolumeM3: number;
}

type SortKey = 'area' | 'soCount' | 'customerCount' | 'totalWeightKg' | 'totalVolumeM3' | 'totalValue' | 'oldestSODate';

// ─── Helpers ────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('id-ID');
const fmtDec = (n: number, d = 2) => n.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtRp = (n: number) => `Rp ${(n / 1_000_000).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}jt`;
const fmtDate = (iso: string) => {
    if (!iso) return '-';
    const [y, m, d] = iso.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${d} ${months[parseInt(m) - 1]} ${y}`;
};

const daysSince = (iso: string): number => {
    if (!iso) return 0;
    const diff = Date.now() - new Date(iso).getTime();
    return Math.floor(diff / 86400000);
};

// ─── Progress Bar ───────────────────────────────────────────

const CapacityBar = ({ used, max, label, unit }: { used: number; max: number; label: string; unit: string }) => {
    const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
    const over = used > max;
    return (
        <div className="flex-1 min-w-[140px]">
            <div className="flex justify-between text-[10px] mb-0.5">
                <span className="text-gray-500">{label}</span>
                <span className={over ? 'text-red-600 font-bold' : 'text-gray-600'}>{fmtDec(used, 1)} / {fmtDec(max, 1)} {unit}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                    className={`h-2 rounded-full transition-all duration-500 ${over ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                />
            </div>
        </div>
    );
};

// ─── Truck Badge ────────────────────────────────────────────

const TruckBadge = ({ weight, volume, truckW, truckV }: { weight: number; volume: number; truckW: number; truckV: number }) => {
    const byW = truckW > 0 ? Math.ceil(weight / truckW) : 0;
    const byV = truckV > 0 ? Math.ceil(volume / truckV) : 0;
    const trucks = Math.max(byW, byV, 1);
    const color = trucks > 2 ? 'bg-red-100 text-red-700 border-red-200'
        : trucks > 1 ? 'bg-amber-100 text-amber-700 border-amber-200'
            : 'bg-emerald-100 text-emerald-700 border-emerald-200';
    return (
        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-bold ${color}`}>
            🚛 {trucks} truk
        </span>
    );
};

// ─── Main Component ─────────────────────────────────────────

export const DeliveryRoutingView: React.FC = () => {
    const [areas, setAreas] = useState<AreaGroup[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load planning state
    const [truckWeightKg, setTruckWeightKg] = useState(() => {
        if (typeof window !== 'undefined') return parseFloat(localStorage.getItem('truckWeightKg') || '5000');
        return 5000;
    });
    const [truckVolumeM3, setTruckVolumeM3] = useState(() => {
        if (typeof window !== 'undefined') return parseFloat(localStorage.getItem('truckVolumeM3') || '16');
        return 16;
    });

    // UI state
    const [expandedArea, setExpandedArea] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('totalWeightKg');
    const [sortAsc, setSortAsc] = useState(false);
    const [searchArea, setSearchArea] = useState('');
    const [filterProvince, setFilterProvince] = useState('');

    // Save truck capacity to localStorage
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('truckWeightKg', String(truckWeightKg));
            localStorage.setItem('truckVolumeM3', String(truckVolumeM3));
        }
    }, [truckWeightKg, truckVolumeM3]);

    // Fetch data
    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                truckWeight: String(truckWeightKg),
                truckVolume: String(truckVolumeM3),
            });
            const res = await fetch(`/api/delivery-routing?${params}`);
            if (!res.ok) {
                const j = await res.json();
                throw new Error(j.error || 'Gagal memuat data');
            }
            const data = await res.json();
            setAreas(data.areas || []);
            setSummary(data.summary || null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [truckWeightKg, truckVolumeM3]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Sort & filter
    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortAsc(p => !p);
        else { setSortKey(key); setSortAsc(false); }
    };

    const SortIcon = ({ k }: { k: SortKey }) =>
        sortKey === k ? <span className="ml-0.5">{sortAsc ? '▲' : '▼'}</span> : <span className="ml-0.5 text-gray-300">⇅</span>;

    const provinces = useMemo(() =>
        [...new Set(areas.map(a => a.province).filter(p => p && p !== '-'))].sort(), [areas]);

    const filtered = useMemo(() => {
        let data = areas.filter(a => {
            const matchSearch = !searchArea || a.area.toLowerCase().includes(searchArea.toLowerCase())
                || a.cluster.toLowerCase().includes(searchArea.toLowerCase())
                || a.cities.some(c => c.toLowerCase().includes(searchArea.toLowerCase()));
            const matchProv = !filterProvince || a.province === filterProvince;
            return matchSearch && matchProv;
        });
        return [...data].sort((a, b) => {
            let av: any, bv: any;
            if (sortKey === 'area') { av = a.area; bv = b.area; }
            else if (sortKey === 'oldestSODate') { av = a.oldestSODate; bv = b.oldestSODate; }
            else { av = a[sortKey]; bv = b[sortKey]; }
            if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            return sortAsc ? av - bv : bv - av;
        });
    }, [areas, searchArea, filterProvince, sortKey, sortAsc]);

    // Export
    const handleExport = () => {
        const rows: any[][] = [['Area', 'Cluster', 'Kota', 'Provinsi', 'SO', 'Customer', 'Berat (kg)', 'Volume (m³)', 'Nilai', 'Est. Truk']];
        for (const a of filtered) {
            const trucks = Math.max(
                truckWeightKg > 0 ? Math.ceil(a.totalWeightKg / truckWeightKg) : 0,
                truckVolumeM3 > 0 ? Math.ceil(a.totalVolumeM3 / truckVolumeM3) : 0,
                1
            );
            rows.push([a.area, a.cluster, a.cities.join(', '), a.province, a.soCount, a.customerCount, a.totalWeightKg, a.totalVolumeM3, a.totalValue, trucks]);
        }
        const csv = rows.map(r => r.join('\t')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Delivery_Routing_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
    };

    return (
        <div className="space-y-4">
            {/* ─── Load Planning Panel ─────────────────────── */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white rounded-xl p-5 shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-bold flex items-center gap-2">🚛 Delivery Routing</h2>
                        <p className="text-xs text-slate-300 mt-0.5">Perencanaan pengiriman berdasarkan area & kapasitas truk</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
                            <span className="text-xs text-slate-300 whitespace-nowrap">⚖️ Maks Berat:</span>
                            <input
                                type="number"
                                value={truckWeightKg}
                                onChange={e => setTruckWeightKg(parseFloat(e.target.value) || 0)}
                                className="bg-transparent text-white text-sm border-none outline-none w-20 text-right font-bold"
                            />
                            <span className="text-xs text-slate-400">kg</span>
                        </div>
                        <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
                            <span className="text-xs text-slate-300 whitespace-nowrap">📦 Maks Volume:</span>
                            <input
                                type="number"
                                value={truckVolumeM3}
                                onChange={e => setTruckVolumeM3(parseFloat(e.target.value) || 0)}
                                className="bg-transparent text-white text-sm border-none outline-none w-16 text-right font-bold"
                                step="0.5"
                            />
                            <span className="text-xs text-slate-400">m³</span>
                        </div>
                    </div>
                </div>

                {/* Global capacity bars */}
                {summary && (
                    <div className="mt-4 flex gap-6">
                        <CapacityBar
                            used={summary.totalWeight}
                            max={truckWeightKg * summary.totalTrucks}
                            label="Total Berat"
                            unit="kg"
                        />
                        <CapacityBar
                            used={summary.totalVolume}
                            max={truckVolumeM3 * summary.totalTrucks}
                            label="Total Volume"
                            unit="m³"
                        />
                    </div>
                )}
            </div>

            {/* ─── Summary Cards ──────────────────────────── */}
            {summary && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {[
                        { label: 'Area/Cluster', value: fmt(summary.totalAreas), icon: '🗺️', color: 'bg-blue-50 border-blue-200' },
                        { label: 'Total SO', value: fmt(summary.totalSO), icon: '📋', color: 'bg-purple-50 border-purple-200' },
                        { label: 'Total Berat', value: `${fmtDec(summary.totalWeight, 1)} kg`, icon: '⚖️', color: 'bg-emerald-50 border-emerald-200' },
                        { label: 'Total Volume', value: `${fmtDec(summary.totalVolume, 2)} m³`, icon: '📦', color: 'bg-amber-50 border-amber-200' },
                        { label: 'Total Nilai', value: fmtRp(summary.totalValue), icon: '💰', color: 'bg-indigo-50 border-indigo-200' },
                        { label: 'Est. Truk', value: `${summary.totalTrucks} truk`, icon: '🚛', color: 'bg-orange-50 border-orange-200' },
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

            {/* ─── Filters ───────────────────────────────── */}
            <div className="flex flex-wrap gap-2 items-center">
                <input
                    type="text"
                    value={searchArea}
                    onChange={e => setSearchArea(e.target.value)}
                    placeholder="🔍 Cari area/cluster/kota..."
                    className="text-xs border rounded-lg px-3 py-1.5 bg-white w-52 focus:ring-1 focus:ring-blue-300 outline-none"
                />
                <select
                    value={filterProvince}
                    onChange={e => setFilterProvince(e.target.value)}
                    className="text-xs border rounded-lg px-3 py-1.5 bg-white focus:ring-1 focus:ring-blue-300 outline-none"
                >
                    <option value="">Semua Provinsi</option>
                    {provinces.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <Button variant="outline" size="sm" onClick={handleExport} className="text-xs h-7">📥 Export</Button>
                <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={loading} className="text-xs h-7 border-blue-300 text-blue-700 hover:bg-blue-50">
                    {loading ? '⟳ Memuat...' : '🔄 Refresh'}
                </Button>
                <span className="text-xs text-gray-400">{filtered.length} area</span>
            </div>

            {/* ─── Error ─────────────────────────────────── */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
                    ⚠️ {error}
                </div>
            )}

            {/* ─── Loading ───────────────────────────────── */}
            {loading && (
                <div className="flex items-center justify-center h-40 text-gray-400">
                    <div className="text-center">
                        <div className="w-7 h-7 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-xs">Memuat data delivery routing...</p>
                    </div>
                </div>
            )}

            {/* ─── Table ─────────────────────────────────── */}
            {!loading && !error && (
                <>
                    {filtered.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <p className="text-4xl mb-3">🚛</p>
                            <p className="text-sm">Tidak ada data pengiriman untuk filter ini</p>
                        </div>
                    ) : (
                        <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-50 border-b">
                                        <tr>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold w-6">#</th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('area')}>
                                                Area / Cluster <SortIcon k="area" /></th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">Kota</th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('soCount')}>
                                                SO <SortIcon k="soCount" /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('customerCount')}>
                                                Customer <SortIcon k="customerCount" /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('totalWeightKg')}>
                                                Berat (kg) <SortIcon k="totalWeightKg" /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('totalVolumeM3')}>
                                                Volume (m³) <SortIcon k="totalVolumeM3" /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('totalValue')}>
                                                Nilai <SortIcon k="totalValue" /></th>
                                            <th className="text-center px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleSort('oldestSODate')}>
                                                Umur <SortIcon k="oldestSODate" /></th>
                                            <th className="text-center px-3 py-2.5 text-gray-500 font-semibold">Truk</th>
                                            <th className="text-center px-3 py-2.5 text-gray-500 font-semibold">Detail</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map((row, idx) => {
                                            const isExpanded = expandedArea === `${row.area}||${row.cluster}`;
                                            const days = daysSince(row.oldestSODate);
                                            const urgency = days > 7 ? 'text-red-600 font-bold' : days > 3 ? 'text-amber-600 font-medium' : 'text-gray-600';

                                            return (
                                                <React.Fragment key={`${row.area}||${row.cluster}`}>
                                                    <tr className={`border-b transition-colors ${isExpanded ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50'}`}>
                                                        <td className="px-3 py-2.5 text-gray-400">{idx + 1}</td>
                                                        <td className="px-3 py-2.5">
                                                            <div className="font-semibold text-gray-800">{row.area}</div>
                                                            {row.cluster !== '-' && <div className="text-[10px] text-gray-400">{row.cluster}</div>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-gray-500 text-[11px] max-w-[200px]">
                                                            {row.cities.slice(0, 3).join(', ')}
                                                            {row.cities.length > 3 && <span className="text-gray-400"> +{row.cities.length - 3}</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right font-medium text-purple-700">{fmt(row.soCount)}</td>
                                                        <td className="px-3 py-2.5 text-right font-medium text-green-700">{fmt(row.customerCount)}</td>
                                                        <td className="px-3 py-2.5 text-right font-mono font-medium text-blue-700">{fmtDec(row.totalWeightKg, 1)}</td>
                                                        <td className="px-3 py-2.5 text-right font-mono font-medium text-teal-700">{fmtDec(row.totalVolumeM3, 4)}</td>
                                                        <td className="px-3 py-2.5 text-right text-gray-700 font-medium">{fmtRp(row.totalValue)}</td>
                                                        <td className={`px-3 py-2.5 text-center ${urgency}`}>
                                                            {days > 0 ? `${days}h` : '-'}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            <TruckBadge weight={row.totalWeightKg} volume={row.totalVolumeM3} truckW={truckWeightKg} truckV={truckVolumeM3} />
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            <button
                                                                onClick={() => setExpandedArea(isExpanded ? null : `${row.area}||${row.cluster}`)}
                                                                className="text-blue-600 hover:text-blue-800 font-medium text-[11px] border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50 transition"
                                                            >{isExpanded ? '▲' : '▼'} SO</button>
                                                        </td>
                                                    </tr>

                                                    {/* Expanded detail */}
                                                    {isExpanded && (
                                                        <tr className="bg-blue-50/30">
                                                            <td colSpan={11} className="px-4 py-3">
                                                                {/* Capacity bars for this area */}
                                                                <div className="mb-3 bg-white border border-blue-100 rounded-lg p-3">
                                                                    <p className="text-[10px] text-gray-400 font-semibold mb-2">📊 Kapasitas Area Ini</p>
                                                                    <div className="flex gap-6">
                                                                        <CapacityBar used={row.totalWeightKg} max={truckWeightKg} label="Berat" unit="kg" />
                                                                        <CapacityBar used={row.totalVolumeM3} max={truckVolumeM3} label="Volume" unit="m³" />
                                                                    </div>
                                                                </div>

                                                                {/* SO list */}
                                                                <div className="bg-white rounded-lg border overflow-hidden">
                                                                    <table className="w-full text-xs">
                                                                        <thead className="bg-gray-50 border-b">
                                                                            <tr>
                                                                                <th className="text-left px-3 py-2 text-gray-500">No. SO</th>
                                                                                <th className="text-left px-3 py-2 text-gray-500">Customer</th>
                                                                                <th className="text-left px-3 py-2 text-gray-500">Tanggal</th>
                                                                                <th className="text-left px-3 py-2 text-gray-500">Status</th>
                                                                                <th className="text-right px-3 py-2 text-gray-500">Item</th>
                                                                                <th className="text-right px-3 py-2 text-gray-500">Berat (kg)</th>
                                                                                <th className="text-right px-3 py-2 text-gray-500">Volume (m³)</th>
                                                                                <th className="text-right px-3 py-2 text-gray-500">Nilai</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {row.soItems.map(so => {
                                                                                const statusColor = so.statusName.includes('Terproses') ? 'bg-green-100 text-green-700'
                                                                                    : so.statusName.includes('Diajukan') ? 'bg-blue-100 text-blue-700'
                                                                                        : 'bg-yellow-100 text-yellow-700';
                                                                                return (
                                                                                    <tr key={so.soNumber} className="border-b border-gray-50 hover:bg-gray-50">
                                                                                        <td className="px-3 py-2 font-mono text-blue-600 font-medium">{so.soNumber}</td>
                                                                                        <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate">{so.customerName}</td>
                                                                                        <td className="px-3 py-2 text-gray-500">{so.transDate}</td>
                                                                                        <td className="px-3 py-2">
                                                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor}`}>{so.statusName}</span>
                                                                                        </td>
                                                                                        <td className="px-3 py-2 text-right text-gray-600">{so.itemCount}</td>
                                                                                        <td className="px-3 py-2 text-right font-mono text-blue-600">{fmtDec(so.totalWeightKg, 1)}</td>
                                                                                        <td className="px-3 py-2 text-right font-mono text-teal-600">{fmtDec(so.totalVolumeM3, 4)}</td>
                                                                                        <td className="px-3 py-2 text-right text-gray-600">{fmtRp(so.totalValue)}</td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                            {/* Total row */}
                                                                            <tr className="bg-gray-50 font-bold border-t">
                                                                                <td colSpan={5} className="px-3 py-2 text-right text-gray-500">Total Area:</td>
                                                                                <td className="px-3 py-2 text-right font-mono text-blue-700">{fmtDec(row.totalWeightKg, 1)}</td>
                                                                                <td className="px-3 py-2 text-right font-mono text-teal-700">{fmtDec(row.totalVolumeM3, 4)}</td>
                                                                                <td className="px-3 py-2 text-right text-gray-700">{fmtRp(row.totalValue)}</td>
                                                                            </tr>
                                                                        </tbody>
                                                                    </table>
                                                                </div>
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
