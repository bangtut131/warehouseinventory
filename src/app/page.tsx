import InventoryDashboard from '@/components/dashboard/InventoryDashboard';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div className="z-10 max-w-7xl w-full items-center justify-between font-mono text-sm lg:flex-col">
        <InventoryDashboard />
      </div>
    </main>
  );
}
