'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMask } from '@/lib/SessionContext';

// ─── Types ──────────────────────────────────────────────────

interface AreaSOItem {
    soNumber: string;
    customerName: string;
    customerNo?: string;
    transDate: string;
    statusName: string;
    deliveryStatus?: string;
    dispatchStatus?: string;
    dispatchDriver?: string;
    city?: string;
    itemCount: number;
    totalWeightKg: number;
    totalVolumeM3: number;
    totalValue: number;
    outstandingPcs: number;
}

interface CustomerGroup {
    customerName: string;
    customerNo?: string;
    city: string;
    area: string;
    cluster: string;
    soCount: number;
    totalWeightKg: number;
    totalVolumeM3: number;
    totalValue: number;
    totalOutstandingPcs: number;
    soNumbers: string[];
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
    customers: CustomerGroup[];
}

interface Summary {
    totalAreas: number;
    totalSO: number;
    totalCustomers: number;
    totalWeight: number;
    totalVolume: number;
    totalValue: number;
    totalTrucks: number;
    truckWeightKg: number;
    truckVolumeM3: number;
}

interface VehicleType {
    id: number;
    name: string;
    maxWeightKg: number;
    maxVolumeM3: number;
    costPerTrip: number | null;
    sortOrder: number;
    isActive: boolean;
}

interface VehicleSuggestion {
    vehicle: VehicleType;
    count: number;
    totalCost: number;
    weightUtil: number; // 0-100%
    volumeUtil: number; // 0-100%
}

interface FleetSuggestion {
    combo: VehicleSuggestion[];
    totalTrucks: number;
    totalCost: number;
    avgUtilization: number;
}

type TabKey = 'area' | 'customer' | 'detail';
type AreaSortKey = 'area' | 'soCount' | 'customerCount' | 'totalWeightKg' | 'totalVolumeM3' | 'totalValue' | 'oldestSODate';
type CustSortKey = 'customerName' | 'area' | 'city' | 'soCount' | 'totalWeightKg' | 'totalVolumeM3' | 'totalValue';
type DetailSortKey = 'soNumber' | 'customerName' | 'transDate' | 'totalWeightKg' | 'totalVolumeM3' | 'totalValue';

// ─── Fleet Suggestion Algorithm ─────────────────────────────

function suggestFleet(weightKg: number, volumeM3: number, vehicles: VehicleType[]): FleetSuggestion | null {
    // Filter active vehicles, sort largest first
    const active = vehicles.filter(v => v.isActive).sort((a, b) => b.maxWeightKg - a.maxWeightKg);
    if (active.length === 0 || (weightKg <= 0 && volumeM3 <= 0)) return null;

    // Greedy: try to fill with largest vehicle first, then fill remainder with smaller
    // Try each starting vehicle to find best combination
    let bestCombo: FleetSuggestion | null = null;

    for (let startIdx = 0; startIdx < active.length; startIdx++) {
        const combo: VehicleSuggestion[] = [];
        let remainW = weightKg;
        let remainV = volumeM3;

        for (let i = startIdx; i < active.length; i++) {
            const v = active[i];
            // How many of this vehicle needed for remaining load?
            const needByW = v.maxWeightKg > 0 ? Math.floor(remainW / v.maxWeightKg) : 0;
            const needByV = v.maxVolumeM3 > 0 ? Math.floor(remainV / v.maxVolumeM3) : 0;
            const count = Math.max(needByW, needByV);
            if (count > 0) {
                remainW -= count * v.maxWeightKg;
                remainV -= count * v.maxVolumeM3;
                combo.push({
                    vehicle: v, count,
                    totalCost: (v.costPerTrip || 0) * count,
                    weightUtil: 0, volumeUtil: 0,
                });
            }
        }

        // Handle remaining with smallest vehicle that fits
        if (remainW > 0 || remainV > 0) {
            // Find smallest vehicle that can carry the remainder
            const fitting = [...active].reverse().find(v =>
                v.maxWeightKg >= remainW && v.maxVolumeM3 >= remainV
            ) || active[active.length - 1]; // fallback to smallest

            const existing = combo.find(c => c.vehicle.id === fitting.id);
            if (existing) {
                existing.count++;
                existing.totalCost += fitting.costPerTrip || 0;
            } else {
                combo.push({
                    vehicle: fitting, count: 1,
                    totalCost: fitting.costPerTrip || 0,
                    weightUtil: 0, volumeUtil: 0,
                });
            }
        }

        if (combo.length === 0) continue;

        const totalTrucks = combo.reduce((s, c) => s + c.count, 0);
        const totalCost = combo.reduce((s, c) => s + c.totalCost, 0);
        const totalCapW = combo.reduce((s, c) => s + c.vehicle.maxWeightKg * c.count, 0);
        const totalCapV = combo.reduce((s, c) => s + c.vehicle.maxVolumeM3 * c.count, 0);
        const avgUtil = ((totalCapW > 0 ? weightKg / totalCapW : 0) + (totalCapV > 0 ? volumeM3 / totalCapV : 0)) / 2 * 100;

        // Calculate per-vehicle utilization
        combo.forEach(c => {
            c.weightUtil = totalCapW > 0 ? (weightKg / totalCapW) * 100 : 0;
            c.volumeUtil = totalCapV > 0 ? (volumeM3 / totalCapV) * 100 : 0;
        });

        const suggestion: FleetSuggestion = { combo, totalTrucks, totalCost, avgUtilization: avgUtil };

        // Pick suggestion with best utilization while minimizing cost
        if (!bestCombo
            || (suggestion.totalCost < bestCombo.totalCost && suggestion.avgUtilization > 40)
            || (suggestion.avgUtilization > bestCombo.avgUtilization + 10 && suggestion.totalCost <= bestCombo.totalCost * 1.2)
        ) {
            bestCombo = suggestion;
        }
    }

    return bestCombo;
}

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
const fmtDateSlash = (ds: string) => {
    if (!ds) return '-';
    const parts = ds.split('/');
    if (parts.length === 3) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
        return `${parseInt(parts[0])} ${months[parseInt(parts[1]) - 1]} ${parts[2]}`;
    }
    return ds;
};

const daysSince = (iso: string): number => {
    if (!iso) return 0;
    const diff = Date.now() - new Date(iso).getTime();
    return Math.floor(diff / 86400000);
};

const pctOf = (val: number, max: number) => max > 0 ? Math.min((val / max) * 100, 100) : 0;

// ─── Micro Components ───────────────────────────────────────

