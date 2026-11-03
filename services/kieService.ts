// =============================================================================
// Kie.ai client: Nano Banana images (Market API) + Veo 3 video.
// All calls go through the local cors-proxy, which injects KIE_API_KEY, so the
// key never reaches the browser.
//
// Endpoints (see https://docs.kie.ai; verify against your own API notes):
//   Market: POST /api/v1/jobs/createTask  ·  GET /api/v1/jobs/recordInfo?taskId=
//   Veo 3 : POST /api/v1/veo/generate     ·  GET /api/v1/veo/record-info?taskId=
// =============================================================================
import { getSettings } from './settings';

export class KieError extends Error {
    constructor(message: string, readonly status?: number) { super(message); this.name = 'KieError'; }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const proxy = () => getSettings().proxyUrl.replace(/\/$/, '');

async function kieFetch(path: string, init: RequestInit = {}, timeoutMs = 30_000, retries = 3): Promise<any> {
    let lastErr: KieError = new KieError('Kie: request failed');
    for (let attempt = 0; attempt <= retries; attempt++) {
        let res: Response;
        try {
            res = await fetch(`${proxy()}/kie${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        } catch (e) {
            lastErr = (e as Error)?.name === 'TimeoutError'
                ? new KieError('Kie: request timed out')
                : new KieError('Kie: local proxy not reachable — run `npm run proxy`');
            if (attempt < retries) { await sleep(backoff(attempt)); continue; }
            throw lastErr;
        }
        const body = await res.json().catch(() => ({}));
        // Kie can answer HTTP 200 with an inner error `code`; check both layers.
        const code = Number(body?.code ?? res.status);
        if (res.ok && (!body?.code || code === 200)) return body;
        const msg = body?.msg || body?.error || `HTTP ${res.status}`;
        if (code === 401 || res.status === 401) throw new KieError(`Kie auth failed — add your Kie API key in Settings (${msg})`, 401);
        if (code === 402) throw new KieError(`Kie: insufficient credits (${msg})`, 402);
        if (res.status === 503) throw new KieError(`Kie: ${msg}`, 503); // proxy: key not configured
        lastErr = new KieError(`Kie: ${msg}`, code);
        const retryable = code === 429 || code >= 500 || res.status === 429 || res.status >= 500;
        if (!retryable || attempt === retries) throw lastErr;
        await sleep(backoff(attempt));
    }
    throw lastErr;
}

const backoff = (attempt: number) => Math.min(10_000, 1000 * 2 ** attempt) + Math.random() * 400;

const postJson = (path: string, body: unknown) =>
    kieFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Poll with backoff (5s → 15s) until done; returns result URLs. */
async function poll(check: () => Promise<{ done: boolean; urls?: string[]; error?: string }>, label: string, maxMs: number): Promise<string[]> {
    const deadline = Date.now() + maxMs;
    let delay = 5000;
    while (Date.now() < deadline) {
        await sleep(delay);
        const r = await check();
        if (r.error) throw new KieError(`${label} failed: ${r.error}`);
        if (r.done) {
            if (!r.urls?.length) throw new KieError(`${label}: finished without a result URL`);
            return r.urls;
        }
        delay = Math.min(15_000, delay + 2500);
    }
    throw new KieError(`${label}: timed out after ${Math.round(maxMs / 60000)} min`);
}

/** Download a Kie result URL through the proxy and return a data URL (keeps exports offline-safe; Kie deletes files after ~14 days). */
export async function kieUrlToDataUrl(url: string): Promise<string> {
    const res = await fetch(`${proxy()}/kie-file?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new KieError(`Kie download failed (HTTP ${res.status})`, res.status);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onloadend = () => resolve(fr.result as string);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
    });
}

/** Upload a data URL so Kie models can use it as an input image / first frame. Returns a hosted https URL. */
export async function kieUploadDataUrl(dataUrl: string, fileName = `frame-${Date.now()}.png`): Promise<string> {
    if (/^https?:\/\//i.test(dataUrl)) return dataUrl;
    const res = await fetch(`${proxy()}/kie-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data: dataUrl, uploadPath: 'uberdoodle', fileName }),
        signal: AbortSignal.timeout(120_000),
    });
    const j = await res.json().catch(() => ({}));
    const url = j?.data?.downloadUrl || j?.data?.fileUrl || j?.data?.url;
    if (!res.ok || !url) throw new KieError(`Kie upload failed: ${j?.msg || `HTTP ${res.status}`}`, res.status);
    return url;
}

// --- Nano Banana (images) ----------------------------------------------------

export interface KieImageOptions {
    model?: string;            // nano-banana-pro | nano-banana-2 | ...
    aspectRatio?: string;      // '3:2' | '2:3' | '16:9' | ...
    resolution?: '1K' | '2K' | '4K';
    imageInputs?: string[];    // data URLs or https URLs (edit / reference)
}

/** Generate one image with a Kie Nano Banana model; returns a data URL. */
export async function kieGenerateImage(prompt: string, opts: KieImageOptions = {}): Promise<string> {
    const model = opts.model || getSettings().kieImageModel || 'nano-banana-pro';
    const image_input = await Promise.all((opts.imageInputs || []).map(i => kieUploadDataUrl(i)));
    const created = await postJson('/api/v1/jobs/createTask', {
        model,
        input: {
            prompt,
            image_input,
            aspect_ratio: opts.aspectRatio || '3:2',
            resolution: opts.resolution || '2K',
            output_format: 'png',
        },
    });
    const taskId = created?.data?.taskId;
    if (!taskId) throw new KieError('Kie image: no taskId returned');

    const urls = await poll(async () => {
        const r = await kieFetch(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
        const d = r?.data || {};
        if (d.state === 'fail') return { done: true, error: d.failMsg || d.failCode || 'unknown error' };
        if (d.state !== 'success') return { done: false };
        let parsed: any = {};
        try { parsed = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson || {}; } catch { /* handled below */ }
        return { done: true, urls: parsed.resultUrls };
    }, `Kie ${model}`, 15 * 60_000);
    return kieUrlToDataUrl(urls[0]);
}

// --- Veo 3 (video) -----------------------------------------------------------

export interface KieVeoOptions {
    model?: string;               // veo3 | veo3_fast
    aspectRatio?: '16:9' | '9:16';
    imageUrl?: string;            // first frame: data URL or https URL
}

/** Generate a Veo 3 clip on Kie; returns a data URL of the MP4. */
export async function kieGenerateVeo(prompt: string, opts: KieVeoOptions = {}): Promise<string> {
    const model = opts.model || getSettings().kieVideoModel || 'veo3_fast';
    const imageUrls = opts.imageUrl ? [await kieUploadDataUrl(opts.imageUrl)] : undefined;
    const created = await postJson('/api/v1/veo/generate', {
        prompt,
        model,
        aspectRatio: opts.aspectRatio || '16:9',
        ...(imageUrls ? { imageUrls } : {}),
    });
    const taskId = created?.data?.taskId;
    if (!taskId) throw new KieError('Kie Veo: no taskId returned');

    const urls = await poll(async () => {
        const r = await kieFetch(`/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`);
        const d = r?.data || {};
        // successFlag: 0 generating, 1 success, 2/3 failed
        const flag = Number(d.successFlag);
        if (flag === 2 || flag === 3) return { done: true, error: d.errorMessage || d.msg || 'generation failed' };
        if (flag !== 1) return { done: false };
        const resp = d.response || {};
        let list = resp.resultUrls || d.resultUrls;
        if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = [list]; } }
        return { done: true, urls: list };
    }, `Kie ${model}`, 20 * 60_000);
    return kieUrlToDataUrl(urls[0]);
}
