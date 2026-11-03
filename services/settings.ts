// =============================================================================
// ÜberDoodle settings store.
//
// Persistence model (survives closing the browser / restarting the app):
//  - Browser-side values (Gemini / LMNT / ElevenLabs keys, provider choices,
//    local LLM URLs + models, Kie model ids) live in localStorage.
//  - Proxy-side secrets (Kie key, GenAiPro JWT) are POSTed to the local
//    cors-proxy, which writes them to `.uberdoodle-secrets.json` (gitignored,
//    chmod 600). They are never stored in the browser.
//  - Vite env vars (.env.local) remain as fallbacks for every field.
// =============================================================================

const ENV: Record<string, string | undefined> = ((import.meta as any).env || {}) as Record<string, string | undefined>;
const STORAGE_KEY = 'uberdoodle.settings.v1';

export type TextProvider = 'gemini' | 'lmstudio' | 'unsloth';
export type ImageProvider = 'gemini' | 'kie';
export type VideoProvider = 'gemini' | 'kie';

export interface AppSettings {
    geminiApiKey: string;
    lmntApiKey: string;
    elevenLabsApiKey: string;

    textProvider: TextProvider;
    imageProvider: ImageProvider;
    videoProvider: VideoProvider;

    /** LM Studio local server (OpenAI-compatible). Default port 1234. */
    lmStudioUrl: string;
    lmStudioModel: string;
    /** Unsloth-served model (OpenAI-compatible: Unsloth Studio, llama.cpp llama-server, or vLLM). */
    unslothUrl: string;
    unslothModel: string;
    /** Optional bearer for the local server (vLLM --api-key, etc.). */
    localLlmApiKey: string;

    /** Kie model ids (Market API for images, Veo endpoint for video). */
    kieImageModel: string;
    kieVideoModel: string;

    /** Base URL of the local cors-proxy (holds Kie / GenAiPro keys server-side). */
    proxyUrl: string;
}

const env = (k: string, fb = ''): string => {
    const v = ENV[k];
    return typeof v === 'string' && v.trim() ? v.trim() : fb;
};

export const DEFAULT_SETTINGS: AppSettings = {
    geminiApiKey: '',
    lmntApiKey: env('VITE_LMNT_API_KEY'),
    elevenLabsApiKey: env('VITE_ELEVENLABS_API_KEY'),
    textProvider: (env('VITE_TEXT_PROVIDER', 'gemini') as TextProvider),
    imageProvider: (env('VITE_IMAGE_PROVIDER', 'gemini') as ImageProvider),
    videoProvider: (env('VITE_VIDEO_PROVIDER', 'gemini') as VideoProvider),
    lmStudioUrl: env('VITE_LMSTUDIO_URL', 'http://localhost:1234/v1'),
    lmStudioModel: env('VITE_LMSTUDIO_MODEL'),
    unslothUrl: env('VITE_UNSLOTH_URL', 'http://localhost:8080/v1'),
    unslothModel: env('VITE_UNSLOTH_MODEL'),
    localLlmApiKey: '',
    kieImageModel: env('VITE_KIE_IMAGE_MODEL', 'nano-banana-pro'),
    kieVideoModel: env('VITE_KIE_VIDEO_MODEL', 'veo3_fast'),
    proxyUrl: env('VITE_TTS_PROXY_URL', 'http://localhost:3002/proxy'),
};

const readStorage = (): Partial<AppSettings> => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    } catch {
        return {};
    }
};

let current: AppSettings = { ...DEFAULT_SETTINGS, ...readStorage() };
const listeners = new Set<(s: AppSettings) => void>();

export const getSettings = (): AppSettings => current;

export const saveSettings = (patch: Partial<AppSettings>): AppSettings => {
    current = { ...current, ...patch };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
        // Private mode / storage blocked: keep in memory for this session.
    }
    listeners.forEach(l => l(current));
    return current;
};

export const subscribeSettings = (fn: (s: AppSettings) => void): (() => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};

/** Gemini key: Settings first, then the build-time env key. */
export const getGeminiKey = (): string =>
    current.geminiApiKey.trim() || ((process.env.API_KEY || process.env.GEMINI_API_KEY || '') as string);

// --- Proxy-held secrets ------------------------------------------------------

export interface ProxySecretStatus {
    reachable: boolean;
    kieConfigured: boolean;
    genaiproConfigured: boolean;
}

export async function getProxySecretStatus(): Promise<ProxySecretStatus> {
    try {
        const res = await fetch(`${current.proxyUrl}/settings`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return { reachable: true, kieConfigured: false, genaiproConfigured: false };
        const j = await res.json();
        return { reachable: true, kieConfigured: !!j.kieConfigured, genaiproConfigured: !!j.genaiproConfigured };
    } catch {
        return { reachable: false, kieConfigured: false, genaiproConfigured: false };
    }
}

/** Send secrets to the local proxy, which persists them to disk. Empty string clears a key; undefined leaves it. */
export async function saveProxySecrets(secrets: { kieApiKey?: string; genaiproJwt?: string }): Promise<ProxySecretStatus> {
    const res = await fetch(`${current.proxyUrl}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(secrets),
        signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Proxy refused settings (HTTP ${res.status}) ${msg.slice(0, 200)}`);
    }
    const j = await res.json();
    return { reachable: true, kieConfigured: !!j.kieConfigured, genaiproConfigured: !!j.genaiproConfigured };
}
