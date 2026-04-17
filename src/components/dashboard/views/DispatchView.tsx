'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ─── Types ──────────────────────────────────────────────────

interface DispatchRecord {
    scheduledDate: string;
    customerName: string;
    customerCode: string;
    taskNumber: string;
    taskType: string;
    destination: string;
    officeLocation: string;
    assignmentStatus: string;
    driver: string;
    coDriver: string;
    proofOfDelivery: string;
    completionDetails: string;
    taskCreatedAt: string;
    assignedAt: string;
    taskStartedAt: string;
    taskCompletedAt: string;
    isDeparted: boolean;
    isCompleted: boolean;
    durationMinutes: number | null;
}

interface DispatchSummary {
    totalTasks: number;
    completed: number;
    departed: number;
    pending: number;
}

interface DriverStat {
    name: string;
    totalTasks: number;
    completedTasks: number;
    avgDurationMin: number | null;
}

interface DispatchResponse {
    records: DispatchRecord[];
    summary: DispatchSummary;
    drivers: DriverStat[];
    allDrivers: string[];
    totalRecords: number;
}

// ─── Helpers ────────────────────────────────────────────────

function formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return `${parts[1]}/${parts[0]}/${parts[2]}`;
    }
    return dateStr;
}

function formatTime(datetimeStr: string): string {
    if (!datetimeStr) return '-';
    // Extract time portion: "5/14/2025 11:20:00" → "11:20"
    const timePart = datetimeStr.split(' ')[1];
    if (timePart) {
        const [hh, mm] = timePart.split(':');
        return `${hh}:${mm}`;
    }
    return datetimeStr;
}

