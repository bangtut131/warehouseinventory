'use client';

import React, { createContext, useContext } from 'react';

export interface SessionContextType {
    username: string;
    fullName?: string;
    roleName: string;
    allowedMenus: string[];
    hiddenColumns: string[];
    isSuperAdmin: boolean;
}

const SessionContext = createContext<SessionContextType | null>(null);

export const SessionProvider = SessionContext.Provider;

/**
 * Hook to access current user session (role, permissions)
 */
export function useSession(): SessionContextType | null {
    return useContext(SessionContext);
}

/**
 * Hook for data masking based on role's hiddenColumns.
 * Returns helper functions to mask values.
 */
export function useMask() {
    const session = useContext(SessionContext);
    const hidden = new Set(session?.hiddenColumns || []);

    return {
        /** Check if a column key is hidden */
        isHidden: (colKey: string) => hidden.has(colKey),

        /** Mask a monetary value: show '***' if hidden */
        maskValue: (value: string | number, colKey: string) => {
            if (hidden.has(colKey)) return '***';
            return value;
        },

        /** Mask a number: return 0 if hidden (for charts/bars) */
        maskNumber: (value: number, colKey: string) => {
            if (hidden.has(colKey)) return 0;
            return value;
        },

        /** Format Rupiah with masking */
        maskRp: (value: number, colKey: string) => {
            if (hidden.has(colKey)) return '***';
            if (value >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1)}M`;
            if (value >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(1)}jt`;
            return `Rp ${value.toLocaleString('id-ID')}`;
        },

        hidden,
    };
}
