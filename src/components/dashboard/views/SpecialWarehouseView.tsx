'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';

// ─── Types ─────────────────────────────────────────────────
interface SpecialWarehouseItem {
  warehouseId: number;
  warehouseName: string;
  category: 'expired' | 'retur' | 'rusak';
  subCategory?: string;
  itemNo: string;
  itemName: string;
  unit: string;
  quantity: number;
  value: number;
  firstSeenAt: string;
  agingDays: number;
  agingBracket: string;
}

interface Summary {
  totalSKU: number;
  totalQty: number;
  totalValue: number;
  avgAgingDays: number;
}

interface AgingDistribution {
  '0-7': number;
  '8-15': number;
  '16-30': number;
  '31-45': number;
  '46-60': number;
  '61-90': number;
  '91-120': number;
  '120+': number;
}

interface MovementPoint {
  date: string;
  totalQty: number;
  totalSKU: number;
}

// ─── Aging color helpers ───────────────────────────────────
const AGING_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  '0-7':    { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Baru' },
  '8-15':   { bg: 'bg-green-100',   text: 'text-green-800',   label: 'Normal' },
  '16-30':  { bg: 'bg-yellow-100',  text: 'text-yellow-800',  label: 'Perhatian' },
  '31-45':  { bg: 'bg-orange-100',  text: 'text-orange-800',  label: 'Warning' },
  '46-60':  { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Kritis' },
  '61-90':  { bg: 'bg-red-200',     text: 'text-red-800',     label: 'Sangat Kritis' },
  '91-120': { bg: 'bg-red-300',     text: 'text-red-900',     label: 'Overdue' },
  '120+':   { bg: 'bg-red-500',     text: 'text-white',       label: 'Urgent' },
};

const AGING_BAR_COLORS: Record<string, string> = {
  '0-7':    'bg-emerald-500',
  '8-15':   'bg-green-500',
  '16-30':  'bg-yellow-500',
  '31-45':  'bg-orange-500',
  '46-60':  'bg-red-400',
  '61-90':  'bg-red-500',
  '91-120': 'bg-red-600',
  '120+':   'bg-red-800',
};

const formatRp = (v: number) => 'Rp ' + v.toLocaleString('id-ID');

const CATEGORY_CONFIG = {
  expired: { icon: '⏰', label: 'Gudang Expired', color: 'text-amber-600 border-amber-200 bg-amber-50' },
  retur:   { icon: '🔄', label: 'Gudang Retur',   color: 'text-blue-600 border-blue-200 bg-blue-50' },
  rusak:   { icon: '🗑️', label: 'Gudang Rusak',   color: 'text-red-600 border-red-200 bg-red-50' },
};

// ─── Component ─────────────────────────────────────────────
export default function SpecialWarehouseView() {
  const [activeCategory, setActiveCategory] = useState<'expired' | 'retur' | 'rusak'>('expired');
  const [items, setItems] = useState<SpecialWarehouseItem[]>([]);
  const [summary, setSummary] = useState<Summary>({ totalSKU: 0, totalQty: 0, totalValue: 0, avgAgingDays: 0 });
  const [agingDist, setAgingDist] = useState<AgingDistribution | null>(null);
  const [movement, setMovement] = useState<MovementPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterBracket, setFilterBracket] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'agingDays' | 'quantity' | 'value'>('agingDays');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stockRes, movementRes] = await Promise.all([
        fetch(`/api/special-warehouse?type=${activeCategory}`),
        fetch(`/api/special-warehouse/snapshot?days=30`),
      ]);

      if (!stockRes.ok) throw new Error('Failed to fetch warehouse data');

      const stockData = await stockRes.json();
      if (stockData.error && !stockData.items) throw new Error(stockData.error);

      setItems(stockData.items || []);
      setSummary(stockData.summary || { totalSKU: 0, totalQty: 0, totalValue: 0, avgAgingDays: 0 });
      setAgingDist(stockData.agingDistribution || null);

      if (movementRes.ok) {
        const movData = await movementRes.json();
        setMovement(movData.movement || []);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Take snapshot
  const takeSnapshot = async () => {
    setSnapshotLoading(true);
    setSnapshotMessage(null);
    try {
      const res = await fetch('/api/special-warehouse/snapshot', { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSnapshotMessage(`✅ Snapshot: ${data.snapshots} records, ${data.newItems} baru`);
      fetchData(); // Refresh
    } catch (err: any) {
      setSnapshotMessage(`❌ ${err.message}`);
    } finally {
      setSnapshotLoading(false);
    }
  };

  // Filter & sort
  const displayItems = useMemo(() => {
    let filtered = [...items];
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(i =>
        i.itemNo.toLowerCase().includes(s) || i.itemName.toLowerCase().includes(s)
      );
    }
    if (filterBracket) {
      filtered = filtered.filter(i => i.agingBracket === filterBracket);
    }
    filtered.sort((a, b) => {
      const va = a[sortField];
      const vb = b[sortField];
      return sortDir === 'desc' ? (vb as number) - (va as number) : (va as number) - (vb as number);
    });
    return filtered;
  }, [items, search, filterBracket, sortField, sortDir]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (field: typeof sortField) => sortField === field ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  // Max aging dist for bar chart
  const maxDist = agingDist ? Math.max(...Object.values(agingDist), 1) : 1;

  return (
    <div className="space-y-6">
      {/* Category Tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-white border rounded-lg p-1">
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
            <Button
              key={key}
              variant={activeCategory === key ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveCategory(key as any)}
              className={`gap-1.5 ${activeCategory !== key ? cfg.color : ''}`}
            >
              <span>{cfg.icon}</span> {cfg.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={takeSnapshot}
            disabled={snapshotLoading}
          >
            {snapshotLoading ? '📸 Mengambil...' : '📸 Take Snapshot'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            🔄 Refresh
          </Button>
        </div>
      </div>

      {snapshotMessage && (
        <div className="text-sm px-3 py-2 bg-gray-50 rounded border">
          {snapshotMessage}
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-500">
          <div className="animate-spin text-4xl mb-4">⏳</div>
          <p>Memuat data gudang khusus...</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="text-sm text-gray-500">Total SKU</div>
                <div className="text-2xl font-bold text-gray-900">{summary.totalSKU}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="text-sm text-gray-500">Total Qty</div>
                <div className="text-2xl font-bold text-gray-900">{summary.totalQty.toLocaleString('id-ID')}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="text-sm text-gray-500">Total Value</div>
                <div className="text-2xl font-bold text-gray-900">{formatRp(summary.totalValue)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="text-sm text-gray-500">Rata-rata Aging</div>
                <div className="text-2xl font-bold text-gray-900">{summary.avgAgingDays} <span className="text-sm font-normal text-gray-500">hari</span></div>
              </CardContent>
            </Card>
          </div>

          {/* Aging Distribution Bar Chart */}
          {agingDist && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">📊 Distribusi Aging</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                  {Object.entries(agingDist).map(([bracket, count]) => {
                    const pct = (count / maxDist) * 100;
                    const isActive = filterBracket === bracket;
                    return (
                      <button
                        key={bracket}
                        onClick={() => setFilterBracket(isActive ? null : bracket)}
                        className={`flex flex-col items-center rounded-lg p-2 transition-all hover:scale-105 ${
                          isActive ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="w-full h-24 flex items-end justify-center mb-1">
                          <div
                            className={`w-8 rounded-t ${AGING_BAR_COLORS[bracket]} transition-all`}
                            style={{ height: `${Math.max(pct, 5)}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-gray-700">{count}</span>
                        <span className="text-[10px] text-gray-500">{bracket} hr</span>
                      </button>
                    );
                  })}
                </div>
                {filterBracket && (
                  <div className="mt-2 text-sm text-blue-600">
                    Menampilkan item aging {filterBracket} hari
                    <button onClick={() => setFilterBracket(null)} className="ml-2 text-gray-400 hover:text-gray-600">✕ Clear</button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Movement Chart (simple) */}
          {movement.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">📈 Pergerakan Stock (30 Hari Terakhir)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-1 h-32">
                  {movement.map((m, i) => {
                    const maxQty = Math.max(...movement.map(x => x.totalQty), 1);
                    const pct = (m.totalQty / maxQty) * 100;
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-blue-400 hover:bg-blue-500 rounded-t transition-all cursor-pointer group relative"
                        style={{ height: `${Math.max(pct, 3)}%` }}
                        title={`${m.date}: ${m.totalQty} qty, ${m.totalSKU} SKU`}
                      >
                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-10">
                          {m.date.slice(5)}: {m.totalQty}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-gray-400">{movement[0]?.date?.slice(5)}</span>
                  <span className="text-[10px] text-gray-400">{movement[movement.length - 1]?.date?.slice(5)}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Items Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">
                  {CATEGORY_CONFIG[activeCategory].icon} Daftar Item — {CATEGORY_CONFIG[activeCategory].label}
                  <Badge variant="outline" className="ml-2">{displayItems.length} item</Badge>
                </CardTitle>
                <Input
                  placeholder="🔍 Cari kode/nama..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-60"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 sticky top-0 z-10">
                      <TableHead className="w-10 text-center sticky left-0 bg-gray-50 z-20">#</TableHead>
                      <TableHead className="sticky left-10 bg-gray-50 z-20 min-w-[100px]">Kode</TableHead>
                      <TableHead className="sticky left-[180px] bg-gray-50 z-20 min-w-[200px]">Nama Item</TableHead>
                      <TableHead>Gudang</TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-blue-600" onClick={() => toggleSort('quantity')}>
                        Qty{sortIcon('quantity')}
                      </TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-blue-600" onClick={() => toggleSort('value')}>
                        Value{sortIcon('value')}
                      </TableHead>
                      <TableHead>First Seen</TableHead>
                      <TableHead className="text-center cursor-pointer hover:text-blue-600" onClick={() => toggleSort('agingDays')}>
                        Aging{sortIcon('agingDays')}
                      </TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-10 text-gray-400">
                          {items.length === 0
                            ? 'Tidak ada item di gudang ini. Pastikan sudah Force Sync.'
                            : 'Tidak ada item yang cocok dengan filter.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayItems.map((item, idx) => {
                        const agingColor = AGING_COLORS[item.agingBracket] || AGING_COLORS['120+'];
                        return (
                          <TableRow key={`${item.warehouseId}-${item.itemNo}`} className="hover:bg-gray-50">
                            <TableCell className="text-center text-xs text-gray-400 sticky left-0 bg-white">{idx + 1}</TableCell>
                            <TableCell className="font-mono text-xs sticky left-10 bg-white">{item.itemNo}</TableCell>
                            <TableCell className="text-sm sticky left-[180px] bg-white max-w-[300px] truncate" title={item.itemName}>
                              {item.itemName}
                            </TableCell>
                            <TableCell className="text-xs text-gray-500">{item.warehouseName}</TableCell>
                            <TableCell className="text-right font-medium">
                              {item.quantity.toLocaleString('id-ID')} <span className="text-xs text-gray-400">{item.unit}</span>
                            </TableCell>
                            <TableCell className="text-right text-sm">{formatRp(item.value)}</TableCell>
                            <TableCell className="text-xs text-gray-500">
                              {new Date(item.firstSeenAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })}
                            </TableCell>
                            <TableCell className="text-center">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${agingColor.bg} ${agingColor.text}`}>
                                {item.agingDays} hr
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <span className={`text-xs ${agingColor.text}`}>{agingColor.label}</span>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Legend */}
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(AGING_COLORS).map(([bracket, color]) => (
              <span key={bracket} className={`px-2 py-1 rounded ${color.bg} ${color.text}`}>
                {bracket} hr: {color.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