function formatDuration(minutes: number | null): string {
    if (!minutes || minutes <= 0) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}j ${m}m`;
    return `${m}m`;
}

function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Component ──────────────────────────────────────────────

export function DispatchView() {
    const [data, setData] = useState<DispatchResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [dateFilter, setDateFilter] = useState('');
    const [driverFilter, setDriverFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    // UI state
    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const [showDriverStats, setShowDriverStats] = useState(false);
    const [showUpload, setShowUpload] = useState(false);

    // Fetch data
    const fetchData = useCallback(async (refresh = false) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (dateFilter) params.set('date', dateFilter);
            if (driverFilter) params.set('driver', driverFilter);
            if (statusFilter) params.set('status', statusFilter);
            if (refresh) params.set('refresh', 'true');

            const res = await fetch(`/api/dispatch?${params.toString()}`);
            if (!res.ok) throw new Error(await res.text());
            const json = await res.json();
            setData(json);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [dateFilter, driverFilter, statusFilter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Auto-refresh every 5 minutes
    useEffect(() => {
        const timer = setInterval(() => fetchData(), 5 * 60 * 1000);
        return () => clearInterval(timer);
    }, [fetchData]);

    // Local text search filter
    const filteredRecords = useMemo(() => {
        if (!data?.records) return [];
        if (!searchQuery) return data.records;
        const q = searchQuery.toLowerCase();
        return data.records.filter(r =>
            r.taskNumber.toLowerCase().includes(q) ||
            r.customerName.toLowerCase().includes(q) ||
            r.customerCode.toLowerCase().includes(q) ||
            r.destination.toLowerCase().includes(q) ||
            r.driver.toLowerCase().includes(q)
        );
    }, [data?.records, searchQuery]);

    // Manual upload handler
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const lines = text.split('\n').filter(l => l.trim());
            if (lines.length < 2) {
                alert('File kosong atau format tidak valid');
                return;
            }

            const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
            const taskIdx = headers.findIndex(h => h.includes('nomor tugas') || h.includes('no do'));
            const statusIdx = headers.findIndex(h => h.includes('status'));
            const driverIdx = headers.findIndex(h => h.includes('driver'));
            const dateIdx = headers.findIndex(h => h.includes('tanggal') || h.includes('dijadwalkan'));

            if (taskIdx === -1) {
                alert('Kolom "Nomor Tugas" tidak ditemukan di file');
                return;
            }

            const records = [];
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',').map(c => c.trim());
                if (!cols[taskIdx]) continue;
                records.push({
                    taskNumber: cols[taskIdx],
                    assignmentStatus: statusIdx >= 0 ? cols[statusIdx] : '',
                    driver: driverIdx >= 0 ? cols[driverIdx] : '',
                    scheduledDate: dateIdx >= 0 ? cols[dateIdx] : '',
                    customerName: '', customerCode: '', taskType: '', destination: '',
                    officeLocation: '', coDriver: '', proofOfDelivery: '', completionDetails: '',
                    taskCreatedAt: '', assignedAt: '', taskStartedAt: '', taskCompletedAt: '',
                });
            }

            const res = await fetch('/api/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ records }),
            });

            const result = await res.json();
            if (res.ok) {
                alert(result.message);
                fetchData(true);
            } else {
                alert('Upload gagal: ' + result.error);
            }
        } catch (err: any) {
            alert('Error: ' + err.message);
        }
        e.target.value = '';
    };

    // Status badge component
    const StatusBadge = ({ record }: { record: DispatchRecord }) => {
        if (record.isCompleted) {
            return <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px]">✅ Selesai</Badge>;
        }
        if (record.isDeparted) {
            return <Badge className="bg-blue-100 text-blue-700 border-blue-300 text-[10px]">🚛 Berangkat</Badge>;
        }
        if (record.assignmentStatus?.toLowerCase().includes('ditugaskan') || record.driver) {
            return <Badge className="bg-amber-100 text-amber-700 border-amber-300 text-[10px]">📋 Ditugaskan</Badge>;
        }
        return <Badge className="bg-gray-100 text-gray-500 border-gray-300 text-[10px]">⏳ Menunggu</Badge>;
    };

    const summary = data?.summary || { totalTasks: 0, completed: 0, departed: 0, pending: 0 };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-gray-800">📦 Dispatch Armada</h2>
                    <p className="text-xs text-gray-500">Tracking keberangkatan armada — data dari TMS (Google Sheets)</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={loading}
                        className="text-xs border-blue-300 text-blue-700 hover:bg-blue-50">
                        {loading ? '⏳ Loading...' : '🔄 Refresh'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowUpload(!showUpload)}
                        className="text-xs border-violet-300 text-violet-700 hover:bg-violet-50">
                        📤 Upload Manual
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowDriverStats(!showDriverStats)}
                        className={`text-xs ${showDriverStats ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'border-gray-300 text-gray-600'}`}>
                        📊 Performa Driver
                    </Button>
                </div>
            </div>

            {/* Upload Panel */}
            {showUpload && (
                <Card className="border-violet-200 bg-violet-50/50">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-violet-800">📤 Upload CSV/Excel dispatch manual:</span>
                            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload}
                                className="text-xs file:mr-2 file:py-1 file:px-3 file:rounded file:border file:border-violet-300 file:text-violet-700 file:bg-violet-50 file:text-xs file:cursor-pointer" />
                            <span className="text-[10px] text-violet-500">Format CSV: Nomor Tugas, Status, Driver, Tanggal, ...</span>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-3">
                <Card className="border-gray-200 cursor-pointer hover:border-gray-400 transition-colors" onClick={() => setStatusFilter('')}>
                    <CardContent className="p-3 text-center">
                        <p className="text-2xl font-bold text-gray-800">{summary.totalTasks}</p>
                        <p className="text-[10px] text-gray-500 font-medium">Total Tugas</p>
                    </CardContent>
                </Card>
                <Card className={`cursor-pointer hover:border-green-400 transition-colors ${statusFilter === 'completed' ? 'border-green-400 bg-green-50/50' : 'border-green-200'}`}
                    onClick={() => setStatusFilter(statusFilter === 'completed' ? '' : 'completed')}>
                    <CardContent className="p-3 text-center">
                        <p className="text-2xl font-bold text-green-600">{summary.completed}</p>
                        <p className="text-[10px] text-green-600 font-medium">✅ Selesai</p>
                    </CardContent>
                </Card>
                <Card className={`cursor-pointer hover:border-blue-400 transition-colors ${statusFilter === 'departed' ? 'border-blue-400 bg-blue-50/50' : 'border-blue-200'}`}
                    onClick={() => setStatusFilter(statusFilter === 'departed' ? '' : 'departed')}>
                    <CardContent className="p-3 text-center">
                        <p className="text-2xl font-bold text-blue-600">{summary.departed}</p>
                        <p className="text-[10px] text-blue-600 font-medium">🚛 Berangkat</p>
                    </CardContent>
                </Card>
                <Card className={`cursor-pointer hover:border-amber-400 transition-colors ${statusFilter === 'pending' ? 'border-amber-400 bg-amber-50/50' : 'border-amber-200'}`}
                    onClick={() => setStatusFilter(statusFilter === 'pending' ? '' : 'pending')}>
                    <CardContent className="p-3 text-center">
                        <p className="text-2xl font-bold text-amber-600">{summary.pending}</p>
                        <p className="text-[10px] text-amber-600 font-medium">⏳ Belum Berangkat</p>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 border">
                    <span className="text-xs font-medium text-gray-500">📅 Tanggal:</span>
                    <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
                        className="bg-transparent text-sm border-none outline-none cursor-pointer" />
                    {dateFilter && (
                        <button onClick={() => setDateFilter('')} className="text-xs text-red-400 hover:text-red-600">✕</button>
                    )}
                </div>
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 border">
                    <span className="text-xs font-medium text-gray-500">🚛 Driver:</span>
                    <select value={driverFilter} onChange={e => setDriverFilter(e.target.value)}
                        className="bg-transparent text-sm border-none outline-none cursor-pointer min-w-[120px]">
                        <option value="">Semua Driver</option>
                        {(data?.allDrivers || []).map(d => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 border flex-1 min-w-[200px]">
                    <span className="text-xs font-medium text-gray-500">🔍</span>
                    <input type="text" placeholder="Cari DO, customer, tujuan..."
                        value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                        className="bg-transparent text-sm border-none outline-none flex-1" />
                </div>
                <span className="text-[10px] text-gray-400">{filteredRecords.length} tugas</span>
            </div>

            {/* Driver Performance Panel */}
            {showDriverStats && data?.drivers && data.drivers.length > 0 && (
                <Card className="border-indigo-200 bg-indigo-50/30">
                    <CardContent className="p-4">
                        <h3 className="text-sm font-semibold text-indigo-800 mb-3">📊 Performa Driver</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {data.drivers.map(d => (
                                <div key={d.name} className="bg-white rounded-lg p-3 border border-indigo-100 cursor-pointer hover:border-indigo-300 transition-colors"
                                    onClick={() => setDriverFilter(driverFilter === d.name ? '' : d.name)}>
                                    <p className="text-sm font-semibold text-gray-800">{d.name}</p>
                                    <div className="flex items-center gap-3 mt-1">
                                        <span className="text-xs text-gray-500">{d.totalTasks} tugas</span>
                                        <span className="text-xs text-green-600">{d.completedTasks} selesai</span>
                                        {d.avgDurationMin && (
                                            <span className="text-xs text-blue-600">~{formatDuration(d.avgDurationMin)}</span>
                                        )}
                                    </div>
                                    <div className="mt-1.5 w-full bg-gray-100 rounded-full h-1.5">
                                        <div className="bg-green-500 h-1.5 rounded-full transition-all"
                                            style={{ width: `${d.totalTasks > 0 ? (d.completedTasks / d.totalTasks) * 100 : 0}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Error */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    ❌ Error: {error}
                </div>
            )}

            {/* Table */}
            <Card>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                                    <th className="px-3 py-2.5 font-medium">Status</th>
                                    <th className="px-3 py-2.5 font-medium">No. DO / Tugas</th>
                                    <th className="px-3 py-2.5 font-medium">Customer</th>
                                    <th className="px-3 py-2.5 font-medium">Tujuan</th>
                                    <th className="px-3 py-2.5 font-medium">Driver</th>
                                    <th className="px-3 py-2.5 font-medium">Berangkat</th>
                                    <th className="px-3 py-2.5 font-medium">Selesai</th>
                                    <th className="px-3 py-2.5 font-medium">Durasi</th>
                                    <th className="px-3 py-2.5 font-medium">Bukti</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && filteredRecords.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-3 py-8 text-center text-gray-400">
                                            <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
                                            <p className="text-xs">Mengambil data dispatch...</p>
                                        </td>
                                    </tr>
                                ) : filteredRecords.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-3 py-8 text-center text-gray-400">
                                            <p className="text-base mb-1">📭</p>
                                            <p className="text-xs">Tidak ada data dispatch untuk filter ini</p>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredRecords.map((r, idx) => (
                                        <React.Fragment key={`${r.taskNumber}-${idx}`}>
                                            <tr className={`border-b hover:bg-gray-50 cursor-pointer transition-colors ${expandedRow === r.taskNumber ? 'bg-blue-50/50' : ''}`}
                                                onClick={() => setExpandedRow(expandedRow === r.taskNumber ? null : r.taskNumber)}>
                                                <td className="px-3 py-2.5">
                                                    <StatusBadge record={r} />
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    <span className="font-mono text-xs font-medium text-gray-800">{r.taskNumber}</span>
                                                    {r.taskType && (
                                                        <p className="text-[10px] text-gray-400">{r.taskType}</p>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    <span className="text-xs text-gray-800">{r.customerName}</span>
                                                    {r.customerCode && (
                                                        <p className="text-[10px] text-gray-400">{r.customerCode}</p>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2.5 text-xs text-gray-600 max-w-[200px] truncate">{r.destination || '-'}</td>
                                                <td className="px-3 py-2.5">
                                                    <span className="text-xs text-gray-800">{r.driver || '-'}</span>
                                                    {r.coDriver && (
                                                        <p className="text-[10px] text-gray-400">+ {r.coDriver}</p>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2.5 text-xs text-gray-600">
                                                    {r.taskStartedAt ? (
                                                        <span className="text-blue-600 font-medium">{formatTime(r.taskStartedAt)}</span>
                                                    ) : (
                                                        <span className="text-gray-300">-</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2.5 text-xs text-gray-600">
                                                    {r.taskCompletedAt ? (
                                                        <span className="text-green-600 font-medium">{formatTime(r.taskCompletedAt)}</span>
                                                    ) : (
                                                        <span className="text-gray-300">-</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2.5 text-xs">
                                                    {r.durationMinutes ? (
                                                        <span className={`font-medium ${r.durationMinutes > 240 ? 'text-red-600' : r.durationMinutes > 120 ? 'text-amber-600' : 'text-green-600'}`}>
                                                            {formatDuration(r.durationMinutes)}
                                                        </span>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-3 py-2.5 text-xs">
                                                    {r.proofOfDelivery ? (
                                                        <a href={r.proofOfDelivery} target="_blank" rel="noopener noreferrer"
                                                            onClick={e => e.stopPropagation()}
                                                            className="text-blue-600 hover:underline">📷 Lihat</a>
                                                    ) : (
                                                        <span className="text-gray-300">-</span>
                                                    )}
                                                </td>
                                            </tr>
                                            {/* Expanded Detail */}
                                            {expandedRow === r.taskNumber && (
                                                <tr className="bg-blue-50/30 border-b">
                                                    <td colSpan={9} className="px-6 py-3">
                                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                                            <div>
                                                                <p className="text-gray-400 font-medium mb-0.5">Tanggal Jadwal</p>
                                                                <p className="text-gray-700">{r.scheduledDate || '-'}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-gray-400 font-medium mb-0.5">Kantor Asal</p>
                                                                <p className="text-gray-700">{r.officeLocation || '-'}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-gray-400 font-medium mb-0.5">Status Penugasan</p>
                                                                <p className="text-gray-700">{r.assignmentStatus || '-'}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-gray-400 font-medium mb-0.5">Waktu Dibuat</p>
                                                                <p className="text-gray-700">{r.taskCreatedAt || '-'}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-gray-400 font-medium mb-0.5">Waktu Penugasan</p>
                                                                <p className="text-gray-700">{r.assignedAt || '-'}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-gray-400 font-medium mb-0.5">Waktu Berangkat</p>
                                                                <p className="text-gray-700">{r.taskStartedAt || '-'}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-gray-400 font-medium mb-0.5">Waktu Selesai</p>
                                                                <p className="text-gray-700">{r.taskCompletedAt || '-'}</p>
                                                            </div>
                                                            {r.completionDetails && (
                                                                <div className="col-span-2 md:col-span-4">
                                                                    <p className="text-gray-400 font-medium mb-0.5">Catatan Penyelesaian</p>
                                                                    <p className="text-gray-700 bg-white rounded px-2 py-1 border">{r.completionDetails}</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Footer info */}
            {data && (
                <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>Total: {data.totalRecords} record di Google Sheets</span>
                    <span>Auto-refresh setiap 5 menit</span>
                </div>
            )}

            {/* Debug info (temporary) */}
            {(data as any)?.debug && (
                <details className="text-[10px] text-gray-400 border rounded p-2 bg-gray-50">
                    <summary className="cursor-pointer font-medium">🔧 Debug Info</summary>
                    <pre className="mt-1 whitespace-pre-wrap text-[10px] text-gray-500">
                        {JSON.stringify((data as any).debug, null, 2)}
                    </pre>
                </details>
            )}
        </div>
    );
}
