import PDFDocument from 'pdfkit';
import { InventoryItem } from './types';

// ─── HELPERS ─────────────────────────────────────────────────

function formatDate(): string {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function formatNumber(n: number): string {
    return n.toLocaleString('id-ID');
}

/** Convert [R,G,B] array (0-255) to hex color string for PDFKit */
function rgbHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.flushPages();
        doc.end();
    });
}

// ─── TABLE DRAWING ───────────────────────────────────────────

interface TableOptions {
    headerBg: string;     // hex color
    headerColor: string;  // hex color for header text
    rowBg?: string;       // hex color for alternating rows
    rowBgAlt?: string;    // hex color for alternate rows
}

function drawTable(
    doc: PDFKit.PDFDocument,
    headers: string[],
    rows: string[][],
    colWidths: number[],
    startX: number,
    startY: number,
    options: TableOptions
): number {
    const rowHeight = 16;
    const headerHeight = 20;
    const fontSize = 7;
    const headerFontSize = 7.5;
    const padding = 3;
    const pageBottom = 550;
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);

    let y = startY;

    // ── Draw header ──
    function drawHeader(atY: number): number {
        doc.save();
        doc.fillColor(options.headerBg);
        doc.rect(startX, atY, totalWidth, headerHeight).fill();

        doc.fillColor(options.headerColor).fontSize(headerFontSize).font('Helvetica-Bold');
        let x = startX;
        headers.forEach((h, i) => {
            doc.text(h, x + padding, atY + 5, {
                width: colWidths[i] - padding * 2,
                lineBreak: false,
                align: 'center',
            });
            x += colWidths[i];
        });
        doc.restore();
        return atY + headerHeight;
    }

    y = drawHeader(y);

    // ── Draw data rows ──
    rows.forEach((row, rowIdx) => {
        if (y + rowHeight > pageBottom) {
            doc.addPage();
            y = 40;
            y = drawHeader(y);
        }

        // Alternating row background
        const bgColor = rowIdx % 2 === 0
            ? (options.rowBg || '#FFFFFF')
            : (options.rowBgAlt || options.rowBg || '#F8F8F8');

        doc.save();
        doc.fillColor(bgColor);
        doc.rect(startX, y, totalWidth, rowHeight).fill();

        // Cell borders
        doc.strokeColor('#DDDDDD').lineWidth(0.3);
        let bx = startX;
        colWidths.forEach((w) => {
            doc.rect(bx, y, w, rowHeight).stroke();
            bx += w;
        });

        // Cell text
        doc.fillColor('#333333').fontSize(fontSize).font('Helvetica');
        let cx = startX;
        row.forEach((cell, i) => {
            // First col center, number cols right, text cols left
            let align: 'left' | 'center' | 'right' = 'left';
            if (i === 0) align = 'center';
            else if (i >= 3) align = 'right';

            doc.text(cell, cx + padding, y + 4, {
                width: colWidths[i] - padding * 2,
                lineBreak: false,
                align,
            });
            cx += colWidths[i];
        });
        doc.restore();
        y += rowHeight;
    });

    return y;
}

// ─── REORDER REPORT ──────────────────────────────────────────

