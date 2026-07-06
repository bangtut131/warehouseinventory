'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';

// ─── Types ─────────────────────────────────────────────────
const AGING_BRACKETS = ['0-7', '8-15', '16-30', '31-45', '46-60', '61-90', '91-120', '120+'] as const;
type AgingBracket = typeof AGING_BRACKETS[number];

interface SpecialWarehouseItem {
  warehouseId: number;
  warehouseName: string;
  category: 'expired' | 'retur' | 'rusak';
  subCategory?: string;
  itemNo: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  value: number;
  firstSeenAt: string;
  avgAgingDays: number;
  agingBrackets: Record<AgingBracket, number>;
  transferCount: number;
}

interface Summary {
  totalSKU: number;
  totalQty: number;
  totalValue: number;
  avgAgingDays: number;
}

interface MovementPoint {
  date: string;
  totalQty: number;
  totalSKU: number;
}

// ─── Aging colors ──────────────────────────────────────────
const BRACKET_STYLES: Record<AgingBracket, { bg: string; headerBg: string; text: string; label: string }> = {
  '0-7':    { bg: 'bg-emerald-50',  headerBg: 'bg-emerald-100', text: 'text-emerald-800', label: '0-7 hr' },
  '8-15':   { bg: 'bg-green-50',    headerBg: 'bg-green-100',   text: 'text-green-800',   label: '8-15 hr' },
  '16-30':  { bg: 'bg-yellow-50',   headerBg: 'bg-yellow-100',  text: 'text-yellow-800',  label: '16-30 hr' },
  '31-45':  { bg: 'bg-orange-50',   headerBg: 'bg-orange-100',  text: 'text-orange-800',  label: '31-45 hr' },
  '46-60':  { bg: 'bg-red-50',      headerBg: 'bg-red-100',     text: 'text-red-700',     label: '46-60 hr' },
  '61-90':  { bg: 'bg-red-100',     headerBg: 'bg-red-200',     text: 'text-red-800',     label: '61-90 hr' },
  '91-120': { bg: 'bg-red-200',     headerBg: 'bg-red-300',     text: 'text-red-900',     label: '91-120 hr' },
  '120+':   { bg: 'bg-red-300',     headerBg: 'bg-red-400',     text: 'text-white',       label: '>120 hr' },
};

const AGING_BAR_COLORS: Record<string, string> = {
  '0-7': 'bg-emerald-500', '8-15': 'bg-green-500', '16-30': 'bg-yellow-500',
  '31-45': 'bg-orange-500', '46-60': 'bg-red-400', '61-90': 'bg-red-500',
  '91-120': 'bg-red-600', '120+': 'bg-red-800',
};

