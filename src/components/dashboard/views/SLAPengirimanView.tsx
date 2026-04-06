'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import axios from 'axios';
import * as XLSX from 'xlsx';

// ─── Types ────────────────────────────────────────────────────

interface SLADetail {
    soNumber: string;
    soDate: string;
    doNumber: string | null;
    doDate: string | null;
    customerName: string;
    branchId?: number;
    leadTimeDays: number | null;
    receivedDate: string | null;
    status: 'ON_TIME' | 'LATE' | 'PENDING' | 'IN_TRANSIT';
}

interface SLASummary {
    totalSO: number;
    delivered: number;
    onTime: number;
    late: number;
    inTransit: number;
    pending: number;
    avgLeadTime: number;
    slaPercentage: number;
}

interface Branch {
    id: number;
    name: string;
}

interface SLAPengirimanViewProps {
    branches: Branch[];
}

// ─── Helpers ──────────────────────────────────────────────────

function formatDateDisplay(dateStr: string | null): string {
    if (!dateStr) return '-';
    // dd/mm/yyyy → dd MMM yyyy
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        return `${parts[0]} ${months[parseInt(parts[1]) - 1]} ${parts[2]}`;
    }
    // Try to format fallback
    try {
        const d = new Date(dateStr);
        if(!isNaN(d.getTime())) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
        }
    } catch {}
    return dateStr;
}

// ─── Component ────────────────────────────────────────────────

