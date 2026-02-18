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
    try {
        const client = createClient(cfg);
        // Override timeout for file uploads
        client.defaults.timeout = 60000;
        const formattedChatId = formatChatId(chatId);
        const base64 = fileBuffer.toString('base64');
        const dataUri = `data:${mimetype};base64,${base64}`;

        console.log(`[WAHA] Sending file ${filename} (${fileBuffer.length} bytes) to ${formattedChatId}`);

        await client.post(`/api/sendFile`, {
            chatId: formattedChatId,
            file: {
                mimetype,
                filename,
                data: dataUri,
            },
            caption,
            session: cfg.session,
        });
        return { ok: true };
    } catch (err: any) {
        console.error('[WAHA] sendFile error:', err.response?.status, err.response?.data || err.message);
        return { ok: false, error: err.response?.data?.message || err.message };
    }
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
