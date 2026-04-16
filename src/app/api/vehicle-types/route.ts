export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Default vehicles to seed on first load
const DEFAULT_VEHICLES = [
    { name: 'Pickup', maxWeightKg: 1000, maxVolumeM3: 4, costPerTrip: 500000, sortOrder: 1 },
    { name: 'CDE (Engkel)', maxWeightKg: 3000, maxVolumeM3: 10, costPerTrip: 1200000, sortOrder: 2 },
    { name: 'CDD (Double)', maxWeightKg: 5000, maxVolumeM3: 16, costPerTrip: 1800000, sortOrder: 3 },
    { name: 'Fuso', maxWeightKg: 8000, maxVolumeM3: 25, costPerTrip: 2500000, sortOrder: 4 },
    { name: 'Tronton', maxWeightKg: 15000, maxVolumeM3: 40, costPerTrip: 4000000, sortOrder: 5 },
];

// ─── GET: List all vehicle types ────────────────────────────

export async function GET() {
    try {
        let vehicles = await prisma.vehicleType.findMany({
            orderBy: { sortOrder: 'asc' },
        });

        // Auto-seed defaults if empty
        if (vehicles.length === 0) {
            await prisma.vehicleType.createMany({ data: DEFAULT_VEHICLES });
            vehicles = await prisma.vehicleType.findMany({
                orderBy: { sortOrder: 'asc' },
            });
        }

        return NextResponse.json({ vehicles });
    } catch (err: any) {
        console.warn('[VehicleTypes] DB error, returning defaults:', err.message);
        // Fallback to defaults if DB is unavailable
        return NextResponse.json({
            vehicles: DEFAULT_VEHICLES.map((v, i) => ({ id: i + 1, ...v, isActive: true })),
            fallback: true,
        });
    }
}

// ─── POST: Create a new vehicle type ────────────────────────

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { name, maxWeightKg, maxVolumeM3, costPerTrip, sortOrder } = body;

        if (!name || !maxWeightKg || !maxVolumeM3) {
            return NextResponse.json({ error: 'Nama, berat maks, dan volume maks wajib diisi' }, { status: 400 });
        }

        const vehicle = await prisma.vehicleType.create({
            data: {
                name: name.trim(),
                maxWeightKg: parseFloat(maxWeightKg),
                maxVolumeM3: parseFloat(maxVolumeM3),
                costPerTrip: costPerTrip ? parseFloat(costPerTrip) : null,
                sortOrder: sortOrder || 0,
            },
        });

        return NextResponse.json({ vehicle, message: `Kendaraan "${vehicle.name}" berhasil ditambahkan` });
    } catch (err: any) {
        if (err.code === 'P2002') {
            return NextResponse.json({ error: 'Nama kendaraan sudah ada' }, { status: 409 });
        }
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ─── PUT: Update a vehicle type ─────────────────────────────

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, name, maxWeightKg, maxVolumeM3, costPerTrip, sortOrder, isActive } = body;

        if (!id) {
            return NextResponse.json({ error: 'ID kendaraan wajib' }, { status: 400 });
        }

        const vehicle = await prisma.vehicleType.update({
            where: { id: parseInt(id) },
            data: {
                ...(name !== undefined && { name: name.trim() }),
                ...(maxWeightKg !== undefined && { maxWeightKg: parseFloat(maxWeightKg) }),
                ...(maxVolumeM3 !== undefined && { maxVolumeM3: parseFloat(maxVolumeM3) }),
                ...(costPerTrip !== undefined && { costPerTrip: costPerTrip ? parseFloat(costPerTrip) : null }),
                ...(sortOrder !== undefined && { sortOrder: parseInt(sortOrder) }),
                ...(isActive !== undefined && { isActive }),
            },
        });

        return NextResponse.json({ vehicle, message: `Kendaraan "${vehicle.name}" berhasil diupdate` });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ─── DELETE: Remove a vehicle type ──────────────────────────

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID wajib' }, { status: 400 });
        }

        await prisma.vehicleType.delete({ where: { id: parseInt(id) } });

        return NextResponse.json({ message: 'Kendaraan berhasil dihapus' });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
