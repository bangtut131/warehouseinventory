'use client';

import { ColumnDef, Row } from "@tanstack/react-table";
import { InventoryItem } from '@/lib/types';

export const columns: ColumnDef<InventoryItem>[] = [
    {
        accessorKey: "itemNo",
        header: "Kode",
        cell: ({ row }) => <span className="font-medium text-blue-600">{row.getValue("itemNo")}</span>,
    },
    {
        accessorKey: "name",
        header: "Nama Barang",
        cell: ({ row }) => <span className="max-w-[200px] truncate block">{row.getValue("name")}</span>,
    },
    {
        accessorKey: "stock",
        header: "Stock",
        cell: ({ row }: { row: Row<InventoryItem> }) => {
            const stock = parseFloat(row.getValue("stock"));
            const item = row.original;
            let colorClass = "";
            if (item.status === 'CRITICAL') colorClass = "text-red-600 font-bold";
            else if (item.status === 'REORDER') colorClass = "text-orange-600 font-bold";
            else if (item.status === 'OVERSTOCK') colorClass = "text-blue-600";
            else colorClass = "text-green-600";
            return <div className={colorClass}>{stock} {item.unit}</div>;
        },
    },
    {
        accessorKey: "reorderPoint",
        header: "ROP",
        cell: ({ row }) => <div className="text-right">{row.getValue("reorderPoint")}</div>,
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const status = row.getValue("status") as string;
            const colorMap: Record<string, string> = {
                'CRITICAL': 'bg-red-600 text-white',
                'REORDER': 'bg-orange-500 text-white',
                'OVERSTOCK': 'bg-blue-500 text-white',
                'OK': 'bg-green-500 text-white',
            };
            return <span className={`px-2 py-0.5 rounded text-xs font-bold ${colorMap[status] || ''}`}>{status}</span>;
        },
    },
    {
        accessorKey: "demandCategory",
        header: "Demand",
        cell: ({ row }) => {
            const cat = row.getValue("demandCategory") as string;
            const colorMap: Record<string, string> = {
                'FAST': 'bg-green-100 text-green-800',
                'SLOW': 'bg-yellow-100 text-yellow-800',
                'NON-MOVING': 'bg-orange-100 text-orange-800',
                'DEAD': 'bg-red-100 text-red-800',
            };
            return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colorMap[cat] || ''}`}>{cat}</span>;
        },
    },
    {
        accessorKey: "stockValue",
        header: "Nilai Stock",
        cell: ({ row }) => {
            const value = parseFloat(row.getValue("stockValue"));
            return <div className="text-right">{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)}</div>;
        },
    },
];