const formatRp = (v: number) => v >= 1_000_000 ? `Rp ${(v / 1_000_000).toFixed(1)}M` : `Rp ${v.toLocaleString('id-ID')}`;
const formatRpFull = (v: number) => `Rp ${v.toLocaleString('id-ID')}`;

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
  const [agingDist, setAgingDist] = useState<Record<string, number> | null>(null);
  const [movement, setMovement] = useState<MovementPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<'avgAgingDays' | 'quantity' | 'value'>('avgAgingDays');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stockRes, movementRes] = await Promise.all([
        fetch(`/api/special-warehouse?type=${activeCategory}`),
        fetch(`/api/special-warehouse/snapshot?days=30`),
      ]);

      if (!stockRes.ok) throw new Error('Gagal mengambil data gudang');
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

  const takeSnapshot = async () => {
    setSnapshotLoading(true);
    setSnapshotMessage(null);
    try {
      const res = await fetch('/api/special-warehouse/snapshot', { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSnapshotMessage(`✅ Snapshot: ${data.snapshots} records tersimpan`);
    } catch (err: any) {
      setSnapshotMessage(`❌ ${err.message}`);
    } finally {
      setSnapshotLoading(false);
    }
  };

  const displayItems = useMemo(() => {
    let filtered = [...items];
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(i => i.itemNo.toLowerCase().includes(s) || i.itemName.toLowerCase().includes(s));
    }
    filtered.sort((a, b) => {
      const va = a[sortField] as number;
      const vb = b[sortField] as number;
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return filtered;
  }, [items, search, sortField, sortDir]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };
  const sortIcon = (field: typeof sortField) => sortField === field ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';

  const maxDist = agingDist ? Math.max(...Object.values(agingDist), 1) : 1;

  // Totals per bracket
  const bracketTotals = useMemo(() => {
    const totals: Record<AgingBracket, number> = { '0-7': 0, '8-15': 0, '16-30': 0, '31-45': 0, '46-60': 0, '61-90': 0, '91-120': 0, '120+': 0 };
    displayItems.forEach(item => {
      AGING_BRACKETS.forEach(b => { totals[b] += item.agingBrackets?.[b] || 0; });
    });
    return totals;
  }, [displayItems]);

  return (
    <div className="space-y-6">
      {/* Category Tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-white border rounded-lg p-1">
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
            <Button key={key} variant={activeCategory === key ? 'default' : 'ghost'} size="sm"
              onClick={() => setActiveCategory(key as any)}
              className={`gap-1.5 ${activeCategory !== key ? cfg.color : ''}`}>
              <span>{cfg.icon}</span> {cfg.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={takeSnapshot} disabled={snapshotLoading}>
            {snapshotLoading ? '📸 Mengambil...' : '📸 Snapshot'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>🔄 Refresh</Button>
        </div>
      </div>

      {snapshotMessage && <div className="text-sm px-3 py-2 bg-gray-50 rounded border">{snapshotMessage}</div>}
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">⚠️ {error}</div>}

      {loading ? (
        <div className="text-center py-20 text-gray-500">
          <div className="animate-spin text-4xl mb-4">⏳</div>
          <p>Memuat data gudang khusus & transfer history...</p>
          <p className="text-xs text-gray-400 mt-1">Mengambil data transfer dari Accurate, mungkin memakan waktu 1-2 menit</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-4 pb-3">
              <div className="text-sm text-gray-500">Total SKU</div>
              <div className="text-2xl font-bold">{summary.totalSKU}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3">
              <div className="text-sm text-gray-500">Total Qty</div>
              <div className="text-2xl font-bold">{summary.totalQty.toLocaleString('id-ID')}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3">
              <div className="text-sm text-gray-500">Total Value</div>
              <div className="text-2xl font-bold">{formatRp(summary.totalValue)}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3">
              <div className="text-sm text-gray-500">Rata-rata Aging</div>
              <div className="text-2xl font-bold">{summary.avgAgingDays} <span className="text-sm font-normal text-gray-500">hari</span></div>
            </CardContent></Card>
          </div>

          {/* Aging Distribution Bar Chart */}
          {agingDist && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">📊 Distribusi Aging (Qty per Bracket)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                  {AGING_BRACKETS.map(bracket => {
                    const count = agingDist[bracket] || 0;
                    const pct = (count / maxDist) * 100;
                    return (
                      <div key={bracket} className="flex flex-col items-center rounded-lg p-2 hover:bg-gray-50">
                        <div className="w-full h-20 flex items-end justify-center mb-1">
                          <div className={`w-8 rounded-t ${AGING_BAR_COLORS[bracket]} transition-all`}
                            style={{ height: `${Math.max(pct, 5)}%` }} />
                        </div>
                        <span className="text-sm font-bold text-gray-700">{count.toLocaleString('id-ID')}</span>
                        <span className="text-[10px] text-gray-500">{bracket} hr</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Movement Chart */}
          {movement.length > 1 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">📈 Trend Pergerakan Stock (30 Hari Terakhir)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-1 h-32">
                  {movement.map((m, i) => {
                    const maxQty = Math.max(...movement.map(x => x.totalQty), 1);
                    const pct = (m.totalQty / maxQty) * 100;
                    return (
                      <div key={i} className="flex-1 bg-blue-400 hover:bg-blue-500 rounded-t transition-all cursor-pointer group relative"
                        style={{ height: `${Math.max(pct, 3)}%` }}
                        title={`${m.date}: ${m.totalQty} qty, ${m.totalSKU} SKU`}>
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

          {/* Items Table with Aging Bracket Columns */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">
                  {CATEGORY_CONFIG[activeCategory].icon} Daftar Item — {CATEGORY_CONFIG[activeCategory].label}
                  <Badge variant="outline" className="ml-2">{displayItems.length} item</Badge>
                </CardTitle>
                <Input placeholder="🔍 Cari kode/nama..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-60" />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 sticky top-0 z-10">
                      <TableHead className="w-8 text-center sticky left-0 bg-gray-50 z-20">#</TableHead>
                      <TableHead className="sticky left-8 bg-gray-50 z-20 min-w-[90px]">Kode</TableHead>
                      <TableHead className="sticky left-[130px] bg-gray-50 z-20 min-w-[180px]">Nama Item</TableHead>
                      <TableHead className="text-center text-xs">Gudang</TableHead>
                      <TableHead className="text-right cursor-pointer hover:text-blue-600 text-xs" onClick={() => toggleSort('quantity')}>
                        Total{sortIcon('quantity')}
                      </TableHead>
                      {/* Aging bracket columns */}
                      {AGING_BRACKETS.map(b => (
                        <TableHead key={b} className={`text-center text-[10px] min-w-[55px] ${BRACKET_STYLES[b].headerBg} ${BRACKET_STYLES[b].text}`}>
                          {BRACKET_STYLES[b].label}
                        </TableHead>
                      ))}
                      <TableHead className="text-right cursor-pointer hover:text-blue-600 text-xs" onClick={() => toggleSort('value')}>
                        Value{sortIcon('value')}
                      </TableHead>
                      <TableHead className="text-center cursor-pointer hover:text-blue-600 text-xs" onClick={() => toggleSort('avgAgingDays')}>
                        Avg{sortIcon('avgAgingDays')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={13 + AGING_BRACKETS.length} className="text-center py-10 text-gray-400">
                          {items.length === 0 ? 'Tidak ada item di gudang ini. Pastikan sudah Force Sync.' : 'Tidak ada item cocok.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {displayItems.map((item, idx) => (
                          <TableRow key={`${item.warehouseId}-${item.itemNo}`} className="hover:bg-gray-50/50">
                            <TableCell className="text-center text-xs text-gray-400 sticky left-0 bg-white">{idx + 1}</TableCell>
                            <TableCell className="font-mono text-xs sticky left-8 bg-white">{item.itemNo}</TableCell>
                            <TableCell className="text-xs sticky left-[130px] bg-white max-w-[250px] truncate" title={item.itemName}>
                              {item.itemName}
                            </TableCell>
                            <TableCell className="text-[10px] text-gray-500 text-center">{item.warehouseName}</TableCell>
                            <TableCell className="text-right font-semibold text-sm">
                              {item.quantity.toLocaleString('id-ID')}
                              <span className="text-[10px] text-gray-400 ml-0.5">{item.unit}</span>
                            </TableCell>
                            {/* Aging bracket cells */}
                            {AGING_BRACKETS.map(b => {
                              const qty = item.agingBrackets?.[b] || 0;
                              const style = BRACKET_STYLES[b];
                              return (
                                <TableCell key={b} className={`text-center text-xs font-medium ${qty > 0 ? `${style.bg} ${style.text}` : 'text-gray-200'}`}>
                                  {qty > 0 ? qty.toLocaleString('id-ID') : '-'}
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-right text-xs">{item.value > 0 ? formatRpFull(Math.round(item.value)) : '-'}</TableCell>
                            <TableCell className="text-center">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                item.avgAgingDays > 90 ? 'bg-red-500 text-white' :
                                item.avgAgingDays > 60 ? 'bg-red-200 text-red-800' :
                                item.avgAgingDays > 30 ? 'bg-orange-100 text-orange-800' :
                                item.avgAgingDays > 15 ? 'bg-yellow-100 text-yellow-800' :
                                'bg-emerald-100 text-emerald-800'
                              }`}>
                                {item.avgAgingDays}hr
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals row */}
                        <TableRow className="bg-gray-100 font-semibold sticky bottom-0">
                          <TableCell colSpan={4} className="text-right text-xs sticky left-0 bg-gray-100">TOTAL</TableCell>
                          <TableCell className="text-right text-sm">{summary.totalQty.toLocaleString('id-ID')}</TableCell>
                          {AGING_BRACKETS.map(b => (
                            <TableCell key={b} className={`text-center text-xs font-bold ${BRACKET_STYLES[b].headerBg} ${BRACKET_STYLES[b].text}`}>
                              {bracketTotals[b] > 0 ? bracketTotals[b].toLocaleString('id-ID') : '-'}
                            </TableCell>
                          ))}
                          <TableCell className="text-right text-xs">{formatRpFull(Math.round(summary.totalValue))}</TableCell>
                          <TableCell className="text-center text-xs">{summary.avgAgingDays}hr</TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Legend */}
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="text-gray-500 mr-1">Aging Legend:</span>
            {AGING_BRACKETS.map(b => (
              <span key={b} className={`px-1.5 py-0.5 rounded ${BRACKET_STYLES[b].headerBg} ${BRACKET_STYLES[b].text}`}>
                {BRACKET_STYLES[b].label}
              </span>
            ))}
          </div>

          {/* Info note about trend */}
          {movement.length <= 1 && (
            <div className="text-xs text-gray-400 bg-gray-50 rounded p-3 border border-dashed">
              📊 <strong>Trend Pergerakan Stock</strong> akan muncul setelah beberapa hari snapshot terkumpul.
              Klik "📸 Snapshot" untuk menyimpan data hari ini, atau tunggu scheduler harian otomatis.
            </div>
          )}
        </>
      )}
    </div>
  );
}