export function SLAPengirimanView({ branches }: SLAPengirimanViewProps) {
    const [loading, setLoading] = useState(false);
    const [summary, setSummary] = useState<SLASummary | null>(null);
    const [details, setDetails] = useState<SLADetail[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [fromDate, setFromDate] = useState('2025-01-01');
    const [toDate, setToDate] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    
    // Multiple Branch Selection
    const [selectedBranches, setSelectedBranches] = useState<number[]>([]);
    const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
    
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [search, setSearch] = useState('');

    // Sort
    const [sortBy, setSortBy] = useState<'soDate' | 'leadTime' | 'customer'>('soDate');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (fromDate) params.set('from', fromDate);
            if (toDate) params.set('to', toDate);
            if (selectedBranches.length > 0) {
                params.set('branch', selectedBranches.join(','));
            }
            // Use force parameter? We can add a force refetch if needed, but standard is fine
            
            const res = await axios.get(`/api/sla-pengiriman?${params.toString()}`);
            if (res.data.error) {
                setError(res.data.error);
            } else {
                setSummary(res.data.summary);
                setDetails(res.data.details || []);
            }
        } catch (err: any) {
            setError(err.response?.data?.error || err.message);
        } finally {
            setLoading(false);
        }
    }, [fromDate, toDate, selectedBranches]);

    useEffect(() => {
        fetchData();
    }, []);

    // Filtered & sorted details
    const filteredDetails = useMemo(() => {
        let data = [...details];

        // Status filter
        if (statusFilter !== 'all') {
            data = data.filter(d => d.status === statusFilter);
        }

        // Search filter
        if (search.trim()) {
            const q = search.toLowerCase();
            data = data.filter(d =>
                d.soNumber.toLowerCase().includes(q) ||
                d.customerName.toLowerCase().includes(q) ||
                (d.doNumber || '').toLowerCase().includes(q)
            );
        }

        // Sort
        data.sort((a, b) => {
            let cmp = 0;
            if (sortBy === 'soDate') {
                const dateA = a.soDate.split('/').reverse().join('');
                const dateB = b.soDate.split('/').reverse().join('');
                cmp = dateA.localeCompare(dateB);
            } else if (sortBy === 'leadTime') {
                const ltA = a.leadTimeDays ?? 9999;
                const ltB = b.leadTimeDays ?? 9999;
                cmp = ltA - ltB;
            } else if (sortBy === 'customer') {
                cmp = a.customerName.localeCompare(b.customerName);
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });

        return data;
    }, [details, statusFilter, search, sortBy, sortDir]);

    const handleSort = (col: 'soDate' | 'leadTime' | 'customer') => {
        if (sortBy === col) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(col);
            setSortDir(col === 'soDate' ? 'desc' : 'asc');
        }
    };

    const sortIcon = (col: string) => {
        if (sortBy !== col) return '↕';
        return sortDir === 'asc' ? '↑' : '↓';
    };

    const toggleBranch = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        setSelectedBranches(prev => 
            prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]
        );
    };

    // SLA gauge color
    const getSLAColor = (pct: number) => {
        if (pct >= 90) return 'text-green-600';
        if (pct >= 70) return 'text-yellow-600';
        return 'text-red-600';
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'ON_TIME': return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">✅ Diterima (On Time)</span>;
            case 'LATE': return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">⏰ Diterima (Terlambat)</span>;
            case 'IN_TRANSIT': return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">🚚 Dalam Perjalanan</span>;
            case 'PENDING': return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">⏳ Belum Diproses</span>;
        }
    };

    // Export to Excel
    const handleExportExcel = () => {
        // Prepare data with proper date formatting
        const parseDateObj = (dStr: string | null) => {
            if (!dStr) return null;
            // dd/mm/yyyy
            const parts = dStr.split('/');
            if (parts.length === 3) {
                return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
            }
            // fallback for sheet format like "4/1/2026 12:00:00"
            const d = new Date(dStr);
            if (!isNaN(d.getTime())) return d;
            return dStr;
        };

        const exportData = filteredDetails.map((item, index) => {
            return {
                'No': index + 1,
                'No SO': item.soNumber,
                'Tgl SO (Approved)': parseDateObj(item.soDate),
                'No DO': item.doNumber || '-',
                'Tgl DO': parseDateObj(item.doDate),
                'Tgl Terkirim': item.receivedDate ? parseDateObj(item.receivedDate.split(' ')[0]) : null,
                'Customer': item.customerName,
                'Lead Time (Hari)': item.leadTimeDays !== null ? item.leadTimeDays : 'Pending',
                'Status': item.status === 'ON_TIME' ? 'Diterima (On Time)' : 
                          item.status === 'LATE' ? 'Diterima (Terlambat)' : 
                          item.status === 'IN_TRANSIT' ? 'Dalam Perjalanan' : 'Belum Diproses'
            };
        });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(exportData, { cellDates: true });
        
        // Auto-size columns slightly
        worksheet['!cols'] = [
            { wch: 5 },  // No
            { wch: 15 }, // No SO
            { wch: 15 }, // Tgl SO
            { wch: 15 }, // No DO
            { wch: 15 }, // Tgl DO
            { wch: 15 }, // Tgl Terkirim
            { wch: 35 }, // Customer
            { wch: 15 }, // Lead Time
            { wch: 20 }, // Status
        ];

        XLSX.utils.book_append_sheet(workbook, worksheet, 'SLA Pengiriman');
        XLSX.writeFile(workbook, `SLA_Pengiriman_Export.xlsx`);
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold">🚚 SLA Pengiriman</h2>
                    <p className="text-sm text-muted-foreground">Target SLA: ≤3 hari dari SO Approved hingga Delivery Order</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        title="Export Filtered Data to Excel"
                        variant="outline"
                        size="sm"
                        onClick={handleExportExcel}
                        disabled={loading || details.length === 0}
                        className="text-green-700 border-green-200 hover:bg-green-50"
                    >
                        📥 Export Excel
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchData}
                        disabled={loading}
                    >
                        {loading ? '⏳ Loading...' : '🔄 Refresh'}
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 bg-muted/40 rounded-lg p-3 border">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">📅</span>
                    <input
                        type="date"
                        value={fromDate}
                        onChange={e => setFromDate(e.target.value)}
                        className="bg-transparent text-sm border rounded px-2 py-1 w-[130px]"
                    />
                    <span className="text-xs text-muted-foreground">→</span>
                    <input
                        type="date"
                        value={toDate}
                        onChange={e => setToDate(e.target.value)}
                        className="bg-transparent text-sm border rounded px-2 py-1 w-[130px]"
                    />
                </div>
                
                {/* Cabang Multi Select */}
                <div className="flex items-center gap-2 relative">
                    <span className="text-xs font-medium text-muted-foreground">🏢</span>
                    <div 
                        className="bg-transparent text-sm border rounded px-3 py-1.5 min-w-[150px] cursor-pointer flex justify-between items-center bg-white"
                        onClick={() => setIsBranchDropdownOpen(!isBranchDropdownOpen)}
                    >
                        <span className="truncate max-w-[150px]">
                            {selectedBranches.length === 0 
                                ? 'Semua Cabang' 
                                : `${selectedBranches.length} Cabang Terpilih`}
                        </span>
                        <span className="text-xs ml-2">▼</span>
                    </div>

                    {isBranchDropdownOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsBranchDropdownOpen(false)}></div>
                            <div className="absolute top-full left-[28px] mt-1 w-64 bg-white border shadow-xl rounded-md z-50 max-h-64 overflow-y-auto">
                                <div 
                                    className="px-3 py-2 hover:bg-slate-100 cursor-pointer text-sm border-b"
                                    onClick={() => {
                                        setSelectedBranches([]);
                                        setIsBranchDropdownOpen(false);
                                    }}
                                >
                                    <span className={selectedBranches.length === 0 ? 'font-bold text-blue-600' : ''}>Semua Cabang</span>
                                </div>
                                {branches.map(b => (
                                    <div 
                                        key={b.id} 
                                        className="px-3 py-2 hover:bg-slate-100 cursor-pointer flex items-center gap-2 text-sm"
                                        onClick={(e) => toggleBranch(e, b.id)}
                                    >
                                        <input 
                                            type="checkbox" 
                                            checked={selectedBranches.includes(b.id)} 
                                            readOnly 
                                            className="pointer-events-none rounded sm:w-4 sm:h-4 text-blue-600 focus:ring-blue-500" 
                                        />
                                        <span className="truncate">{b.name}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                <Button variant="default" size="sm" onClick={fetchData} disabled={loading}>
                    🔍 Tampilkan
                </Button>
            </div>

            {/* Error */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                    ❌ {error}
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="text-center py-12">
                    <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
                    <p className="text-muted-foreground">Mengambil data SLA dari Accurate...</p>
                    <p className="text-xs text-muted-foreground mt-1">Proses pertama kali mungkin membutuhkan beberapa menit</p>
                </div>
            )}

            {/* Summary Cards */}
            {summary && !loading && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                        {/* Total SO */}
                        <Card>
                            <CardContent className="p-4 text-center">
                                <p className="text-xs text-muted-foreground font-medium">Total SO</p>
                                <p className="text-2xl font-bold text-blue-600">{summary.totalSO.toLocaleString()}</p>
                            </CardContent>
                        </Card>

                        {/* Delivered */}
                        <Card>
                            <CardContent className="p-4 text-center">
                                <p className="text-xs text-muted-foreground font-medium">Terkirim</p>
                                <p className="text-2xl font-bold text-indigo-600">{summary.delivered.toLocaleString()}</p>
                            </CardContent>
                        </Card>

                        {/* On Time */}
                        <Card>
                            <CardContent className="p-4 text-center">
                                <p className="text-xs text-muted-foreground font-medium">On Time (≤3h)</p>
                                <p className="text-2xl font-bold text-green-600">{summary.onTime.toLocaleString()}</p>
                            </CardContent>
                        </Card>

                        {/* Late */}
                        <Card>
                            <CardContent className="p-4 text-center">
                                <p className="text-xs text-muted-foreground font-medium">Terlambat (&gt;3h)</p>
                                <p className="text-2xl font-bold text-red-600">{summary.late.toLocaleString()}</p>
                            </CardContent>
                        </Card>

                        {/* In Transit */}
                        <Card>
                            <CardContent className="p-4 text-center">
                                <p className="text-xs text-muted-foreground font-medium">Dalam Perjalanan</p>
                                <p className="text-2xl font-bold text-blue-500">{summary.inTransit.toLocaleString()}</p>
                            </CardContent>
                        </Card>

                        {/* Pending */}
                        <Card>
                            <CardContent className="p-4 text-center">
                                <p className="text-xs text-muted-foreground font-medium">Belum Diproses</p>
                                <p className="text-2xl font-bold text-gray-500">{summary.pending.toLocaleString()}</p>
                            </CardContent>
                        </Card>

                        {/* Avg Lead Time */}
                        <Card>
                            <CardContent className="p-4 text-center">
                                <p className="text-xs text-muted-foreground font-medium">Lama Terkirim (Hari)</p>
                                <p className="text-2xl font-bold text-orange-600">{summary.avgLeadTime}</p>
                            </CardContent>
                        </Card>

                        {/* SLA % */}
                        <Card className="border-2 border-blue-200">
                            <CardContent className="p-4 text-center">
                                <p className="text-xs text-muted-foreground font-medium">SLA %</p>
                                <p className={`text-2xl font-bold ${getSLAColor(summary.slaPercentage)}`}>
                                    {summary.slaPercentage}%
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Visual Bar */}
                    {(summary.delivered > 0 || summary.inTransit > 0) && (
                        <div className="bg-white rounded-lg border p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">Distribusi SLA</span>
                                <span className="text-xs text-muted-foreground">
                                    {summary.onTime} On Time · {summary.late} Terlambat · {summary.inTransit} Di Jalan · {summary.pending} Pending
                                </span>
                            </div>
                            <div className="w-full flex rounded-full h-6 overflow-hidden bg-gray-100">
                                {summary.onTime > 0 && (
                                    <div
                                        className="bg-green-500 flex items-center justify-center text-white text-xs font-semibold transition-all"
                                        style={{ width: `${(summary.onTime / summary.totalSO) * 100}%` }}
                                    >
                                        {((summary.onTime / summary.totalSO) * 100).toFixed(0)}%
                                    </div>
                                )}
                                {summary.late > 0 && (
                                    <div
                                        className="bg-red-500 flex items-center justify-center text-white text-xs font-semibold transition-all"
                                        style={{ width: `${(summary.late / summary.totalSO) * 100}%` }}
                                    >
                                        {((summary.late / summary.totalSO) * 100).toFixed(0)}%
                                    </div>
                                )}
                                {summary.inTransit > 0 && (
                                    <div
                                        className="bg-blue-400 flex items-center justify-center text-white text-xs font-semibold transition-all"
                                        style={{ width: `${(summary.inTransit / summary.totalSO) * 100}%` }}
                                    >
                                        {((summary.inTransit / summary.totalSO) * 100).toFixed(0)}%
                                    </div>
                                )}
                                {summary.pending > 0 && (
                                    <div
                                        className="bg-gray-300 flex items-center justify-center text-gray-700 text-xs font-semibold transition-all"
                                        style={{ width: `${(summary.pending / summary.totalSO) * 100}%` }}
                                    >
                                        {((summary.pending / summary.totalSO) * 100).toFixed(0)}%
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> On Time (≤3 hari)</span>
                                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Terlambat (&gt;3 hari)</span>
                                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-400 inline-block" /> Dalam Perjalanan (Kurir)</span>
                                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-300 inline-block" /> Belum Diproses</span>
                            </div>
                        </div>
                    )}

                    {/* Detail Table */}
                    <div className="bg-white rounded-lg border overflow-hidden">
                        {/* Table Filters */}
                        <div className="flex flex-wrap items-center gap-3 p-3 border-b bg-muted/30">
                            <input
                                type="text"
                                placeholder="🔍 Cari SO / DO / Customer..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="text-sm border rounded px-3 py-1.5 w-[250px]"
                            />
                            <select
                                value={statusFilter}
                                onChange={e => setStatusFilter(e.target.value)}
                                className="text-sm border rounded px-2 py-1.5"
                            >
                                <option value="all">Semua Status</option>
                                <option value="ON_TIME">✅ Diterima (On Time)</option>
                                <option value="LATE">⏰ Diterima (Terlambat)</option>
                                <option value="IN_TRANSIT">🚚 Dalam Perjalanan</option>
                                <option value="PENDING">⏳ Belum Diproses</option>
                            </select>
                            <span className="text-xs text-muted-foreground ml-auto">
                                Menampilkan {filteredDetails.length.toLocaleString()} baris SLA
                            </span>
                        </div>

                        {/* Table - Responsive horizontal scroll container */}
                        <div className="overflow-x-auto overflow-y-auto max-h-[600px] w-full">
                            <table className="w-full text-sm whitespace-nowrap">
                                <thead className="bg-blue-600 text-white sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="px-4 py-3 text-left w-12 font-semibold">No</th>
                                        <th className="px-4 py-3 text-left font-semibold">No SO</th>
                                        <th className="px-4 py-3 text-left cursor-pointer hover:bg-blue-700 font-semibold" onClick={() => handleSort('soDate')}>
                                            Tgl SO {sortIcon('soDate')}
                                        </th>
                                        <th className="px-4 py-3 text-left font-semibold">No DO</th>
                                        <th className="px-4 py-3 text-left font-semibold">Tgl DO</th>
                                        <th className="px-4 py-3 text-left font-semibold text-blue-100">Tgl Terkirim</th>
                                        <th className="px-4 py-3 text-left cursor-pointer hover:bg-blue-700 font-semibold min-w-[200px]" onClick={() => handleSort('customer')}>
                                            Customer {sortIcon('customer')}
                                        </th>
                                        <th className="px-4 py-3 text-center cursor-pointer hover:bg-blue-700 font-semibold" onClick={() => handleSort('leadTime')}>
                                            Lead Time {sortIcon('leadTime')}
                                        </th>
                                        <th className="px-4 py-3 text-center font-semibold">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {filteredDetails.map((item, idx) => (
                                        <tr
                                            key={`${item.soNumber}-${idx}`}
                                            className={`hover:bg-blue-50/50 transition-colors ${item.status === 'LATE' ? 'bg-red-50/30' : item.status === 'PENDING' ? 'bg-gray-50/30' : item.status === 'IN_TRANSIT' ? 'bg-blue-50/30' : ''}`}
                                        >
                                            <td className="px-4 py-2.5 text-muted-foreground">{idx + 1}</td>
                                            
                                            {/* SO */}
                                            <td className="px-4 py-2.5 font-medium text-blue-700">{item.soNumber}</td>
                                            <td className="px-4 py-2.5 text-muted-foreground">{formatDateDisplay(item.soDate)}</td>
                                            
                                            {/* DO */}
                                            <td className="px-4 py-2.5">
                                                {item.doNumber ? (
                                                    <span className="font-medium">{item.doNumber}</span>
                                                ) : <span className="text-muted-foreground italic">-</span>}
                                            </td>
                                            <td className="px-4 py-2.5 text-muted-foreground">
                                                {item.doNumber ? formatDateDisplay(item.doDate) : '-'}
                                            </td>

                                            {/* Terkirim Date */}
                                            <td className="px-4 py-2.5 font-medium text-indigo-700">
                                                {item.receivedDate ? formatDateDisplay(item.receivedDate.split(' ')[0]) : '-'}
                                            </td>

                                            {/* Customer */}
                                            <td className="px-4 py-2.5">
                                                <div className="max-w-[250px] truncate" title={item.customerName}>
                                                    {item.customerName}
                                                </div>
                                            </td>

                                            {/* Lead Time */}
                                            <td className="px-4 py-2.5 text-center">
                                                {item.leadTimeDays !== null ? (
                                                    <span className={`font-bold ${item.leadTimeDays <= 3 ? 'text-green-600' : 'text-red-600'}`}>
                                                        {item.leadTimeDays} hari
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground">-</span>
                                                )}
                                            </td>

                                            {/* Status Badge */}
                                            <td className="px-4 py-2.5 text-center">
                                                {getStatusBadge(item.status)}
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredDetails.length === 0 && (
                                        <tr>
                                            <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground bg-gray-50/50">
                                                {details.length === 0 ? 'Belum ada data. Klik "🔍 Tampilkan" untuk memuat data.' : 'Tidak ada data sesuai pencarian/filter.'}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
