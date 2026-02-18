import axios, { AxiosInstance } from 'axios';

// ─── CONFIG ──────────────────────────────────────────────────

export interface WahaConfig {
    apiUrl: string;        // e.g. http://localhost:3000
    session: string;       // e.g. "default"
    apiKey?: string;       // optional API key
}

const DEFAULT_CONFIG: WahaConfig = {
    apiUrl: process.env.WAHA_API_URL || 'http://localhost:3000',
    session: process.env.WAHA_SESSION || 'default',
    apiKey: process.env.WAHA_API_KEY || '',
};

function createClient(config: WahaConfig): AxiosInstance {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (config.apiKey) {
        headers['X-Api-Key'] = config.apiKey;
    }
    return axios.create({
        baseURL: config.apiUrl,
        headers,
        timeout: 30000,
    });
}

// ─── PUBLIC API ──────────────────────────────────────────────

/**
 * Check if WAHA session is alive.
 */
export async function checkSession(config?: WahaConfig): Promise<{ ok: boolean; status?: string; error?: string }> {
    const cfg = config || DEFAULT_CONFIG;
    try {
        const client = createClient(cfg);
        const res = await client.get(`/api/sessions/${cfg.session}`);
        const status = res.data?.status || res.data?.engine?.state || 'unknown';
        return { ok: status === 'WORKING' || status === 'CONNECTED' || status === 'SCAN_QR_CODE', status };
    } catch (err: any) {
        return { ok: false, error: err.message };
    }
}

/**
 * Send a text message via WAHA.
 */
export async function sendTextMessage(
    chatId: string,
    text: string,
    config?: WahaConfig
): Promise<{ ok: boolean; error?: string }> {
    const cfg = config || DEFAULT_CONFIG;
    try {
        const client = createClient(cfg);
        // Ensure chatId has @c.us or @g.us suffix
        const formattedChatId = formatChatId(chatId);

        await client.post(`/api/sendText`, {
            chatId: formattedChatId,
            text,
            session: cfg.session,
        });
        return { ok: true };
    } catch (err: any) {
        console.error('[WAHA] sendText error:', err.response?.data || err.message);
        return { ok: false, error: err.response?.data?.message || err.message };
    }
}

/**
 * Send a file (e.g. PDF) via WAHA.
 */
export async function sendFileMessage(
    chatId: string,
    fileBuffer: Buffer,
    filename: string,
    caption: string,
    mimetype: string = 'application/pdf',
    config?: WahaConfig
): Promise<{ ok: boolean; error?: string }> {
    const cfg = config || DEFAULT_CONFIG;
    const formattedChatId = formatChatId(chatId);
    const base64Data = fileBuffer.toString('base64');

    console.log(`[WAHA] Sending file ${filename} (${fileBuffer.length} bytes, ${base64Data.length} base64 chars) to ${formattedChatId}`);

    // Try session-scoped first, then global endpoint — both with raw base64
    const endpoints = [
        `/api/${cfg.session}/sendFile`,
        `/api/sendFile`,
    ];

    for (let i = 0; i < endpoints.length; i++) {
        const url = endpoints[i];
        try {
            const client = createClient(cfg);
            client.defaults.timeout = 60000;

            const body: any = {
                chatId: formattedChatId,
                file: {
                    mimetype,
                    filename,
                    data: base64Data,  // Raw base64, NO data URI prefix
                },
                caption,
            };
            // Add session for global endpoint
            if (!url.includes(cfg.session)) {
                body.session = cfg.session;
            }

            console.log(`[WAHA] sendFile attempt ${i + 1}: ${url}`);
            await client.post(url, body);
            console.log(`[WAHA] sendFile attempt ${i + 1} succeeded`);
            return { ok: true };
        } catch (err: any) {
            const status = err.response?.status;
            const errData = err.response?.data;
            const errMsg = errData?.message || errData?.error || err.message;
            console.error(`[WAHA] sendFile attempt ${i + 1} failed (${status}):`, errMsg);
            if (i === endpoints.length - 1) {
                return { ok: false, error: `HTTP ${status}: ${errMsg}` };
            }
            // Only continue to next endpoint if 404/405 (wrong endpoint)
            if (status && status !== 404 && status !== 405) {
                return { ok: false, error: `HTTP ${status}: ${errMsg}` };
            }
        }
    }

    return { ok: false, error: 'All endpoints failed' };
}

// ─── HELPERS ─────────────────────────────────────────────────

/**
 * Ensure chatId ends with @c.us (personal) or @g.us (group).
 */
function formatChatId(chatId: string): string {
    chatId = chatId.trim();
    if (chatId.endsWith('@c.us') || chatId.endsWith('@g.us')) return chatId;
    // If starts with +, remove it
    if (chatId.startsWith('+')) chatId = chatId.substring(1);
    // If starts with 0, convert to 62
    if (chatId.startsWith('0')) chatId = '62' + chatId.substring(1);
    return `${chatId}@c.us`;
}
