import { NextResponse } from 'next/server';
import { generateMockInventory } from '@/lib/mock-inventory';

// Cache the mock data so it doesn't regenerate on every request (simulating a database)
let cachedInventory = generateMockInventory(415);

export async function GET() {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));

    return NextResponse.json({
        s: true,
        d: cachedInventory
    });
}
