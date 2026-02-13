'use client';

import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SchedulerConfig {
    enabled: boolean;
    cronExpression: string;
    intervalLabel: string;
    branchId: number | null;
    fromDate: string;
}

interface SyncHistoryEntry {
    id: string;
    startedAt: string;
    completedAt: string | null;
    status: 'success' | 'error' | 'running';
    durationSec: number | null;
    itemCount: number | null;
    invoiceCount: number | null;
    error: string | null;
    trigger: 'scheduled' | 'manual';
}

interface SchedulerStatus {
    config: SchedulerConfig;
    isRunning: boolean;
    isSyncing: boolean;
    cronActive: boolean;
    history: SyncHistoryEntry[];
}

const INTERVAL_OPTIONS = [
    { label: 'Setiap 1 Jam', cron: '0 */1 * * *' },
    { label: 'Setiap 2 Jam', cron: '0 */2 * * *' },
    { label: 'Setiap 4 Jam', cron: '0 */4 * * *' },
    { label: 'Setiap 6 Jam', cron: '0 */6 * * *' },
    { label: 'Setiap 12 Jam', cron: '0 */12 * * *' },
    { label: 'Setiap 24 Jam (00:00)', cron: '0 0 * * *' },
];

const DAYS_OF_WEEK = [
    { label: 'Sen', short: 'Mon', value: 1 },
    { label: 'Sel', short: 'Tue', value: 2 },
    { label: 'Rab', short: 'Wed', value: 3 },
    { label: 'Kam', short: 'Thu', value: 4 },
    { label: 'Jum', short: 'Fri', value: 5 },
    { label: 'Sab', short: 'Sat', value: 6 },
    { label: 'Min', short: 'Sun', value: 0 },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface Branch {
    id: number;
    name: string;
}

// ─── Parse cron to determine if it's "custom" ────────────────

function isPresetCron(cronExpr: string): boolean {
    return INTERVAL_OPTIONS.some(o => o.cron === cronExpr);
}

function parseCronToCustom(cronExpr: string): { hours: number[]; days: number[] } {
    try {
        const parts = cronExpr.split(' ');
        if (parts.length !== 5) return { hours: [8], days: [1, 2, 3, 4, 5] };

        const [, hourPart, , , dayPart] = parts;

        // Parse hours
        let hours: number[] = [];
        if (hourPart === '*') {
            hours = HOURS;
        } else {
            hourPart.split(',').forEach(h => {
                const num = parseInt(h.trim());
                if (!isNaN(num) && num >= 0 && num <= 23) hours.push(num);
            });
        }
        if (hours.length === 0) hours = [8];

        // Parse days
        let days: number[] = [];
        if (dayPart === '*') {
            days = [0, 1, 2, 3, 4, 5, 6]; // all days
        } else {
            dayPart.split(',').forEach(d => {
                const num = parseInt(d.trim());
                if (!isNaN(num) && num >= 0 && num <= 6) days.push(num);
            });
        }
        if (days.length === 0) days = [1, 2, 3, 4, 5];

        return { hours, days };
    } catch {
        return { hours: [8], days: [1, 2, 3, 4, 5] };
    }
}

function buildCustomCron(hours: number[], days: number[]): string {
    const hourStr = hours.length === 24 ? '*' : hours.sort((a, b) => a - b).join(',');
    const dayStr = days.length === 7 ? '*' : days.sort((a, b) => a - b).join(',');
    return `0 ${hourStr} * * ${dayStr}`;
}

function buildCustomLabel(hours: number[], days: number[]): string {
    const dayLabels = days.length === 7
        ? 'Setiap Hari'
        : days.map(d => DAYS_OF_WEEK.find(dw => dw.value === d)?.label || '').join(', ');
    const hourLabels = hours.length === 24
        ? 'Setiap Jam'
        : hours.map(h => `${String(h).padStart(2, '0')}:00`).join(', ');
    return `${dayLabels} @ ${hourLabels}`;
}

// ─── Component ───────────────────────────────────────────────

export function SchedulerPanel({ branches }: { branches: Branch[] }) {
    const [status, setStatus] = useState<SchedulerStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [expanded, setExpanded] = useState(false);

    // Custom schedule local state
    const [scheduleMode, setScheduleMode] = useState<'preset' | 'custom'>('preset');
    const [selectedHours, setSelectedHours] = useState<number[]>([8]);
    const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await axios.get('/api/scheduler');
            setStatus(res.data);

            // Detect if current config uses custom cron
            const cfg = res.data?.config;
            if (cfg && !isPresetCron(cfg.cronExpression)) {
                setScheduleMode('custom');
                const parsed = parseCronToCustom(cfg.cronExpression);
                setSelectedHours(parsed.hours);
                setSelectedDays(parsed.days);
            }
        } catch (err) {
            console.error('Failed to fetch scheduler status', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStatus();
        const timer = setInterval(fetchStatus, 30000);
        return () => clearInterval(timer);
    }, [fetchStatus]);

    const updateConfig = async (updates: Partial<SchedulerConfig>) => {
        setUpdating(true);
        try {
            await axios.post('/api/scheduler', updates);
            await fetchStatus();
            // Optional: alert('Pengaturan tersimpan');
        } catch (err: any) {
            console.error('Failed to update scheduler config', err);
            alert('Gagal update config: ' + (err.response?.data?.error || err.message));
        } finally {
            setUpdating(false);
        }
    };

    const toggleEnabled = () => {
        if (!status) return;
        updateConfig({ enabled: !status.config.enabled });
    };

    const changeInterval = (index: number) => {
        const opt = INTERVAL_OPTIONS[index];
        if (opt) {
            updateConfig({ cronExpression: opt.cron, intervalLabel: opt.label });
        }
    };

    const changeBranch = (branchId: string) => {
        updateConfig({ branchId: branchId ? parseInt(branchId) : null });
    };

    const toggleHour = (hour: number) => {
        setSelectedHours(prev => {
            const next = prev.includes(hour) ? prev.filter(h => h !== hour) : [...prev, hour];
            return next.length === 0 ? [hour] : next; // at least 1 hour
        });
    };

    const toggleDay = (day: number) => {
        setSelectedDays(prev => {
            const next = prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day];
            return next.length === 0 ? [day] : next; // at least 1 day
        });
    };

    const applyCustomSchedule = () => {
        const cronExpr = buildCustomCron(selectedHours, selectedDays);
        const label = buildCustomLabel(selectedHours, selectedDays);
        updateConfig({ cronExpression: cronExpr, intervalLabel: label });
    };

    const selectAllDays = () => setSelectedDays([0, 1, 2, 3, 4, 5, 6]);
    const selectWeekdays = () => setSelectedDays([1, 2, 3, 4, 5]);

    const triggerManualSync = async () => {
        try {
            await axios.post('/api/scheduler?action=trigger');
            await fetchStatus();
        } catch (err) {
            console.error('Failed to trigger manual sync', err);
        }
    };

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    const formatDuration = (sec: number | null) => {
        if (!sec) return '-';
        const min = Math.floor(sec / 60);
        const s = sec % 60;
        return min > 0 ? `${min}m ${s}s` : `${s}s`;
    };

    if (loading) return null;
    if (!status) return null;

    const { config, cronActive, isSyncing, history } = status;
    const lastSuccess = history.find(h => h.status === 'success');
    const selectedIntervalIdx = INTERVAL_OPTIONS.findIndex(o => o.cron === config.cronExpression);

    return (
        <div className="border rounded-lg overflow-hidden">
            {/* Header Bar — always visible */}
            <div
                className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-indigo-50 to-blue-50 cursor-pointer hover:from-indigo-100 hover:to-blue-100 transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-3">
                    <span className="text-base">⏰</span>
                    <span className="text-sm font-semibold text-gray-700">Auto-Sync</span>
                    {config.enabled ? (
                        <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px] px-1.5 py-0">
                            ● Aktif — {config.intervalLabel}
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="text-gray-500 text-[10px] px-1.5 py-0">
                            Nonaktif
                        </Badge>
                    )}
                    {isSyncing && (
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <span className="text-[10px] text-blue-600 font-medium">Syncing...</span>
                        </div>
                    )}
                    {lastSuccess && !isSyncing && (
                        <span className="text-[10px] text-gray-400">
                            Terakhir: {formatDate(lastSuccess.completedAt!)}
                        </span>
                    )}
                </div>
                <span className="text-xs text-gray-400">{expanded ? '▲' : '▼'}</span>
            </div>

            {/* Expanded Settings */}
            {expanded && (
                <div className="px-4 py-3 bg-white border-t space-y-3">
                    {/* Row 1: Toggle + Mode + Branch + Run Now */}
                    <div className="flex flex-wrap items-center gap-3">
                        <Button
                            variant={config.enabled ? 'default' : 'outline'}
                            size="sm"
                            onClick={toggleEnabled}
                            disabled={updating}
                            className={config.enabled
                                ? 'bg-green-600 hover:bg-green-700 text-white text-xs'
                                : 'text-xs'
                            }
                        >
                            {config.enabled ? '✅ Enabled' : '⬜ Disabled'}
                        </Button>

                        {/* Schedule Mode Toggle */}
                        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                            <button
                                onClick={() => setScheduleMode('preset')}
                                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${scheduleMode === 'preset'
                                    ? 'bg-white shadow-sm font-medium text-gray-800'
                                    : 'text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                ⏱ Preset
                            </button>
                            <button
                                onClick={() => setScheduleMode('custom')}
                                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${scheduleMode === 'custom'
                                    ? 'bg-white shadow-sm font-medium text-gray-800'
                                    : 'text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                🎯 Custom
                            </button>
                        </div>

                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 border">
                            <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Branch:</span>
                            <select
                                value={config.branchId || ''}
                                onChange={(e) => changeBranch(e.target.value)}
                                className="bg-transparent text-xs border-none outline-none cursor-pointer min-w-[120px]"
                                disabled={updating}
                            >
                                <option value="">Semua Cabang</option>
                                {branches.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={triggerManualSync}
                            disabled={isSyncing || updating}
                            className="text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                        >
                            {isSyncing ? '⏳ Running...' : '▶ Run Now'}
                        </Button>
                    </div>

                    {/* Row 2: Preset Interval Selector */}
                    {scheduleMode === 'preset' && (
                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5 border w-fit">
                            <span className="text-xs font-medium text-gray-500 whitespace-nowrap">Interval:</span>
                            <select
                                value={selectedIntervalIdx >= 0 ? selectedIntervalIdx : 2}
                                onChange={(e) => changeInterval(parseInt(e.target.value))}
                                className="bg-transparent text-xs border-none outline-none cursor-pointer min-w-[160px]"
                                disabled={updating}
                            >
                                {INTERVAL_OPTIONS.map((opt, idx) => (
                                    <option key={idx} value={idx}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Row 2: Custom Schedule Builder */}
                    {scheduleMode === 'custom' && (
                        <div className="space-y-2.5 bg-gray-50 rounded-lg p-3 border">
                            {/* Day Selector */}
                            <div>
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className="text-xs font-medium text-gray-600">📅 Hari:</span>
                                    <button
                                        onClick={selectAllDays}
                                        className="text-[10px] text-blue-600 hover:underline"
                                    >
                                        Semua
                                    </button>
                                    <span className="text-[10px] text-gray-300">|</span>
                                    <button
                                        onClick={selectWeekdays}
                                        className="text-[10px] text-blue-600 hover:underline"
                                    >
                                        Senin-Jumat
                                    </button>
                                </div>
                                <div className="flex gap-1">
                                    {DAYS_OF_WEEK.map(day => (
                                        <button
                                            key={day.value}
                                            onClick={() => toggleDay(day.value)}
                                            className={`w-9 h-7 text-[11px] rounded-md border transition-all font-medium ${selectedDays.includes(day.value)
                                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                                : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
                                                }`}
                                        >
                                            {day.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Hour Selector */}
                            <div>
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className="text-xs font-medium text-gray-600">🕐 Jam:</span>
                                    <span className="text-[10px] text-gray-400">
                                        ({selectedHours.length} jam dipilih)
                                    </span>
                                </div>
                                <div className="grid grid-cols-12 gap-1">
                                    {HOURS.map(hour => (
                                        <button
                                            key={hour}
                                            onClick={() => toggleHour(hour)}
                                            className={`h-7 text-[10px] rounded-md border transition-all font-medium ${selectedHours.includes(hour)
                                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                                : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
                                                }`}
                                        >
                                            {String(hour).padStart(2, '0')}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Preview + Apply */}
                            <div className="flex items-center justify-between pt-1">
                                <div className="text-[10px] text-gray-500">
                                    <span className="font-medium">Preview:</span>{' '}
                                    <code className="bg-white px-1.5 py-0.5 rounded text-indigo-700 border text-[10px]">
                                        {buildCustomCron(selectedHours, selectedDays)}
                                    </code>
                                    <span className="ml-2 text-gray-400">
                                        = {buildCustomLabel(selectedHours, selectedDays)}
                                    </span>
                                </div>
                                <Button
                                    size="sm"
                                    onClick={applyCustomSchedule}
                                    disabled={updating}
                                    className="text-xs bg-indigo-600 hover:bg-indigo-700"
                                >
                                    {updating ? '⏳ Saving...' : '✓ Terapkan'}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Sync History */}
                    {history.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1.5">📋 Riwayat Sync (terakhir 10)</p>
                            <div className="max-h-[200px] overflow-y-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b text-left text-gray-400">
                                            <th className="py-1 pr-2">Waktu</th>
                                            <th className="py-1 pr-2">Status</th>
                                            <th className="py-1 pr-2">Durasi</th>
                                            <th className="py-1 pr-2">Items</th>
                                            <th className="py-1 pr-2">Faktur</th>
                                            <th className="py-1">Trigger</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.slice(0, 10).map(entry => (
                                            <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50">
                                                <td className="py-1.5 pr-2 text-gray-600">{formatDate(entry.startedAt)}</td>
                                                <td className="py-1.5 pr-2">
                                                    {entry.status === 'success' && <span className="text-green-600">✅ Sukses</span>}
                                                    {entry.status === 'error' && (
                                                        <span className="text-red-600" title={entry.error || ''}>❌ Gagal</span>
                                                    )}
                                                    {entry.status === 'running' && (
                                                        <span className="text-blue-600">🔄 Berjalan</span>
                                                    )}
                                                </td>
                                                <td className="py-1.5 pr-2 text-gray-500">{formatDuration(entry.durationSec)}</td>
                                                <td className="py-1.5 pr-2 text-gray-500">{entry.itemCount ?? '-'}</td>
                                                <td className="py-1.5 pr-2 text-gray-500">{entry.invoiceCount ?? '-'}</td>
                                                <td className="py-1.5">
                                                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${entry.trigger === 'scheduled'
                                                        ? 'bg-purple-50 text-purple-600 border-purple-200'
                                                        : 'bg-blue-50 text-blue-600 border-blue-200'
                                                        }`}>
                                                        {entry.trigger === 'scheduled' ? '⏰ Auto' : '👤 Manual'}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