const CapacityBar = ({ used, max, label, unit }: { used: number; max: number; label: string; unit: string }) => {
    const pct = pctOf(used, max);
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

const FleetBadge = ({ suggestion }: { suggestion: FleetSuggestion | undefined }) => {
    if (!suggestion) return <span className="text-gray-300 text-[10px]">-</span>;
    const color = suggestion.avgUtilization > 70 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : suggestion.avgUtilization > 40 ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-red-50 text-red-700 border-red-200';
    return (
        <div className={`text-[10px] px-2 py-1 rounded-lg border ${color} text-left min-w-[100px]`}>
            {suggestion.combo.map((c, i) => (
                <div key={i} className="font-medium">{c.count}x {c.vehicle.name}</div>
            ))}
            {suggestion.totalCost > 0 && (
                <div className="text-[9px] opacity-70 mt-0.5">~Rp {(suggestion.totalCost / 1_000_000).toFixed(1)}jt</div>
            )}
        </div>
    );
};

const SortIcon = ({ active, asc }: { active: boolean; asc: boolean }) =>
    active ? <span className="ml-0.5">{asc ? '▲' : '▼'}</span> : <span className="ml-0.5 text-gray-300">⇅</span>;

const HorizBar = ({ value, maxValue, color = 'bg-blue-500' }: { value: number; maxValue: number; color?: string }) => {
    const w = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
    return (
        <div className="w-full bg-gray-100 rounded h-3 relative overflow-hidden">
            <div className={`h-full rounded transition-all duration-700 ${color}`} style={{ width: `${w}%` }} />
        </div>
    );
};

const UrgencyBadge = ({ days }: { days: number }) => {
    if (days <= 0) return <span className="text-gray-400">-</span>;
    const cls = days > 7 ? 'bg-red-100 text-red-700 border-red-200' : days > 3 ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-gray-100 text-gray-600 border-gray-200';
    return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cls}`}>{days}h</span>;
};

const StatusBadge = ({ status }: { status: string }) => {
    const s = (status || '').toLowerCase();
    const color = s.includes('terproses') ? 'bg-green-100 text-green-700'
        : s.includes('diajukan') ? 'bg-blue-100 text-blue-700'
            : s.includes('sebagian') ? 'bg-orange-100 text-orange-700'
                : 'bg-yellow-100 text-yellow-700';
    return <span className={`text-[10px] px-1.5 py-0.5 rounded ${color}`}>{status}</span>;
};

const DeliveryBadge = ({ status }: { status?: string }) => {
    const s = (status || 'Belum dikirim').toLowerCase();
    const color = s === 'difaktur' ? 'bg-green-100 text-green-700'
        : s === 'difaktur sebagian' ? 'bg-amber-100 text-amber-700'
            : s === 'dikirim' ? 'bg-blue-100 text-blue-700'
                : s === 'diajukan' ? 'bg-orange-100 text-orange-700'
                    : 'bg-gray-100 text-gray-400';
    return <span className={`text-[10px] px-1.5 py-0.5 rounded ${color}`}>{status || 'Belum dikirim'}</span>;
};

const DispatchBadge = ({ status, driver }: { status?: string; driver?: string }) => {
    if (!status) return <span className="text-[10px] text-gray-300">-</span>;
    const s = status.toLowerCase();
    const color = s === 'selesai' ? 'bg-green-100 text-green-700'
        : s === 'sudah berangkat' ? 'bg-blue-100 text-blue-700'
            : s === 'sebagian berangkat' ? 'bg-cyan-100 text-cyan-700'
                : 'bg-amber-100 text-amber-700';
    const icon = s === 'selesai' ? '✅' : s === 'sudah berangkat' ? '🚛' : s === 'sebagian berangkat' ? '🔄' : '⏳';
    return (
        <div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${color}`}>{icon} {status}</span>
            {driver && <p className="text-[9px] text-gray-400 mt-0.5 truncate max-w-[100px]" title={driver}>👤 {driver}</p>}
        </div>
    );
};

// ─── Main Component ─────────────────────────────────────────