export async function generateReorderReport(
    items: InventoryItem[],
    branchName?: string,
    warehouseName?: string
): Promise<Buffer> {
    const criticalItems = items.filter(i => i.status === 'CRITICAL');
    const reorderItems = items.filter(i => i.status === 'REORDER');

    const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 40, bufferPages: true });

    // Header
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1E40AF')
        .text('LAPORAN REORDER INVENTORY', 40, 30, { width: 760, align: 'center' });

    doc.fontSize(9).font('Helvetica').fillColor('#555555');
    const subtitle = [
        `Tanggal: ${formatDate()}`,
        branchName ? `Cabang: ${branchName}` : '',
        warehouseName ? `Gudang: ${warehouseName}` : '',
    ].filter(Boolean).join('  |  ');
    doc.text(subtitle, 40, 48, { width: 760, align: 'center' });

    // Summary
    doc.fontSize(9).fillColor('#333333')
        .text(`Total: ${criticalItems.length + reorderItems.length} item  |  Critical: ${criticalItems.length}  |  Reorder: ${reorderItems.length}`, 40, 62, { width: 760, align: 'center' });

    let currentY = 80;
    const headers = ['No', 'Kode Item', 'Nama Barang', 'Satuan', 'Stock', 'ROP', 'Safety', 'PO Out.', 'Shortage', 'Order', 'Status'];
    const colWidths = [24, 58, 140, 38, 48, 48, 48, 50, 50, 55, 48];

    // ── Section 1: Critical Items ──
    if (criticalItems.length > 0) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#DC2626')
            .text(`CRITICAL (${criticalItems.length} item) — Di bawah Safety Stock`, 40, currentY, { width: 760 });
        currentY += 16;

        const tableData = criticalItems.map((item, idx) => [
            (idx + 1).toString(),
            item.itemNo,
            item.name.length > 35 ? item.name.substring(0, 35) + '...' : item.name,
            item.unit,
            formatNumber(item.stock),
            formatNumber(item.reorderPoint),
            formatNumber(item.safetyStock),
            item.poOutstanding > 0 ? formatNumber(item.poOutstanding) : '-',
            formatNumber(item.netShortage),
            item.suggestedOrder > 0 ? formatNumber(item.suggestedOrder) : '-',
            'CRITICAL',
        ]);

        currentY = drawTable(doc, headers, tableData, colWidths, 40, currentY, {
            headerBg: '#DC2626',
            headerColor: '#FFFFFF',
            rowBg: '#FEE2E2',
            rowBgAlt: '#FECACA',
        });
        currentY += 12;
    }

    // ── Section 2: Reorder Items ──
    if (reorderItems.length > 0) {
        if (currentY > 480) { doc.addPage(); currentY = 40; }

        doc.fontSize(10).font('Helvetica-Bold').fillColor('#EA580C')
            .text(`REORDER (${reorderItems.length} item) — Di bawah Reorder Point`, 40, currentY, { width: 760 });
        currentY += 16;

        const tableData = reorderItems.map((item, idx) => [
            (idx + 1).toString(),
            item.itemNo,
            item.name.length > 35 ? item.name.substring(0, 35) + '...' : item.name,
            item.unit,
            formatNumber(item.stock),
            formatNumber(item.reorderPoint),
            formatNumber(item.safetyStock),
            item.poOutstanding > 0 ? formatNumber(item.poOutstanding) : '-',
            formatNumber(item.netShortage),
            item.suggestedOrder > 0 ? formatNumber(item.suggestedOrder) : '-',
            'REORDER',
        ]);

        currentY = drawTable(doc, headers, tableData, colWidths, 40, currentY, {
            headerBg: '#EA580C',
            headerColor: '#FFFFFF',
            rowBg: '#FFF7ED',
            rowBgAlt: '#FFEDD5',
        });
    }

    // Footer on all pages
    addFooters(doc);

    return pdfToBuffer(doc);
}

// ─── ALERT REPORT ────────────────────────────────────────────

