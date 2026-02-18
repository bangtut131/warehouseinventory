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

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
}

// Table drawing helper
function drawTable(
    doc: PDFKit.PDFDocument,
    headers: string[],
    rows: string[][],
    colWidths: number[],
    startX: number,
    startY: number,
    options?: {
        headerBg?: [number, number, number];
        rowBg?: [number, number, number];
        criticalRowTest?: (row: string[]) => boolean;
        criticalBg?: [number, number, number];
    }
): number {
    const opts = options || {};
    const headerBg = opts.headerBg || [30, 64, 175];
    const rowBg = opts.rowBg || [255, 255, 255];
    const criticalBg = opts.criticalBg || [254, 226, 226];
    const rowHeight = 18;
    const headerHeight = 22;
    const fontSize = 7;
    const headerFontSize = 8;
    const padding = 4;
    const pageBottom = 560; // landscape A4 usable height

    let y = startY;

    // Draw header
    doc.save();
    doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), headerHeight)
        .fill(`rgb(${headerBg.join(',')})`);
    doc.fillColor('white').fontSize(headerFontSize).font('Helvetica-Bold');
    let x = startX;
    headers.forEach((h, i) => {
        doc.text(h, x + padding, y + 5, { width: colWidths[i] - padding * 2, height: headerHeight, align: 'center' });
        x += colWidths[i];
    });
    doc.restore();
    y += headerHeight;

    // Draw rows
    rows.forEach((row) => {
        // Check if we need a new page
        if (y + rowHeight > pageBottom) {
            doc.addPage();
            y = 40;
            // Re-draw header on new page
            doc.save();
            doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), headerHeight)
                .fill(`rgb(${headerBg.join(',')})`);
            doc.fillColor('white').fontSize(headerFontSize).font('Helvetica-Bold');
            let hx = startX;
            headers.forEach((h, i) => {
                doc.text(h, hx + padding, y + 5, { width: colWidths[i] - padding * 2, height: headerHeight, align: 'center' });
                hx += colWidths[i];
            });
            doc.restore();
            y += headerHeight;
        }

        const isCritical = opts.criticalRowTest ? opts.criticalRowTest(row) : false;
        const bg = isCritical ? criticalBg : rowBg;

        doc.save();
        doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight)
            .fill(`rgb(${bg.join(',')})`);

        // Draw cell borders
        doc.strokeColor('#cccccc').lineWidth(0.5);
        let bx = startX;
        colWidths.forEach((w) => {
            doc.rect(bx, y, w, rowHeight).stroke();
            bx += w;
        });

        // Draw cell text
        doc.fillColor('#333333').fontSize(fontSize).font('Helvetica');
        let cx = startX;
        row.forEach((cell, i) => {
            const align = i === 0 ? 'center' : (i >= 3 ? 'right' : 'left');
            doc.text(cell, cx + padding, y + 5, {
                width: colWidths[i] - padding * 2,
                height: rowHeight - 4,
                align,
                lineBreak: false,
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
    const reorderItems = items.filter(i => i.status === 'CRITICAL' || i.status === 'REORDER');

    const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 40 });

    // Header
    doc.fontSize(16).font('Helvetica-Bold')
        .text('LAPORAN REORDER INVENTORY', { align: 'center' });

    const subtitle = [
        `Tanggal: ${formatDate()}`,
        branchName ? `Cabang: ${branchName}` : '',
        warehouseName ? `Gudang: ${warehouseName}` : '',
    ].filter(Boolean).join('  |  ');
    doc.fontSize(10).font('Helvetica').text(subtitle, { align: 'center' });
    doc.moveDown(0.5);

    // Summary
    const criticalCount = reorderItems.filter(i => i.status === 'CRITICAL').length;
    const reorderCount = reorderItems.filter(i => i.status === 'REORDER').length;
    doc.fontSize(9).text(`Total: ${reorderItems.length} item  |  Critical: ${criticalCount}  |  Reorder: ${reorderCount}`);
    doc.moveDown(0.3);

    // Table
    const headers = ['No', 'Kode Item', 'Nama Barang', 'Satuan', 'Stock', 'ROP', 'Safety', 'PO Outst.', 'Shortage', 'Saran Order', 'Status'];
    const colWidths = [25, 60, 140, 40, 50, 50, 50, 55, 55, 60, 50];

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
        item.status,
    ]);

    const currentY = doc.y;
    drawTable(doc, headers, tableData, colWidths, 40, currentY, {
        headerBg: [30, 64, 175],
        criticalRowTest: (row) => row[10] === 'CRITICAL',
        criticalBg: [254, 226, 226],
        rowBg: [255, 255, 255],
    });

    // Footer on all pages
    const pageCount = doc.bufferedPageRange();
    for (let i = 0; i < pageCount.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).font('Helvetica-Oblique').fillColor('#888888')
            .text(
                `Halaman ${i + 1} dari ${pageCount.count}  —  Generated by Inventory Analysis System`,
                40, 560, { align: 'center', width: 760 }
            );
    }

    return pdfToBuffer(doc);
}

// ─── ALERT REPORT ────────────────────────────────────────────

