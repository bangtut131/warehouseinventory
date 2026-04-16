// Shared menu & column registry constants
// Used by both server-side (auth.ts, roles API) and client-side (GeneralSettingsView)

export interface MenuRegistryItem {
    id: string;
    label: string;
    category: string;
    icon: string;
}

export interface ColumnRegistryItem {
    id: string;
    label: string;
    description: string;
}

// All available menus for role assignment
export const ALL_MENUS: MenuRegistryItem[] = [
    { id: 'dashboard', label: 'Dashboard', category: 'Inventory', icon: '📊' },
    { id: 'rop', label: 'ROP Analysis', category: 'Inventory', icon: '🎯' },
    { id: 'abc', label: 'ABC-XYZ Matrix', category: 'Inventory', icon: '🔠' },
    { id: 'eoq', label: 'EOQ Analysis', category: 'Inventory', icon: '📦' },
    { id: 'trends', label: 'Trends', category: 'Inventory', icon: '📈' },
    { id: 'alerts', label: 'Alerts', category: 'Inventory', icon: '🚨' },
    { id: 'overstock', label: 'Overstock', category: 'Inventory', icon: '📦' },
    { id: 'top', label: 'Top Items', category: 'Inventory', icon: '🏆' },
    { id: 'so', label: 'Kontrol SO', category: 'Sales', icon: '📋' },
    { id: 'regional', label: 'Wilayah SO', category: 'Sales', icon: '📍' },
    { id: 'sla', label: 'SLA Pengiriman', category: 'Sales', icon: '🚚' },
    { id: 'price', label: 'Analisa Harga', category: 'Sales', icon: '💰' },
    { id: 'routing', label: 'Delivery Routing', category: 'Logistics', icon: '🚛' },
    { id: 'settings', label: 'Master Data', category: 'Admin', icon: '⚙️' },
    { id: 'general-settings', label: 'Settings General', category: 'Admin', icon: '🛠️' },
];

// All available data columns that can be hidden per role
export const ALL_DATA_COLUMNS: ColumnRegistryItem[] = [
    { id: 'col:value', label: 'Nilai / Total Rupiah', description: 'Kolom nilai transaksi (Rp)' },
    { id: 'col:cost', label: 'Harga Pokok / HPP', description: 'Harga beli / cost per item' },
    { id: 'col:margin', label: 'Margin / Profit', description: 'Margin keuntungan' },
    { id: 'col:price', label: 'Harga Jual', description: 'Harga jual per unit' },
    { id: 'col:customer_no', label: 'No. Customer', description: 'Nomor ID customer' },
    { id: 'col:fleet_cost', label: 'Biaya Kendaraan', description: 'Biaya per trip kendaraan' },
];

// Menu categories for grouping in the UI
export const MENU_CATEGORIES = ['Inventory', 'Sales', 'Logistics', 'Admin'] as const;