export async function generateAlertReport(
    items: InventoryItem[],
    branchName?: string,
    warehouseName?: string
): Promise<Buffer> {
    const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 40, bufferPages: true });

    // Header — use explicit x, width, align to ensure center
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1E40AF')
        .text('LAPORAN ALERT INVENTORY', 40, 30, { width: 760, align: 'center' });

    doc.fontSize(9).font('Helvetica').fillColor('#555555');
    const subtitle = [
        `Tanggal: ${formatDate()}`,
        branchName ? `Cabang: ${branchName}` : '',
        warehouseName ? `Gudang: ${warehouseName}` : '',
    ].filter(Boolean).join('  |  ');
    doc.text(subtitle, 40, 48, { width: 760, align: 'center' });

    const criticalItems = items.filter(i => i.status === 'CRITICAL');
    const reorderItems = items.filter(i => i.status === 'REORDER');
    const deadStockItems = items.filter(i => i.demandCategory === 'DEAD' && i.stock > 0);

    let currentY = 70;

    // ── Section 1: Critical ──
    if (criticalItems.length > 0) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#DC2626')
            .text(`CRITICAL (${criticalItems.length} item) — Di bawah Safety Stock`, 40, currentY, { width: 760 });
        currentY += 16;

        const headers = ['No', 'Kode Item', 'Nama Barang', 'Stock', 'Safety Stock', 'PO Out.', 'Shortage', 'Status'];
        const colWidths = [25, 65, 200, 75, 75, 70, 75, 55];
        const rows = criticalItems.map((item, idx) => [
            (idx + 1).toString(),
            item.itemNo,
            item.name.length > 45 ? item.name.substring(0, 45) + '...' : item.name,
            `${formatNumber(item.stock)} ${item.unit}`,
            formatNumber(item.safetyStock),
            item.poOutstanding > 0 ? `+${formatNumber(item.poOutstanding)}` : '-',
            formatNumber(item.netShortage),
            'CRITICAL',
        ]);

        currentY = drawTable(doc, headers, rows, colWidths, 40, currentY, {
            headerBg: '#DC2626',
            headerColor: '#FFFFFF',
            rowBg: '#FEE2E2',
            rowBgAlt: '#FECACA',
        });
        currentY += 15;
    }

    // ── Section 2: Reorder ──
    if (reorderItems.length > 0) {
        if (currentY > 480) { doc.addPage(); currentY = 40; }

        doc.fontSize(10).font('Helvetica-Bold').fillColor('#EA580C')
            .text(`REORDER (${reorderItems.length} item) — Di bawah Reorder Point`, 40, currentY, { width: 760 });
        currentY += 16;

        const headers = ['No', 'Kode Item', 'Nama Barang', 'Stock', 'ROP', 'PO Out.', 'Shortage', 'Saran Order'];
        const colWidths = [25, 65, 200, 75, 65, 70, 70, 70];
        const rows = reorderItems.map((item, idx) => [
            (idx + 1).toString(),
            item.itemNo,
            item.name.length > 45 ? item.name.substring(0, 45) + '...' : item.name,
            `${formatNumber(item.stock)} ${item.unit}`,
            formatNumber(item.reorderPoint),
            item.poOutstanding > 0 ? `+${formatNumber(item.poOutstanding)}` : '-',
            formatNumber(item.netShortage),
            item.suggestedOrder > 0 ? formatNumber(item.suggestedOrder) : '-',
        ]);

        currentY = drawTable(doc, headers, rows, colWidths, 40, currentY, {
            headerBg: '#EA580C',
            headerColor: '#FFFFFF',
            rowBg: '#FFF7ED',
            rowBgAlt: '#FFEDD5',
        });
        currentY += 15;
    }

    // ── Section 3: Dead Stock (ALL items, no limit) ──
    if (deadStockItems.length > 0) {
        if (currentY > 480) { doc.addPage(); currentY = 40; }

        doc.fontSize(10).font('Helvetica-Bold').fillColor('#64748B')
            .text(`DEAD STOCK (${deadStockItems.length} item) — Tidak ada penjualan`, 40, currentY, { width: 760 });
        currentY += 16;

        const headers = ['No', 'Kode Item', 'Nama Barang', 'Stock', 'Satuan', 'Nilai Stock', 'Stock Age'];
        const colWidths = [25, 65, 210, 65, 50, 110, 60];
        const rows = deadStockItems.map((item, idx) => [
            (idx + 1).toString(),
            item.itemNo,
            item.name.length > 45 ? item.name.substring(0, 45) + '...' : item.name,
            formatNumber(item.stock),
            item.unit,
            `Rp ${formatNumber(item.stockValue)}`,
            `${formatNumber(item.stockAgeDays)} hr`,
        ]);

        currentY = drawTable(doc, headers, rows, colWidths, 40, currentY, {
            headerBg: '#64748B',
            headerColor: '#FFFFFF',
            rowBg: '#F8FAFC',
            rowBgAlt: '#F1F5F9',
        });

        const deadStockValue = deadStockItems.reduce((sum, i) => sum + i.stockValue, 0);
        currentY += 6;
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#333333')
            .text(`Total Nilai Dead Stock: Rp ${formatNumber(deadStockValue)}`, 40, currentY, { width: 760 });
    }

    // Footer on all pages
    addFooters(doc);

    return pdfToBuffer(doc);
}

// ─── FOOTER HELPER ───────────────────────────────────────────

function addFooters(doc: PDFKit.PDFDocument): void {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.save();
        doc.fontSize(7).font('Helvetica-Oblique').fillColor('#999999');
        doc.text(
            `Halaman ${i + 1} dari ${range.count}  —  Generated by Inventory Analysis System`,
            40, 565,
            { width: 760, align: 'center', lineBreak: false }
        );
        doc.restore();
    }
}