export const DeliveryRoutingView: React.FC = () => {
    const { isHidden } = useMask();
    const mRp = (n: number) => isHidden('col:value') ? '***' : fmtRp(n);
    const mFleetCost = (n: number) => isHidden('col:fleet_cost') ? '***' : `~Rp ${(n / 1_000_000).toFixed(1)}jt`;

    const [areas, setAreas] = useState<AreaGroup[]>([]);
    const [allCustomers, setAllCustomers] = useState<CustomerGroup[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Tab state
    const [activeTab, setActiveTab] = useState<TabKey>('area');

    // Load planning state
    const [truckWeightKg, setTruckWeightKg] = useState(() => {
        if (typeof window !== 'undefined') return parseFloat(localStorage.getItem('truckWeightKg') || '5000');
        return 5000;
    });
    const [truckVolumeM3, setTruckVolumeM3] = useState(() => {
        if (typeof window !== 'undefined') return parseFloat(localStorage.getItem('truckVolumeM3') || '16');
        return 16;
    });

    // Fleet state
    const [vehicles, setVehicles] = useState<VehicleType[]>([]);
    const [showFleetManager, setShowFleetManager] = useState(false);
    const [editingVehicle, setEditingVehicle] = useState<Partial<VehicleType> | null>(null);
    const [fleetSaving, setFleetSaving] = useState(false);

    // UI state
    const [expandedArea, setExpandedArea] = useState<string | null>(null);
    const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
    const [globalSearch, setGlobalSearch] = useState('');
    const [filterProvince, setFilterProvince] = useState('');
    const [filterArea, setFilterArea] = useState('');
    const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
    const [filterDeliveryStatuses, setFilterDeliveryStatuses] = useState<string[]>([]);

    // Sort states per tab
    const [areaSortKey, setAreaSortKey] = useState<AreaSortKey>('totalWeightKg');
    const [areaSortAsc, setAreaSortAsc] = useState(false);
    const [custSortKey, setCustSortKey] = useState<CustSortKey>('totalWeightKg');
    const [custSortAsc, setCustSortAsc] = useState(false);
    const [detailSortKey, setDetailSortKey] = useState<DetailSortKey>('totalWeightKg');
    const [detailSortAsc, setDetailSortAsc] = useState(false);

    // Save truck capacity to localStorage
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('truckWeightKg', String(truckWeightKg));
            localStorage.setItem('truckVolumeM3', String(truckVolumeM3));
        }
    }, [truckWeightKg, truckVolumeM3]);

    // Fetch fleet vehicles
    const fetchVehicles = useCallback(async () => {
        try {
            const res = await fetch('/api/vehicle-types');
            const data = await res.json();
            setVehicles(data.vehicles || []);
        } catch { /* ignore — will use defaults */ }
    }, []);

    useEffect(() => { fetchVehicles(); }, [fetchVehicles]);

    // Fleet CRUD handlers
    const handleSaveVehicle = async () => {
        if (!editingVehicle?.name || !editingVehicle?.maxWeightKg || !editingVehicle?.maxVolumeM3) return;
        setFleetSaving(true);
        try {
            const method = editingVehicle.id ? 'PUT' : 'POST';
            await fetch('/api/vehicle-types', {
                method, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editingVehicle),
            });
            setEditingVehicle(null);
            await fetchVehicles();
        } catch { /* ignore */ }
        setFleetSaving(false);
    };

    const handleDeleteVehicle = async (id: number) => {
        if (!confirm('Hapus kendaraan ini?')) return;
        await fetch(`/api/vehicle-types?id=${id}`, { method: 'DELETE' });
        await fetchVehicles();
    };

    const handleToggleVehicle = async (v: VehicleType) => {
        await fetch('/api/vehicle-types', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: v.id, isActive: !v.isActive }),
        });
        await fetchVehicles();
    };

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
            setAllCustomers(data.customers || []);
            setSummary(data.summary || null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [truckWeightKg, truckVolumeM3]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ─── Derived data ─────────────────────────────

    const provinces = useMemo(() =>
        [...new Set(areas.map(a => a.province).filter(p => p && p !== '-'))].sort(), [areas]);

    const areaNames = useMemo(() =>
        [...new Set(areas.map(a => a.area).filter(a => a && a !== 'Tidak Diketahui'))].sort(), [areas]);

    // Unique status values for filter dropdowns
    const allStatuses = useMemo(() => {
        const set = new Set<string>();
        for (const a of areas) a.soItems.forEach(s => { if (s.statusName) set.add(s.statusName); });
        return [...set].sort();
    }, [areas]);

    const allDeliveryStatuses = useMemo(() => {
        const set = new Set<string>();
        for (const a of areas) a.soItems.forEach(s => set.add(s.deliveryStatus || 'Belum dikirim'));
        return [...set].sort();
    }, [areas]);

    // Toggle helpers for multi-select
    const toggleStatus = (s: string) => setFilterStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
    const toggleDeliveryStatus = (s: string) => setFilterDeliveryStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

    // Helper: check if an SO item matches status filters
    const matchesStatusFilters = useCallback((so: AreaSOItem) => {
        if (filterStatuses.length > 0 && !filterStatuses.some(f => so.statusName.toLowerCase() === f.toLowerCase())) return false;
        if (filterDeliveryStatuses.length > 0) {
            const ds = (so.deliveryStatus || 'Belum dikirim').toLowerCase();
            if (!filterDeliveryStatuses.some(f => f.toLowerCase() === ds)) return false;
        }
        return true;
    }, [filterStatuses, filterDeliveryStatuses]);

    // All SO items flattened for detail tab
    const allSOItems = useMemo(() => {
        const items: (AreaSOItem & { area: string; cluster: string })[] = [];
        for (const a of areas) {
            for (const so of a.soItems) {
                items.push({ ...so, area: a.area, cluster: a.cluster });
            }
        }
        return items;
    }, [areas]);

    // ─── Filtered + Sorted: Area Tab ──────────────
    // When status filters are active, re-aggregate area totals from filtered SO items

    const hasStatusFilter = filterStatuses.length > 0 || filterDeliveryStatuses.length > 0;

    const filteredAreas = useMemo(() => {
        let data = areas.map(a => {
            // If status filters are active, filter soItems and recalculate totals
            if (hasStatusFilter) {
                const filteredSO = a.soItems.filter(matchesStatusFilters);
                if (filteredSO.length === 0) return null; // exclude area with no matching SOs
                // Rebuild customer list from filtered SOs
                const custMap = new Map<string, CustomerGroup>();
                for (const so of filteredSO) {
                    const key = so.customerName;
                    if (!custMap.has(key)) {
                        custMap.set(key, {
                            customerName: so.customerName, customerNo: so.customerNo,
                            city: so.city || '-', area: a.area, cluster: a.cluster,
                            soCount: 0, totalWeightKg: 0, totalVolumeM3: 0, totalValue: 0, totalOutstandingPcs: 0, soNumbers: [],
                        });
                    }
                    const c = custMap.get(key)!;
                    c.soCount++;
                    c.totalWeightKg += so.totalWeightKg;
                    c.totalVolumeM3 += so.totalVolumeM3;
                    c.totalValue += so.totalValue;
                    c.totalOutstandingPcs += so.outstandingPcs;
                    c.soNumbers.push(so.soNumber);
                }
                return {
                    ...a,
                    soItems: filteredSO,
                    soCount: filteredSO.length,
                    customerCount: custMap.size,
                    totalWeightKg: filteredSO.reduce((s, i) => s + i.totalWeightKg, 0),
                    totalVolumeM3: filteredSO.reduce((s, i) => s + i.totalVolumeM3, 0),
                    totalValue: filteredSO.reduce((s, i) => s + i.totalValue, 0),
                    totalOutstandingPcs: filteredSO.reduce((s, i) => s + i.outstandingPcs, 0),
                    customers: [...custMap.values()].sort((x, y) => y.totalWeightKg - x.totalWeightKg),
                } as AreaGroup;
            }
            return a;
        }).filter((a): a is AreaGroup => a !== null);

        data = data.filter(a => {
            const matchSearch = !globalSearch || a.area.toLowerCase().includes(globalSearch.toLowerCase())
                || a.cluster.toLowerCase().includes(globalSearch.toLowerCase())
                || a.cities.some(c => c.toLowerCase().includes(globalSearch.toLowerCase()))
                || a.soItems.some(s => s.customerName.toLowerCase().includes(globalSearch.toLowerCase()) || s.soNumber.toLowerCase().includes(globalSearch.toLowerCase()));
            const matchProv = !filterProvince || a.province === filterProvince;
            const matchArea = !filterArea || a.area === filterArea;
            return matchSearch && matchProv && matchArea;
        });
        return [...data].sort((a, b) => {
            let av: any, bv: any;
            if (areaSortKey === 'area') { av = a.area; bv = b.area; }
            else if (areaSortKey === 'oldestSODate') { av = a.oldestSODate; bv = b.oldestSODate; }
            else { av = a[areaSortKey]; bv = b[areaSortKey]; }
            if (typeof av === 'string') return areaSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            return areaSortAsc ? av - bv : bv - av;
        });
    }, [areas, globalSearch, filterProvince, filterArea, areaSortKey, areaSortAsc, hasStatusFilter, matchesStatusFilters]);

    // ─── Filtered + Sorted: Customer Tab ──────────

    const filteredCustomers = useMemo(() => {
        // When status filters are active, use the already-filtered area data
        const source = hasStatusFilter
            ? filteredAreas.flatMap(a => a.customers)
            : allCustomers;
        let data = source.filter(c => {
            const matchSearch = !globalSearch
                || c.customerName.toLowerCase().includes(globalSearch.toLowerCase())
                || (c.customerNo || '').toLowerCase().includes(globalSearch.toLowerCase())
                || c.city.toLowerCase().includes(globalSearch.toLowerCase())
                || c.area.toLowerCase().includes(globalSearch.toLowerCase());
            const matchArea = !filterArea || c.area === filterArea;
            return matchSearch && matchArea;
        });
        return [...data].sort((a, b) => {
            let av: any, bv: any;
            if (custSortKey === 'customerName') { av = a.customerName; bv = b.customerName; }
            else if (custSortKey === 'area') { av = a.area; bv = b.area; }
            else if (custSortKey === 'city') { av = a.city; bv = b.city; }
            else { av = a[custSortKey]; bv = b[custSortKey]; }
            if (typeof av === 'string') return custSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            return custSortAsc ? av - bv : bv - av;
        });
    }, [allCustomers, filteredAreas, globalSearch, filterArea, custSortKey, custSortAsc, hasStatusFilter]);

    // ─── Filtered + Sorted: Detail Tab ────────────

    const filteredDetails = useMemo(() => {
        let data = allSOItems.filter(so => {
            if (!matchesStatusFilters(so)) return false;
            const matchSearch = !globalSearch
                || so.soNumber.toLowerCase().includes(globalSearch.toLowerCase())
                || so.customerName.toLowerCase().includes(globalSearch.toLowerCase())
                || (so.customerNo || '').toLowerCase().includes(globalSearch.toLowerCase())
                || so.area.toLowerCase().includes(globalSearch.toLowerCase());
            const matchArea = !filterArea || so.area === filterArea;
            return matchSearch && matchArea;
        });
        return [...data].sort((a, b) => {
            let av: any, bv: any;
            if (detailSortKey === 'soNumber') { av = a.soNumber; bv = b.soNumber; }
            else if (detailSortKey === 'customerName') { av = a.customerName; bv = b.customerName; }
            else if (detailSortKey === 'transDate') {
                av = a.transDate.split('/').reverse().join('-');
                bv = b.transDate.split('/').reverse().join('-');
            }
            else { av = a[detailSortKey]; bv = b[detailSortKey]; }
            if (typeof av === 'string') return detailSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            return detailSortAsc ? av - bv : bv - av;
        });
    }, [allSOItems, globalSearch, filterArea, detailSortKey, detailSortAsc, matchesStatusFilters]);

    // ─── Grand totals per tab ─────────────────────

    const areaGrandTotal = useMemo(() => ({
        soCount: filteredAreas.reduce((s, a) => s + a.soCount, 0),
        customerCount: filteredAreas.reduce((s, a) => s + a.customerCount, 0),
        weight: filteredAreas.reduce((s, a) => s + a.totalWeightKg, 0),
        volume: filteredAreas.reduce((s, a) => s + a.totalVolumeM3, 0),
        value: filteredAreas.reduce((s, a) => s + a.totalValue, 0),
    }), [filteredAreas]);

    const custGrandTotal = useMemo(() => ({
        soCount: filteredCustomers.reduce((s, c) => s + c.soCount, 0),
        weight: filteredCustomers.reduce((s, c) => s + c.totalWeightKg, 0),
        volume: filteredCustomers.reduce((s, c) => s + c.totalVolumeM3, 0),
        value: filteredCustomers.reduce((s, c) => s + c.totalValue, 0),
    }), [filteredCustomers]);

    const detailGrandTotal = useMemo(() => ({
        weight: filteredDetails.reduce((s, d) => s + d.totalWeightKg, 0),
        volume: filteredDetails.reduce((s, d) => s + d.totalVolumeM3, 0),
        value: filteredDetails.reduce((s, d) => s + d.totalValue, 0),
    }), [filteredDetails]);

    // ─── Max for bar charts ───────────────────────

    const maxAreaWeight = useMemo(() => Math.max(...filteredAreas.map(a => a.totalWeightKg), 1), [filteredAreas]);
    const maxAreaVolume = useMemo(() => Math.max(...filteredAreas.map(a => a.totalVolumeM3), 0.001), [filteredAreas]);
    const maxCustWeight = useMemo(() => Math.max(...filteredCustomers.map(c => c.totalWeightKg), 1), [filteredCustomers]);

    // Fleet suggestion per area (memoized)
    const areaSuggestions = useMemo(() => {
        const map = new Map<string, FleetSuggestion>();
        if (vehicles.length === 0) return map;
        for (const a of filteredAreas) {
            const key = `${a.area}||${a.cluster}`;
            const sug = suggestFleet(a.totalWeightKg, a.totalVolumeM3, vehicles);
            if (sug) map.set(key, sug);
        }
        return map;
    }, [filteredAreas, vehicles]);

    // ─── Sort Handlers ────────────────────────────

    const handleAreaSort = (key: AreaSortKey) => {
        if (areaSortKey === key) setAreaSortAsc(p => !p);
        else { setAreaSortKey(key); setAreaSortAsc(false); }
    };
    const handleCustSort = (key: CustSortKey) => {
        if (custSortKey === key) setCustSortAsc(p => !p);
        else { setCustSortKey(key); setCustSortAsc(false); }
    };
    const handleDetailSort = (key: DetailSortKey) => {
        if (detailSortKey === key) setDetailSortAsc(p => !p);
        else { setDetailSortKey(key); setDetailSortAsc(false); }
    };

    // ─── Export ───────────────────────────────────

    const handleExport = () => {
        const rows: any[][] = [];
        if (activeTab === 'area') {
            rows.push(['Area', 'Cluster', 'Kota', 'Provinsi', 'SO', 'Customer', 'Berat (kg)', 'Volume (m³)', 'Nilai', 'Est. Truk']);
            for (const a of filteredAreas) {
                const trucks = Math.max(
                    truckWeightKg > 0 ? Math.ceil(a.totalWeightKg / truckWeightKg) : 0,
                    truckVolumeM3 > 0 ? Math.ceil(a.totalVolumeM3 / truckVolumeM3) : 0, 1
                );
                rows.push([a.area, a.cluster, a.cities.join(', '), a.province, a.soCount, a.customerCount, a.totalWeightKg, a.totalVolumeM3, a.totalValue, trucks]);
            }
        } else if (activeTab === 'customer') {
            rows.push(['Area', 'Cluster', 'Customer', 'ID Customer', 'Kota', 'SO', 'Berat (kg)', 'Volume (m³)', 'Nilai', 'Outstanding Pcs']);
            for (const c of filteredCustomers) {
                rows.push([c.area, c.cluster, c.customerName, c.customerNo || '', c.city, c.soCount, c.totalWeightKg, c.totalVolumeM3, c.totalValue, c.totalOutstandingPcs]);
            }
        } else {
            rows.push(['No. SO', 'Customer', 'ID Customer', 'Tanggal', 'Area', 'Cluster', 'Kota', 'Status', 'Status Kiriman', 'Items', 'Berat (kg)', 'Volume (m³)', 'Nilai', 'Outstanding Pcs']);
            for (const so of filteredDetails) {
                rows.push([so.soNumber, so.customerName, so.customerNo || '', so.transDate, so.area, so.cluster, so.city || '', so.statusName, so.deliveryStatus || 'Belum dikirim', so.itemCount, so.totalWeightKg, so.totalVolumeM3, so.totalValue, so.outstandingPcs]);
            }
        }
        const csv = rows.map(r => r.join('\t')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        const tabName = activeTab === 'area' ? 'Area' : activeTab === 'customer' ? 'Customer' : 'Detail';
        link.download = `Delivery_Routing_${tabName}_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
    };

    // ─── Tab definitions ──────────────────────────

    const tabs: { key: TabKey; label: string; icon: string; count: number }[] = [
        { key: 'area', label: 'Pivot per Area', icon: '📊', count: filteredAreas.length },
        { key: 'customer', label: 'Pivot per Customer', icon: '👤', count: filteredCustomers.length },
        { key: 'detail', label: 'Semua SO', icon: '📋', count: filteredDetails.length },
    ];

    return (
        <div className="space-y-4">
            {/* ─── Header with Fleet Planner ──────────── */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white rounded-xl p-5 shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-bold flex items-center gap-2">🚛 Delivery Routing</h2>
                        <p className="text-xs text-slate-300 mt-0.5">Analisis kubikasi, berat & perencanaan pengiriman per area & customer</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowFleetManager(p => !p)}
                            className={`text-xs px-3 py-2 rounded-lg transition font-medium flex items-center gap-1.5 ${showFleetManager ? 'bg-blue-500 text-white' : 'bg-white/10 text-slate-200 hover:bg-white/20'}`}
                        >
                            🚚 Fleet Manager
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px]">{vehicles.filter(v => v.isActive).length}</span>
                        </button>
                    </div>
                </div>

                {/* Global capacity bars */}
                {summary && (
                    <div className="mt-4 flex gap-6">
                        <CapacityBar used={summary.totalWeight} max={truckWeightKg * summary.totalTrucks} label="Total Berat" unit="kg" />
                        <CapacityBar used={summary.totalVolume} max={truckVolumeM3 * summary.totalTrucks} label="Total Volume" unit="m³" />
                    </div>
                )}
            </div>

            {/* ─── Fleet Manager Panel (collapsible) ─────── */}
            {showFleetManager && (
                <div className="bg-white border-2 border-blue-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">🚚 Fleet Manager <span className="text-xs font-normal text-gray-400">Kelola jenis kendaraan pengiriman</span></h3>
                        <button
                            onClick={() => setEditingVehicle({ name: '', maxWeightKg: 0, maxVolumeM3: 0, costPerTrip: 0, sortOrder: vehicles.length + 1 })}
                            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition font-medium"
                        >+ Tambah Kendaraan</button>
                    </div>

                    {/* Vehicle list */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="text-left px-3 py-2 text-gray-500">Nama</th>
                                    <th className="text-right px-3 py-2 text-gray-500">Maks Berat (kg)</th>
                                    <th className="text-right px-3 py-2 text-gray-500">Maks Volume (m³)</th>
                                    <th className="text-right px-3 py-2 text-gray-500">Biaya/Trip (Rp)</th>
                                    <th className="text-center px-3 py-2 text-gray-500">Urutan</th>
                                    <th className="text-center px-3 py-2 text-gray-500">Aktif</th>
                                    <th className="text-center px-3 py-2 text-gray-500">Aksi</th>
                                </tr>
                            </thead>
                            <tbody>
                                {vehicles.map(v => (
                                    <tr key={v.id} className={`border-b hover:bg-gray-50 ${!v.isActive ? 'opacity-40' : ''}`}>
                                        <td className="px-3 py-2 font-medium text-gray-800">🚛 {v.name}</td>
                                        <td className="px-3 py-2 text-right font-mono text-blue-600">{fmt(v.maxWeightKg)}</td>
                                        <td className="px-3 py-2 text-right font-mono text-teal-600">{fmtDec(v.maxVolumeM3, 1)}</td>
                                        <td className="px-3 py-2 text-right text-gray-600">{v.costPerTrip ? `Rp ${fmt(v.costPerTrip)}` : '-'}</td>
                                        <td className="px-3 py-2 text-center text-gray-400">{v.sortOrder}</td>
                                        <td className="px-3 py-2 text-center">
                                            <button onClick={() => handleToggleVehicle(v)} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${v.isActive ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>
                                                {v.isActive ? 'Aktif' : 'Nonaktif'}
                                            </button>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <button onClick={() => setEditingVehicle(v)} className="text-blue-600 hover:text-blue-800 mr-2 text-[10px] font-medium">Edit</button>
                                            <button onClick={() => handleDeleteVehicle(v.id)} className="text-red-500 hover:text-red-700 text-[10px] font-medium">Hapus</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Edit/Add form */}
                    {editingVehicle !== null && (
                        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <p className="text-xs font-semibold text-blue-700 mb-2">{editingVehicle.id ? 'Edit Kendaraan' : 'Tambah Kendaraan Baru'}</p>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                <div>
                                    <label className="text-[10px] text-gray-500">Nama</label>
                                    <input type="text" value={editingVehicle.name || ''} onChange={e => setEditingVehicle(p => ({ ...p!, name: e.target.value }))} className="w-full text-xs border rounded px-2 py-1.5 bg-white" placeholder="CDD" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-gray-500">Maks Berat (kg)</label>
                                    <input type="number" value={editingVehicle.maxWeightKg || ''} onChange={e => setEditingVehicle(p => ({ ...p!, maxWeightKg: parseFloat(e.target.value) || 0 }))} className="w-full text-xs border rounded px-2 py-1.5 bg-white" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-gray-500">Maks Volume (m³)</label>
                                    <input type="number" value={editingVehicle.maxVolumeM3 || ''} onChange={e => setEditingVehicle(p => ({ ...p!, maxVolumeM3: parseFloat(e.target.value) || 0 }))} className="w-full text-xs border rounded px-2 py-1.5 bg-white" step="0.5" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-gray-500">Biaya/Trip (Rp)</label>
                                    <input type="number" value={editingVehicle.costPerTrip || ''} onChange={e => setEditingVehicle(p => ({ ...p!, costPerTrip: parseFloat(e.target.value) || 0 }))} className="w-full text-xs border rounded px-2 py-1.5 bg-white" />
                                </div>
                                <div className="flex items-end gap-2">
                                    <button onClick={handleSaveVehicle} disabled={fleetSaving} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50">
                                        {fleetSaving ? 'Saving...' : 'Simpan'}
                                    </button>
                                    <button onClick={() => setEditingVehicle(null)} className="text-xs bg-gray-200 text-gray-600 px-3 py-1.5 rounded hover:bg-gray-300">Batal</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ─── Summary Cards ──────────────────────── */}
            {summary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                    {[
                        { label: 'Area', value: fmt(summary.totalAreas), icon: '🗺️', color: 'bg-blue-50 border-blue-200' },
                        { label: 'Total SO', value: fmt(summary.totalSO), icon: '📋', color: 'bg-purple-50 border-purple-200' },
                        { label: 'Customer', value: fmt(summary.totalCustomers), icon: '👤', color: 'bg-pink-50 border-pink-200' },
                        { label: 'Total Berat', value: `${fmtDec(summary.totalWeight, 1)} kg`, icon: '⚖️', color: 'bg-emerald-50 border-emerald-200' },
                        { label: 'Total Volume', value: `${fmtDec(summary.totalVolume, 2)} m³`, icon: '📦', color: 'bg-amber-50 border-amber-200' },
                        { label: 'Total Nilai', value: mRp(summary.totalValue), icon: '💰', color: 'bg-indigo-50 border-indigo-200' },
                        { label: 'Fleet', value: `${vehicles.filter(v => v.isActive).length} jenis`, icon: '🚚', color: 'bg-orange-50 border-orange-200' },
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

            {/* ─── Pareto Chart (dynamic by tab) ──────────── */}
            {!loading && !error && (activeTab === 'area' ? filteredAreas.length > 0 : activeTab === 'customer' ? filteredCustomers.length > 0 : false) && (() => {
                const isCustomerTab = activeTab === 'customer';
                const title = isCustomerTab ? 'Pareto 5 Besar Customer' : 'Pareto 5 Besar Area';
                const hasFilter = hasStatusFilter || filterArea || filterProvince || globalSearch;

                // Prepare top 5 data
                const topByWeight = isCustomerTab
                    ? [...filteredCustomers].sort((a, b) => b.totalWeightKg - a.totalWeightKg).slice(0, 5)
                    : [...filteredAreas].sort((a, b) => b.totalWeightKg - a.totalWeightKg).slice(0, 5);
                const topByVolume = isCustomerTab
                    ? [...filteredCustomers].sort((a, b) => b.totalVolumeM3 - a.totalVolumeM3).slice(0, 5)
                    : [...filteredAreas].sort((a, b) => b.totalVolumeM3 - a.totalVolumeM3).slice(0, 5);
                const maxW = isCustomerTab ? maxCustWeight : maxAreaWeight;
                const maxV = isCustomerTab
                    ? Math.max(...filteredCustomers.map(c => c.totalVolumeM3), 0.001)
                    : maxAreaVolume;

                return (
                    <div className="bg-white border rounded-xl p-4 shadow-sm">
                        <h3 className="text-xs font-semibold text-gray-500 mb-3">
                            {'\ud83d\udcc8'} {title} — Berat & Volume {hasFilter ? <span className="text-blue-500 font-normal">(filtered)</span> : ''}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <p className="text-[10px] text-gray-400 font-semibold mb-1.5">{'\u2696\ufe0f'} BERAT (kg)</p>
                                {topByWeight.map((item: any, i: number) => {
                                    const label = isCustomerTab ? item.customerName : item.area;
                                    const key = isCustomerTab ? `w-c-${item.customerName}-${i}` : `w-a-${item.area}-${item.cluster}`;
                                    return (
                                        <div key={key} className="mb-1.5">
                                            <div className="flex justify-between text-[10px] mb-0.5">
                                                <span className="text-gray-700 font-medium truncate max-w-[180px]">{label}</span>
                                                <span className="text-blue-700 font-bold">{fmtDec(item.totalWeightKg, 1)} kg</span>
                                            </div>
                                            <HorizBar value={item.totalWeightKg} maxValue={maxW} color="bg-blue-500" />
                                        </div>
                                    );
                                })}
                            </div>
                            <div>
                                <p className="text-[10px] text-gray-400 font-semibold mb-1.5">{'\ud83d\udce6'} VOLUME (m{'\u00b3'})</p>
                                {topByVolume.map((item: any, i: number) => {
                                    const label = isCustomerTab ? item.customerName : item.area;
                                    const key = isCustomerTab ? `v-c-${item.customerName}-${i}` : `v-a-${item.area}-${item.cluster}`;
                                    return (
                                        <div key={key} className="mb-1.5">
                                            <div className="flex justify-between text-[10px] mb-0.5">
                                                <span className="text-gray-700 font-medium truncate max-w-[180px]">{label}</span>
                                                <span className="text-teal-700 font-bold">{fmtDec(item.totalVolumeM3, 4)} m{'\u00b3'}</span>
                                            </div>
                                            <HorizBar value={item.totalVolumeM3} maxValue={maxV} color="bg-teal-500" />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ─── Tabs + Filters ─────────────────────── */}
            <div className="flex flex-wrap gap-2 items-center">
                {/* Tabs */}
                <div className="flex bg-gray-100 rounded-lg p-0.5 mr-2">
                    {tabs.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`text-xs px-3 py-1.5 rounded-md transition font-medium ${activeTab === tab.key
                                ? 'bg-white shadow text-blue-700'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            {tab.icon} {tab.label} <span className="ml-1 text-[10px] opacity-60">({tab.count})</span>
                        </button>
                    ))}
                </div>

                {/* Search */}
                <input
                    type="text"
                    value={globalSearch}
                    onChange={e => setGlobalSearch(e.target.value)}
                    placeholder="🔍 Cari area/customer/SO..."
                    className="text-xs border rounded-lg px-3 py-1.5 bg-white w-52 focus:ring-1 focus:ring-blue-300 outline-none"
                />
                {/* Province filter */}
                <select
                    value={filterProvince}
                    onChange={e => setFilterProvince(e.target.value)}
                    className="text-xs border rounded-lg px-3 py-1.5 bg-white focus:ring-1 focus:ring-blue-300 outline-none"
                >
                    <option value="">Semua Provinsi</option>
                    {provinces.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                {/* Area filter */}
                <select
                    value={filterArea}
                    onChange={e => setFilterArea(e.target.value)}
                    className="text-xs border rounded-lg px-3 py-1.5 bg-white focus:ring-1 focus:ring-blue-300 outline-none"
                >
                    <option value="">Semua Area</option>
                    {areaNames.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <Button variant="outline" size="sm" onClick={handleExport} className="text-xs h-7">📥 Export</Button>
                <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={loading} className="text-xs h-7 border-blue-300 text-blue-700 hover:bg-blue-50">
                    {loading ? '⟳ Memuat...' : '🔄 Refresh'}
                </Button>
            </div>

            {/* ─── Status & Delivery Status Multi-select ── */}
            <div className="flex flex-wrap items-center gap-3 bg-indigo-50/50 rounded-lg px-3 py-2 border border-indigo-200">
                <span className="text-xs font-medium text-indigo-600">📋 Status:</span>
                {allStatuses.map(status => (
                    <label key={status} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={filterStatuses.includes(status)}
                            onChange={() => toggleStatus(status)}
                            className="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                        />
                        <span className="text-xs text-gray-700">{status}</span>
                    </label>
                ))}
                <span className="text-xs text-muted-foreground ml-1">
                    ({filterStatuses.length === 0 ? 'semua' : filterStatuses.length + ' dipilih'})
                </span>

                <span className="text-gray-300 mx-1">|</span>

                <span className="text-xs font-medium text-teal-600">📦 Kiriman:</span>
                {allDeliveryStatuses.map(status => (
                    <label key={status} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={filterDeliveryStatuses.includes(status)}
                            onChange={() => toggleDeliveryStatus(status)}
                            className="rounded border-teal-300 text-teal-600 focus:ring-teal-500 h-3.5 w-3.5"
                        />
                        <span className="text-xs text-gray-700">{status}</span>
                    </label>
                ))}
                <span className="text-xs text-muted-foreground ml-1">
                    ({filterDeliveryStatuses.length === 0 ? 'semua' : filterDeliveryStatuses.length + ' dipilih'})
                </span>
            </div>

            {/* ─── Error ──────────────────────────────── */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
                    ⚠️ {error}
                </div>
            )}

            {/* ─── Loading ────────────────────────────── */}
            {loading && (
                <div className="flex items-center justify-center h-40 text-gray-400">
                    <div className="text-center">
                        <div className="w-7 h-7 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-xs">Memuat data delivery routing...</p>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════
                TAB 1: PIVOT PER AREA
               ═══════════════════════════════════════════ */}
            {!loading && !error && activeTab === 'area' && (
                <>
                    {filteredAreas.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <p className="text-4xl mb-3">🗺️</p>
                            <p className="text-sm">Tidak ada data area untuk filter ini</p>
                        </div>
                    ) : (
                        <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-50 border-b">
                                        <tr>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold w-6">#</th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleAreaSort('area')}>
                                                Area / Cluster <SortIcon active={areaSortKey === 'area'} asc={areaSortAsc} /></th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">Kota</th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleAreaSort('soCount')}>
                                                SO <SortIcon active={areaSortKey === 'soCount'} asc={areaSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleAreaSort('customerCount')}>
                                                Customer <SortIcon active={areaSortKey === 'customerCount'} asc={areaSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none min-w-[120px]" onClick={() => handleAreaSort('totalWeightKg')}>
                                                Berat (kg) <SortIcon active={areaSortKey === 'totalWeightKg'} asc={areaSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none min-w-[120px]" onClick={() => handleAreaSort('totalVolumeM3')}>
                                                Volume (m³) <SortIcon active={areaSortKey === 'totalVolumeM3'} asc={areaSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleAreaSort('totalValue')}>
                                                Nilai <SortIcon active={areaSortKey === 'totalValue'} asc={areaSortAsc} /></th>
                                            <th className="text-center px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleAreaSort('oldestSODate')}>
                                                Umur <SortIcon active={areaSortKey === 'oldestSODate'} asc={areaSortAsc} /></th>
                                            <th className="text-center px-3 py-2.5 text-gray-500 font-semibold min-w-[110px]">Kendaraan</th>
                                            <th className="text-center px-3 py-2.5 text-gray-500 font-semibold w-[50px]">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredAreas.map((row, idx) => {
                                            const isExpanded = expandedArea === `${row.area}||${row.cluster}`;
                                            const days = daysSince(row.oldestSODate);

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
                                                        <td className="px-3 py-2.5 text-right">
                                                            <div className="font-mono font-medium text-blue-700 mb-0.5">{fmtDec(row.totalWeightKg, 1)}</div>
                                                            <HorizBar value={row.totalWeightKg} maxValue={maxAreaWeight} color="bg-blue-400" />
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right">
                                                            <div className="font-mono font-medium text-teal-700 mb-0.5">{fmtDec(row.totalVolumeM3, 4)}</div>
                                                            <HorizBar value={row.totalVolumeM3} maxValue={maxAreaVolume} color="bg-teal-400" />
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right text-gray-700 font-medium">{mRp(row.totalValue)}</td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            <UrgencyBadge days={days} />
                                                        </td>
                                                        <td className="px-3 py-2.5">
                                                            <FleetBadge suggestion={areaSuggestions.get(`${row.area}||${row.cluster}`)} />
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            <button
                                                                onClick={() => setExpandedArea(isExpanded ? null : `${row.area}||${row.cluster}`)}
                                                                className="text-blue-600 hover:text-blue-800 font-medium text-[11px] border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50 transition"
                                                            >{isExpanded ? '▲' : '▼'}</button>
                                                        </td>
                                                    </tr>

                                                    {/* Expanded: Area capacity + SO list */}
                                                    {isExpanded && (
                                                        <tr className="bg-blue-50/30">
                                                            <td colSpan={11} className="px-4 py-3">
                                                                {/* Capacity bars */}
                                                                <div className="mb-3 bg-white border border-blue-100 rounded-lg p-3">
                                                                    <p className="text-[10px] text-gray-400 font-semibold mb-2">📊 Kapasitas Area</p>
                                                                    <div className="flex gap-6">
                                                                        <CapacityBar used={row.totalWeightKg} max={truckWeightKg} label="Berat" unit="kg" />
                                                                        <CapacityBar used={row.totalVolumeM3} max={truckVolumeM3} label="Volume" unit="m³" />
                                                                    </div>
                                                                </div>

                                                                {/* Customer breakdown mini */}
                                                                {row.customers.length > 1 && (
                                                                    <div className="mb-3 bg-white border border-purple-100 rounded-lg p-3">
                                                                        <p className="text-[10px] text-gray-400 font-semibold mb-2">👤 Breakdown per Customer ({row.customers.length})</p>
                                                                        <div className="max-h-[180px] overflow-y-auto">
                                                                            <table className="w-full text-[11px]">
                                                                                <thead className="bg-gray-50 border-b sticky top-0">
                                                                                    <tr>
                                                                                        <th className="text-left px-2 py-1.5 text-gray-400">Customer</th>
                                                                                        <th className="text-right px-2 py-1.5 text-gray-400">SO</th>
                                                                                        <th className="text-right px-2 py-1.5 text-gray-400">Berat (kg)</th>
                                                                                        <th className="text-right px-2 py-1.5 text-gray-400">Volume (m³)</th>
                                                                                        <th className="text-right px-2 py-1.5 text-gray-400">Nilai</th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody>
                                                                                    {row.customers.map(c => (
                                                                                        <tr key={c.customerName} className="border-b border-gray-50 hover:bg-gray-50">
                                                                                            <td className="px-2 py-1.5 text-gray-700 truncate max-w-[200px]">{c.customerName}</td>
                                                                                            <td className="px-2 py-1.5 text-right text-purple-600 font-medium">{c.soCount}</td>
                                                                                            <td className="px-2 py-1.5 text-right font-mono text-blue-600">{fmtDec(c.totalWeightKg, 1)}</td>
                                                                                            <td className="px-2 py-1.5 text-right font-mono text-teal-600">{fmtDec(c.totalVolumeM3, 4)}</td>
                                                                                            <td className="px-2 py-1.5 text-right text-gray-600">{mRp(c.totalValue)}</td>
                                                                                        </tr>
                                                                                    ))}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* SO list */}
                                                                <div className="bg-white rounded-lg border overflow-hidden">
                                                                    <p className="text-[10px] text-gray-400 font-semibold px-3 pt-2 pb-1">📋 Daftar SO ({row.soItems.length})</p>
                                                                    <table className="w-full text-xs">
                                                                        <thead className="bg-gray-50 border-b">
                                                                            <tr>
                                                                                <th className="text-left px-3 py-2 text-gray-500">No. SO</th>
                                                                                <th className="text-left px-3 py-2 text-gray-500">Customer</th>
                                                                                <th className="text-left px-3 py-2 text-gray-500">Tanggal</th>
                                                                                <th className="text-left px-3 py-2 text-gray-500">Status</th>
                                                                                <th className="text-left px-3 py-2 text-gray-500">Kiriman</th>
                                                                                <th className="text-left px-3 py-2 text-gray-500">Armada</th>
                                                                                <th className="text-right px-3 py-2 text-gray-500">Items</th>
                                                                                <th className="text-right px-3 py-2 text-gray-500">Berat (kg)</th>
                                                                                <th className="text-right px-3 py-2 text-gray-500">Volume (m³)</th>
                                                                                <th className="text-right px-3 py-2 text-gray-500">Nilai</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {row.soItems.map(so => (
                                                                                <tr key={so.soNumber} className="border-b border-gray-50 hover:bg-gray-50">
                                                                                    <td className="px-3 py-2 font-mono text-blue-600 font-medium">{so.soNumber}</td>
                                                                                    <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate">{so.customerName}</td>
                                                                                    <td className="px-3 py-2 text-gray-500">{fmtDateSlash(so.transDate)}</td>
                                                                                    <td className="px-3 py-2"><StatusBadge status={so.statusName} /></td>
                                                                                    <td className="px-3 py-2"><DeliveryBadge status={so.deliveryStatus} /></td>
                                                                                    <td className="px-3 py-2"><DispatchBadge status={so.dispatchStatus} driver={so.dispatchDriver} /></td>
                                                                                    <td className="px-3 py-2 text-right text-gray-600">{so.itemCount}</td>
                                                                                    <td className="px-3 py-2 text-right font-mono text-blue-600">{fmtDec(so.totalWeightKg, 1)}</td>
                                                                                    <td className="px-3 py-2 text-right font-mono text-teal-600">{fmtDec(so.totalVolumeM3, 4)}</td>
                                                                                    <td className="px-3 py-2 text-right text-gray-600">{mRp(so.totalValue)}</td>
                                                                                </tr>
                                                                            ))}
                                                                            {/* Total row */}
                                                                            <tr className="bg-gray-50 font-bold border-t">
                                                                                <td colSpan={7} className="px-3 py-2 text-right text-gray-500">Total Area:</td>
                                                                                <td className="px-3 py-2 text-right font-mono text-blue-700">{fmtDec(row.totalWeightKg, 1)}</td>
                                                                                <td className="px-3 py-2 text-right font-mono text-teal-700">{fmtDec(row.totalVolumeM3, 4)}</td>
                                                                                <td className="px-3 py-2 text-right text-gray-700">{mRp(row.totalValue)}</td>
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

                                        {/* Grand Total Row */}
                                        <tr className="bg-slate-100 font-bold border-t-2">
                                            <td colSpan={3} className="px-3 py-3 text-right text-slate-600 text-xs">GRAND TOTAL ({filteredAreas.length} area):</td>
                                            <td className="px-3 py-3 text-right text-purple-800">{fmt(areaGrandTotal.soCount)}</td>
                                            <td className="px-3 py-3 text-right text-green-800">{fmt(areaGrandTotal.customerCount)}</td>
                                            <td className="px-3 py-3 text-right font-mono text-blue-800">{fmtDec(areaGrandTotal.weight, 1)}</td>
                                            <td className="px-3 py-3 text-right font-mono text-teal-800">{fmtDec(areaGrandTotal.volume, 4)}</td>
                                            <td className="px-3 py-3 text-right text-slate-700">{mRp(areaGrandTotal.value)}</td>
                                            <td colSpan={3} />
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════════════════════════════════
                TAB 2: PIVOT PER CUSTOMER
               ═══════════════════════════════════════════ */}
            {!loading && !error && activeTab === 'customer' && (
                <>
                    {filteredCustomers.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <p className="text-4xl mb-3">👤</p>
                            <p className="text-sm">Tidak ada data customer untuk filter ini</p>
                        </div>
                    ) : (
                        <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-50 border-b">
                                        <tr>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold w-6">#</th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleCustSort('area')}>
                                                Area <SortIcon active={custSortKey === 'area'} asc={custSortAsc} /></th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleCustSort('customerName')}>
                                                Customer <SortIcon active={custSortKey === 'customerName'} asc={custSortAsc} /></th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleCustSort('city')}>
                                                Kota <SortIcon active={custSortKey === 'city'} asc={custSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleCustSort('soCount')}>
                                                SO <SortIcon active={custSortKey === 'soCount'} asc={custSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none min-w-[140px]" onClick={() => handleCustSort('totalWeightKg')}>
                                                Berat (kg) <SortIcon active={custSortKey === 'totalWeightKg'} asc={custSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none min-w-[140px]" onClick={() => handleCustSort('totalVolumeM3')}>
                                                Volume (m³) <SortIcon active={custSortKey === 'totalVolumeM3'} asc={custSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleCustSort('totalValue')}>
                                                Nilai <SortIcon active={custSortKey === 'totalValue'} asc={custSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold">Outstanding</th>
                                            <th className="text-center px-3 py-2.5 text-gray-500 font-semibold w-[50px]">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredCustomers.map((cust, idx) => {
                                            const isExpanded = expandedCustomer === `${cust.area}||${cust.customerName}`;
                                            return (
                                                <React.Fragment key={`${cust.area}||${cust.customerName}`}>
                                                    <tr className={`border-b transition-colors ${isExpanded ? 'bg-purple-50 border-purple-200' : 'hover:bg-gray-50'}`}>
                                                        <td className="px-3 py-2.5 text-gray-400">{idx + 1}</td>
                                                        <td className="px-3 py-2.5">
                                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">{cust.area}</span>
                                                            {cust.cluster !== '-' && <span className="text-[10px] text-gray-400 ml-1">{cust.cluster}</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5">
                                                            <div className="font-medium text-gray-800 truncate max-w-[200px]">{cust.customerName}</div>
                                                            {cust.customerNo && <div className="text-[10px] text-gray-400 font-mono">{cust.customerNo}</div>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-gray-500 text-[11px]">{cust.city}</td>
                                                        <td className="px-3 py-2.5 text-right font-medium text-purple-700">{cust.soCount}</td>
                                                        <td className="px-3 py-2.5 text-right">
                                                            <div className="font-mono font-medium text-blue-700 mb-0.5">{fmtDec(cust.totalWeightKg, 1)}</div>
                                                            <HorizBar value={cust.totalWeightKg} maxValue={maxCustWeight} color="bg-blue-400" />
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right font-mono font-medium text-teal-700">{fmtDec(cust.totalVolumeM3, 4)}</td>
                                                        <td className="px-3 py-2.5 text-right text-gray-700 font-medium">{mRp(cust.totalValue)}</td>
                                                        <td className="px-3 py-2.5 text-right">
                                                            {cust.totalOutstandingPcs > 0
                                                                ? <span className="text-orange-600 font-medium">{fmt(cust.totalOutstandingPcs)}</span>
                                                                : <span className="text-green-600">0</span>
                                                            }
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            <button
                                                                onClick={() => setExpandedCustomer(isExpanded ? null : `${cust.area}||${cust.customerName}`)}
                                                                className="text-purple-600 hover:text-purple-800 font-medium text-[11px] border border-purple-200 rounded px-2 py-0.5 hover:bg-purple-50 transition"
                                                            >{isExpanded ? '▲' : '▼'}</button>
                                                        </td>
                                                    </tr>

                                                    {/* Expanded: SO numbers */}
                                                    {isExpanded && (
                                                        <tr className="bg-purple-50/30">
                                                            <td colSpan={10} className="px-4 py-3">
                                                                <div className="bg-white rounded-lg border p-3">
                                                                    <p className="text-[10px] text-gray-400 font-semibold mb-2">📋 SO dari {cust.customerName}</p>
                                                                    <div className="flex flex-wrap gap-1.5">
                                                                        {cust.soNumbers.map(sn => (
                                                                            <span key={sn} className="text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5">{sn}</span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}

                                        {/* Grand Total Row */}
                                        <tr className="bg-slate-100 font-bold border-t-2">
                                            <td colSpan={4} className="px-3 py-3 text-right text-slate-600 text-xs">GRAND TOTAL ({filteredCustomers.length} customer):</td>
                                            <td className="px-3 py-3 text-right text-purple-800">{fmt(custGrandTotal.soCount)}</td>
                                            <td className="px-3 py-3 text-right font-mono text-blue-800">{fmtDec(custGrandTotal.weight, 1)}</td>
                                            <td className="px-3 py-3 text-right font-mono text-teal-800">{fmtDec(custGrandTotal.volume, 4)}</td>
                                            <td className="px-3 py-3 text-right text-slate-700">{mRp(custGrandTotal.value)}</td>
                                            <td colSpan={2} />
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════════════════════════════════
                TAB 3: SEMUA SO (DETAIL)
               ═══════════════════════════════════════════ */}
            {!loading && !error && activeTab === 'detail' && (
                <>
                    {filteredDetails.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <p className="text-4xl mb-3">📋</p>
                            <p className="text-sm">Tidak ada SO untuk filter ini</p>
                        </div>
                    ) : (
                        <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-50 border-b">
                                        <tr>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold w-6">#</th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleDetailSort('soNumber')}>
                                                No. SO <SortIcon active={detailSortKey === 'soNumber'} asc={detailSortAsc} /></th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleDetailSort('customerName')}>
                                                Customer <SortIcon active={detailSortKey === 'customerName'} asc={detailSortAsc} /></th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">Area</th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">Kota</th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleDetailSort('transDate')}>
                                                Tanggal <SortIcon active={detailSortKey === 'transDate'} asc={detailSortAsc} /></th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">Status</th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">Kiriman</th>
                                            <th className="text-left px-3 py-2.5 text-gray-500 font-semibold">Armada</th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold">Items</th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleDetailSort('totalWeightKg')}>
                                                Berat (kg) <SortIcon active={detailSortKey === 'totalWeightKg'} asc={detailSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleDetailSort('totalVolumeM3')}>
                                                Volume (m³) <SortIcon active={detailSortKey === 'totalVolumeM3'} asc={detailSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold cursor-pointer hover:text-blue-600 select-none" onClick={() => handleDetailSort('totalValue')}>
                                                Nilai <SortIcon active={detailSortKey === 'totalValue'} asc={detailSortAsc} /></th>
                                            <th className="text-right px-3 py-2.5 text-gray-500 font-semibold">Outstanding</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredDetails.map((so, idx) => (
                                            <tr key={`${so.soNumber}-${idx}`} className="border-b hover:bg-gray-50 transition-colors">
                                                <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                                                <td className="px-3 py-2 font-mono text-blue-600 font-medium">{so.soNumber}</td>
                                                <td className="px-3 py-2">
                                                    <div className="text-gray-700 max-w-[180px] truncate">{so.customerName}</div>
                                                    {so.customerNo && <div className="text-[10px] text-gray-400 font-mono">{so.customerNo}</div>}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">{so.area}</span>
                                                </td>
                                                <td className="px-3 py-2 text-gray-500 text-[11px]">{so.city || '-'}</td>
                                                <td className="px-3 py-2 text-gray-500">{fmtDateSlash(so.transDate)}</td>
                                                <td className="px-3 py-2"><StatusBadge status={so.statusName} /></td>
                                                <td className="px-3 py-2"><DeliveryBadge status={so.deliveryStatus} /></td>
                                                <td className="px-3 py-2"><DispatchBadge status={so.dispatchStatus} driver={so.dispatchDriver} /></td>
                                                <td className="px-3 py-2 text-right text-gray-600">{so.itemCount}</td>
                                                <td className="px-3 py-2 text-right font-mono text-blue-600 font-medium">{fmtDec(so.totalWeightKg, 1)}</td>
                                                <td className="px-3 py-2 text-right font-mono text-teal-600 font-medium">{fmtDec(so.totalVolumeM3, 4)}</td>
                                                <td className="px-3 py-2 text-right text-gray-600">{mRp(so.totalValue)}</td>
                                                <td className="px-3 py-2 text-right">
                                                    {so.outstandingPcs > 0
                                                        ? <span className="text-orange-600 font-medium">{fmt(so.outstandingPcs)}</span>
                                                        : <span className="text-green-600">0</span>
                                                    }
                                                </td>
                                            </tr>
                                        ))}

                                        {/* Grand Total */}
                                        <tr className="bg-slate-100 font-bold border-t-2">
                                            <td colSpan={9} className="px-3 py-3 text-right text-slate-600 text-xs">GRAND TOTAL ({filteredDetails.length} SO):</td>
                                            <td className="px-3 py-3 text-right font-mono text-blue-800">{fmtDec(detailGrandTotal.weight, 1)}</td>
                                            <td className="px-3 py-3 text-right font-mono text-teal-800">{fmtDec(detailGrandTotal.volume, 4)}</td>
                                            <td className="px-3 py-3 text-right text-slate-700">{mRp(detailGrandTotal.value)}</td>
                                            <td />
                                        </tr>
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
