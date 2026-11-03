// =============================================================================
// Local LLM client for LM Studio and Unsloth-served models.
//
// Both speak the OpenAI-compatible API:
//   LM Studio : Developer tab → Start Server (default http://localhost:1234/v1).
//               Enable "CORS" in the server settings so the browser can call it.
//   Unsloth   : serve your fine-tuned/GGUF model with Unsloth Studio,
//               llama.cpp `llama-server` (default :8080) or `vllm serve` (:8000,
//               conflicts with the Python backend — pick another port).
//               Start with CORS allowed (llama-server allows by default;
//               vLLM: --allowed-origins '["http://localhost:5173"]').
// =============================================================================
import { getSettings, TextProvider } from './settings';

export class LocalLlmError extends Error {
    constructor(message: string) { super(message); this.name = 'LocalLlmError'; }
}

export interface LocalServer { label: string; baseUrl: string; model: string; apiKey?: string }

export const getLocalServer = (provider: TextProvider): LocalServer | null => {
    const s = getSettings();
    if (provider === 'lmstudio') return { label: 'LM Studio', baseUrl: s.lmStudioUrl, model: s.lmStudioModel, apiKey: s.localLlmApiKey };
    if (provider === 'unsloth') return { label: 'Unsloth', baseUrl: s.unslothUrl, model: s.unslothModel, apiKey: s.localLlmApiKey };
    return null;
};

const headers = (server: LocalServer): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(server.apiKey ? { Authorization: `Bearer ${server.apiKey}` } : {}),
});
const base = (u: string) => u.replace(/\/+$/, '');

/** List models loaded on the server (GET /v1/models). */
export async function listLocalModels(server: LocalServer): Promise<string[]> {
    try {
        const res = await fetch(`${base(server.baseUrl)}/models`, { headers: headers(server), signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        return (j?.data || []).map((m: any) => String(m.id)).filter(Boolean);
    } catch (e) {
        throw new LocalLlmError(`${server.label} not reachable at ${server.baseUrl} — is the server running with CORS enabled? (${(e as Error).message})`);
    }
}

export interface LocalChatOptions { system?: string; json?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number }

/** Strip <think>…</think> reasoning blocks that local reasoning models emit. */
const stripThinking = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

export async function localChat(server: LocalServer, prompt: string, opts: LocalChatOptions = {}): Promise<string> {
    let model = server.model;
    if (!model) {
        const models = await listLocalModels(server);
        if (!models.length) throw new LocalLlmError(`${server.label}: no model loaded`);
        model = models[0];
    }
    const system = [opts.system, opts.json ? 'Respond with valid JSON only. No markdown fences, no commentary.' : '']
        .filter(Boolean).join('\n');
    const body: Record<string, unknown> = {
        model,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
        temperature: opts.temperature ?? 0.7,
        stream: false,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    };
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(`${base(server.baseUrl)}/chat/completions`, {
                method: 'POST', headers: headers(server), body: JSON.stringify(body),
                signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000), // local models can be slow
            });
            if (!res.ok) {
                const t = await res.text().catch(() => '');
                throw new LocalLlmError(`${server.label} HTTP ${res.status}: ${t.slice(0, 200)}`);
            }
            const j = await res.json();
            const text = j?.choices?.[0]?.message?.content;
            if (typeof text !== 'string') throw new LocalLlmError(`${server.label}: empty response`);
            return stripThinking(text);
        } catch (e) {
            lastErr = e instanceof TypeError
                ? new LocalLlmError(`${server.label} not reachable at ${server.baseUrl} — start the server and enable CORS`)
                : e;
            if (e instanceof LocalLlmError && /HTTP 4\d\d/.test(e.message)) break;
        }
    }
    throw lastErr instanceof Error ? lastErr : new LocalLlmError(`${server.label}: request failed`);
}