export async function generateAlertReport(
    items: InventoryItem[],
    branchName?: string,
    warehouseName?: string
): Promise<Buffer> {
    const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 40 });

    // Header
    doc.fontSize(16).font('Helvetica-Bold')
        .text('LAPORAN ALERT INVENTORY', { align: 'center' });

    const subtitle = [
        `Tanggal: ${formatDate()}`,
        branchName ? `Cabang: ${branchName}` : '',
        warehouseName ? `Gudang: ${warehouseName}` : '',
    ].filter(Boolean).join('  |  ');
    doc.fontSize(10).font('Helvetica').text(subtitle, { align: 'center' });
    doc.moveDown(0.5);

    const criticalItems = items.filter(i => i.status === 'CRITICAL');
    const reorderItems = items.filter(i => i.status === 'REORDER');
    const deadStockItems = items.filter(i => i.demandCategory === 'DEAD' && i.stock > 0);

    // ── Section 1: Critical ──
    if (criticalItems.length > 0) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#DC2626')
            .text(`CRITICAL (${criticalItems.length} item) — Di bawah Safety Stock`);
        doc.fillColor('#333333');
        doc.moveDown(0.2);

        const headers = ['No', 'Kode Item', 'Nama Barang', 'Stock', 'Safety Stock', 'PO Outst.', 'Shortage', 'Status'];
        const colWidths = [25, 65, 180, 70, 70, 70, 70, 60];
        const rows = criticalItems.map((item, idx) => [
            (idx + 1).toString(),
            item.itemNo,
            item.name.length > 40 ? item.name.substring(0, 40) + '...' : item.name,
            `${formatNumber(item.stock)} ${item.unit}`,
            formatNumber(item.safetyStock),
            item.poOutstanding > 0 ? `+${formatNumber(item.poOutstanding)}` : '-',
            formatNumber(item.netShortage),
            'CRITICAL',
        ]);

        const endY = drawTable(doc, headers, rows, colWidths, 40, doc.y, {
            headerBg: [220, 38, 38],
            rowBg: [254, 226, 226],
        });
        doc.y = endY + 15;
    }

    // ── Section 2: Reorder ──
    if (reorderItems.length > 0) {
        if (doc.y > 480) { doc.addPage(); doc.y = 40; }

        doc.fontSize(11).font('Helvetica-Bold').fillColor('#EA580C')
            .text(`REORDER (${reorderItems.length} item) — Di bawah Reorder Point`);
        doc.fillColor('#333333');
        doc.moveDown(0.2);

        const headers = ['No', 'Kode Item', 'Nama Barang', 'Stock', 'ROP', 'PO Outst.', 'Shortage', 'Saran Order'];
        const colWidths = [25, 65, 180, 70, 60, 70, 70, 70];
        const rows = reorderItems.map((item, idx) => [
            (idx + 1).toString(),
            item.itemNo,
            item.name.length > 40 ? item.name.substring(0, 40) + '...' : item.name,
            `${formatNumber(item.stock)} ${item.unit}`,
            formatNumber(item.reorderPoint),
            item.poOutstanding > 0 ? `+${formatNumber(item.poOutstanding)}` : '-',
            formatNumber(item.netShortage),
            item.suggestedOrder > 0 ? formatNumber(item.suggestedOrder) : '-',
        ]);

        const endY = drawTable(doc, headers, rows, colWidths, 40, doc.y, {
            headerBg: [234, 88, 12],
            rowBg: [255, 237, 213],
        });
        doc.y = endY + 15;
    }

    // ── Section 3: Dead Stock ──
    if (deadStockItems.length > 0) {
        if (doc.y > 480) { doc.addPage(); doc.y = 40; }

        doc.fontSize(11).font('Helvetica-Bold').fillColor('#64748B')
            .text(`DEAD STOCK (${deadStockItems.length} item) — Tidak ada penjualan`);
        doc.fillColor('#333333');
        doc.moveDown(0.2);

        const headers = ['No', 'Kode Item', 'Nama Barang', 'Stock', 'Satuan', 'Nilai Stock', 'Stock Age'];
        const colWidths = [25, 65, 190, 60, 50, 100, 60];
        const rows = deadStockItems.slice(0, 50).map((item, idx) => [
            (idx + 1).toString(),
            item.itemNo,
            item.name.length > 40 ? item.name.substring(0, 40) + '...' : item.name,
            formatNumber(item.stock),
            item.unit,
            `Rp ${formatNumber(item.stockValue)}`,
            `${formatNumber(item.stockAgeDays)} hr`,
        ]);

        const endY = drawTable(doc, headers, rows, colWidths, 40, doc.y, {
            headerBg: [100, 116, 139],
            rowBg: [241, 245, 249],
        });

        const deadStockValue = deadStockItems.reduce((sum, i) => sum + i.stockValue, 0);
        doc.y = endY + 5;
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#333333')
            .text(`Total Nilai Dead Stock: Rp ${formatNumber(deadStockValue)}`);
    }

    // Footer on all pages
    const pageCount = doc.bufferedPageRange();
    for (let i = 0; i < pageCount.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).font('Helvetica-Oblique').fillColor('#888888')
            .text(
                `Halaman ${i + 1} dari ${pageCount.count}  —  Generated by Inventory Analysis System`,
                40, 560, { align: 'center', width: 760 }
            );
    }

    return pdfToBuffer(doc);
}
