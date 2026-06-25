import InventoryDashboard from '@/components/dashboard/InventoryDashboard';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-3 sm:p-6 lg:p-12">
      <div className="z-10 max-w-7xl w-full font-mono text-sm">
        <InventoryDashboard />
      </div>
    </main>
  );
}
