import { GoogleGenAI, Type, Modality, ApiError } from "@google/genai";
import { Scene, VeoModel, TitleGenerationResult, DescriptionGenerationResult, ArtStyle, BrushStyle, AspectRatio, GenAiProConfig, ThumbnailStyle } from "../types";
import { generateLabsSpeech } from "./genAiProService";
import { buildGolpoImagePrompt } from "./golpoStyle";

// =============================================================================
// MODEL CONFIG (single source of truth). Override any entry via Vite env vars.
// =============================================================================
const ENV: Record<string, string | undefined> = ((import.meta as any).env || {}) as Record<string, string | undefined>;
const envOr = (key: string, fallback: string): string => {
    const v = ENV[key];
    return typeof v === 'string' && v.trim() ? v.trim() : fallback;
};

export const GEMINI_MODELS = {
    /** Long-form reasoning / script writing. */
    text: envOr('VITE_GEMINI_TEXT_MODEL', 'gemini-3-pro-preview'),
    /** Fast structured tasks: parsing, titles, translation, transcription. */
    textFast: envOr('VITE_GEMINI_TEXT_FAST_MODEL', 'gemini-3-flash-preview'),
    /** Doodle scene images, edits and thumbnails (best text-label rendering). */
    image: envOr('VITE_GEMINI_IMAGE_MODEL', 'gemini-3-pro-image-preview'),
    /** Narration TTS. */
    tts: envOr('VITE_GEMINI_TTS_MODEL', 'gemini-2.5-flash-preview-tts'),
} as const;

/** Golpo frames are 3:2 landscape; portrait projects get 2:3. */
export const DOODLE_IMAGE_ASPECT = (aspectRatio?: AspectRatio | string): '3:2' | '2:3' =>
    aspectRatio === '9:16' || aspectRatio === '2:3' ? '2:3' : '3:2';

const getApiKey = (): string => (process.env.API_KEY || process.env.GEMINI_API_KEY || '') as string;
let _ai: GoogleGenAI | null = null;
const getAi = (): GoogleGenAI => {
    if (!_ai) {
        const apiKey = getApiKey();
        if (!apiKey) throw new GeminiServiceError('auth', 'Gemini API key is missing. Set GEMINI_API_KEY in .env.local.');
        _ai = new GoogleGenAI({ apiKey });
    }
    return _ai;
};

// =============================================================================
// ERRORS + RETRY
// =============================================================================
export type GeminiErrorKind = 'auth' | 'rate_limit' | 'server' | 'timeout' | 'bad_request' | 'safety' | 'invalid_response' | 'aborted' | 'unknown';

/** Strip anything that looks like a credential from text before logging/throwing. */
export const redactSecrets = (text: string): string =>
    String(text)
        .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[REDACTED]')
        .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[REDACTED]');

export class GeminiServiceError extends Error {
    readonly kind: GeminiErrorKind;
    readonly status?: number;
    readonly retryable: boolean;
    constructor(kind: GeminiErrorKind, message: string, status?: number) {
        super(redactSecrets(message));
        this.name = 'GeminiServiceError';
        this.kind = kind;
        this.status = status;
        this.retryable = kind === 'rate_limit' || kind === 'server' || kind === 'timeout';
    }
}

const toServiceError = (e: unknown, label: string): GeminiServiceError => {
    if (e instanceof GeminiServiceError) return e;
    const anyE = e as any;
    const status: number | undefined = e instanceof ApiError ? e.status : (typeof anyE?.status === 'number' ? anyE.status : undefined);
    const msg = `${label}: ${anyE?.message || String(e)}`;
    if (anyE?.name === 'AbortError') return new GeminiServiceError('timeout', `${label}: request timed out`);
    if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return new GeminiServiceError('rate_limit', msg, status ?? 429);
    if (status === 401 || status === 403) return new GeminiServiceError('auth', msg, status);
    if (status !== undefined && status >= 500) return new GeminiServiceError('server', msg, status);
    if (status !== undefined && status >= 400) return new GeminiServiceError('bad_request', msg, status);
    if (/fetch failed|network|ECONNRESET|Failed to fetch/i.test(msg)) return new GeminiServiceError('server', msg);
    return new GeminiServiceError('unknown', msg, status);
};

export interface RetryOptions { retries?: number; timeoutMs?: number; baseDelayMs?: number; maxDelayMs?: number; label?: string; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Runs `fn` with a per-attempt AbortController timeout and retries on 429/5xx/timeouts
 * using exponential backoff with full jitter.
 */
export async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
    const { retries = 3, timeoutMs = 60_000, baseDelayMs = 1000, maxDelayMs = 20_000, label = 'Gemini request' } = opts;
    let lastErr: GeminiServiceError | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        try {
            const result = await Promise.race([
                fn(controller.signal),
                new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () =>
                    reject(new GeminiServiceError('timeout', `${label}: timed out after ${Math.round(timeoutMs / 1000)}s`)))),
            ]);
            return result;
        } catch (e) {
            lastErr = timedOut ? new GeminiServiceError('timeout', `${label}: timed out after ${Math.round(timeoutMs / 1000)}s`) : toServiceError(e, label);
            if (!lastErr.retryable || attempt === retries) break;
            const delay = Math.random() * Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
            console.warn(`[Gemini] ${label} failed (${lastErr.kind}${lastErr.status ? ' ' + lastErr.status : ''}); retry ${attempt + 1}/${retries} in ${Math.round(delay)}ms`);
            await sleep(delay);
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastErr ?? new GeminiServiceError('unknown', `${label}: failed`);
}

type GenParams = Parameters<GoogleGenAI['models']['generateContent']>[0];
/** generateContent wrapped in retry + timeout. */
const generate = (params: GenParams, opts: RetryOptions = {}) =>
    withRetry(signal => getAi().models.generateContent({ ...params, config: { ...(params.config || {}), abortSignal: signal } }), opts);

const TEXT_TIMEOUT = 90_000;
const IMAGE_TIMEOUT = 120_000;

// =============================================================================
// HELPERS
// =============================================================================
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

/** Split a data URL (or raw base64) into mime + data. */
const parseDataUrl = (input: string, fallbackMime = 'image/png'): { mimeType: string; data: string } => {
    const m = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s.exec(input || '');
    if (m) return { mimeType: m[1], data: m[2] };
    return { mimeType: fallbackMime, data: input || '' };
};

const safeJson = <T>(text: string | undefined, label: string): T => {
    try {
        return JSON.parse(extractJson(text || '')) as T;
    } catch {
        throw new GeminiServiceError('invalid_response', `${label}: model returned invalid JSON`);
    }
};

const firstImage = (response: any, label: string): string => {
    const candidate = response?.candidates?.[0];
    for (const part of candidate?.content?.parts || []) {
        if (part.inlineData?.data) {
            return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        }
    }
    const reason = candidate?.finishReason || response?.promptFeedback?.blockReason;
    if (reason && /SAFETY|BLOCK|PROHIBITED|RECITATION/i.test(String(reason))) {
        throw new GeminiServiceError('safety', `${label}: blocked by safety filter (${reason})`);
    }
    throw new GeminiServiceError('invalid_response', `${label}: no image returned${reason ? ` (${reason})` : ''}`);
};

function decodeBase64(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return btoa(binary);
}

// WAV header for 16-bit mono PCM from Gemini TTS
function addWavHeader(pcmData: Uint8Array, sampleRate: number): Uint8Array {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + pcmData.length, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, pcmData.length, true);
    const result = new Uint8Array(44 + pcmData.length);
    result.set(new Uint8Array(header));
    result.set(pcmData, 44);
    return result;
}

// =============================================================================
// CHARACTER LOCK (shared across all scene frames)
// =============================================================================
let currentCharacterLock: string | undefined;
/** Set a project-wide character description reused verbatim in every frame prompt. */
export const setCharacterLock = (description?: string) => { currentCharacterLock = description?.trim() || undefined; };
export const getCharacterLock = () => currentCharacterLock;

// 1. Generate Script
export const generateScript = async (topic: string, niche: string, targetDuration: number, totalDurationMinutes: number, scriptLanguage: string = 'English (US)'): Promise<string> => {
    const response = await generate({
        model: GEMINI_MODELS.text,
        contents: `Write a narrated whiteboard-doodle explainer script about "${topic}" in the "${niche}" niche.
        Total Video Length: ${totalDurationMinutes} minutes.
        Scene Pacing: about ${targetDuration} seconds of narration per scene.
        Language: ${scriptLanguage}.

        Format the output as a continuous script with a [SCENE] header before each scene.
        Each scene carries exactly ONE idea, spoken in 1-3 short, conversational sentences.
        Open with a strong hook, build curiosity, and land a clear payoff. Write narration only (no stage directions).`
    }, { timeoutMs: 180_000, label: 'Script generation' });
    return response.text || '';
};

// 2. Parse Script -> Golpo-paced scenes
interface RawScene { number?: number; script?: string; visualDescription?: string; visualKeywords?: string; labels?: string[]; }

export const parseScriptToScenes = async (script: string): Promise<Scene[]> => {
    const MAX_CHARS = 30000;
    const truncated = script.length > MAX_CHARS;
    const response = await generate({
        model: GEMINI_MODELS.textFast,
        contents: `You are a storyboard director for hand-drawn whiteboard doodle explainer videos (Golpo AI style).
Break the script below into scenes and return a JSON array.

PACING RULES:
- ONE idea per scene. Split long paragraphs; never merge two ideas.
- "script" is the exact narration chunk, copied verbatim from the script in order (no paraphrasing, no omissions), 1-2 short sentences, roughly 8-25 words (about 3-8 seconds spoken).
- Remove [SCENE] headers and stage directions from narration.

VISUAL RULES ("visualDescription"):
- Describe a SPARSE doodle frame: 1-3 key elements only, drawn as simple black line art on a plain white canvas with lots of empty space.
- Be explicit and concrete: name each element, its position (left / center / right), and any simple action or arrow connecting them.
- Recurring characters must be described identically every time they appear.
- No photorealism, no backgrounds, no scenery fills, no camera jargon.

"labels": 0-3 very short hand-lettered text labels (1-3 words each, spelled correctly) that appear in the drawing.
"visualKeywords": comma-separated keywords for the frame.

${truncated ? 'NOTE: the script was truncated; stop at the last complete sentence.\n' : ''}SCRIPT:
${script.substring(0, MAX_CHARS)}`,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        number: { type: Type.INTEGER },
                        script: { type: Type.STRING },
                        visualDescription: { type: Type.STRING },
                        labels: { type: Type.ARRAY, items: { type: Type.STRING } },
                        visualKeywords: { type: Type.STRING }
                    },
                    required: ['script', 'visualDescription'],
                    propertyOrdering: ['number', 'script', 'visualDescription', 'labels', 'visualKeywords']
                }
            }
        }
    }, { timeoutMs: 180_000, label: 'Scene breakdown' });

    const raw = safeJson<RawScene[]>(response.text, 'Scene breakdown');
    if (!Array.isArray(raw)) throw new GeminiServiceError('invalid_response', 'Scene breakdown: expected a JSON array');
    const stamp = Date.now();
    return raw
        .filter(s => s && typeof s.script === 'string' && s.script.trim())
        .map((s, idx) => {
            const labels = (s.labels || []).map(l => String(l).trim()).filter(Boolean).slice(0, 3);
            const kw = [s.visualKeywords, ...labels.map(l => `label:"${l}"`)].filter(Boolean).join(', ');
            return {
                number: idx + 1,
                script: s.script!.trim(),
                visualDescription: (s.visualDescription || '').trim() + (labels.length ? ` Text labels: ${labels.map(l => `"${l}"`).join(', ')}.` : ''),
                visualKeywords: kw,
                id: `scene-${stamp}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
                type: 'standard' as const,
                isGenerating: false
            } as Scene;
        });
};

// 3. Analyze Image Style
export const analyzeImageStyle = async (imageBase64: string): Promise<string> => {
    const img = parseDataUrl(imageBase64);
    const response = await generate({
        model: GEMINI_MODELS.textFast,
        contents: {
            parts: [
                { inlineData: img },
                { text: "Analyze the art style of this image. Describe it in a detailed prompt suitable for generating similar images." }
            ]
        }
    }, { timeoutMs: TEXT_TIMEOUT, label: 'Style analysis' });
    return response.text || '';
};

// Fix: Added generateViralHooks function (richer niche-aware prompts merged from candidate)
export const generateViralHooks = async (niche: string, language: string = 'English (US)'): Promise<string[]> => {
    let instructions = `Generate 5 highly viral, unique video hooks for the "${niche}" niche.`;
    if (language !== 'English (US)') {
        instructions += `\nOUTPUT LANGUAGE: ${language}. Translate the hooks into ${language}.`;
    }
    if (niche === 'Survival' || niche === 'Psychology') {
        instructions += `
        Use the "Identity Validation / Survival Psychology" Strategy.
        1. Personality Types (Identity Validation): "The Psychology of Preppers Who Trust No One"
        2. Trauma/Origins (Forbidden Knowledge): "The Childhood Trauma That Creates Preppers"
        3. Social Dynamics (Us vs Them): "Why Your Family Thinks You're Crazy (And Why They're Wrong)"
        4. Skills/Mindset (Superiority): "The One Psychological Trait All Survivors Share"
        REQUIREMENTS: Use "Psychology of..." or "Why [Trait]..." framing. Focus on specific behaviors. Aim for "Identity Validation".`;
    } else if (niche === 'What If') {
        instructions += `
        Use the "Catastrophic Scenario / Curiosity Gap" Strategy.
        1. Economic/Societal Collapse: "What If The Dollar Collapsed Overnight?"
        2. Grid/Infrastructure Failure: "What If The Power Grid Failed for 1 Year?"
        3. Global Catastrophe: "What If 90% of Food Supply Disappeared?"
        REQUIREMENTS: Start with "What If...". Focus on high-stakes, prepper-relevant scenarios. Evoke curiosity and fear/urgency.`;
    } else {
        instructions += `
        - Use "Identity Validation" patterns: "The Psychology of People Who [Trait]".
        - Use "Forbidden Knowledge" frames: "What 90% of [Niche Audience] Get Wrong".
        - Focus on specific, relatable behaviors rather than generic topics.
        - Ensure plenty of variation in structure.`;
    }
    const response = await generate({
        model: GEMINI_MODELS.textFast,
        contents: instructions,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            }
        }
    }, { timeoutMs: TEXT_TIMEOUT, label: 'Hook generation' });
    try {
        const hooks = JSON.parse(extractJson(response.text || '[]'));
        return Array.isArray(hooks) ? hooks.map(String) : [];
    } catch (e) {
        return [];
    }
};

// Fix: Added generateOptimizedTitles function
export const generateOptimizedTitles = async (topic: string, hook: string, script: string, niche: string, isRespin: boolean, language: string): Promise<TitleGenerationResult> => {
    const response = await generate({
        model: GEMINI_MODELS.textFast,
        contents: `Generate viral video titles for topic: ${topic}, hook: ${hook}, script: ${script}, niche: ${niche}, language: ${language}. Respin: ${isRespin}`,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    primary_title: { type: Type.STRING },
                    alternative_titles: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                title: { type: Type.STRING },
                                formula_used: { type: Type.STRING },
                                score: { type: Type.NUMBER },
                                reasoning: { type: Type.STRING }
                            },
                            propertyOrdering: ["title", "formula_used", "score", "reasoning"]
                        }
                    },
                    seo_keywords_extracted: { type: Type.ARRAY, items: { type: Type.STRING } },
                    estimated_ctr_potential: { type: Type.STRING }
                },
                propertyOrdering: ["primary_title", "alternative_titles", "seo_keywords_extracted", "estimated_ctr_potential"]
            }
        }
    }, { timeoutMs: TEXT_TIMEOUT, label: 'Title generation' });
    return safeJson<TitleGenerationResult>(response.text, 'Title generation');
};

// Fix: Added generateOptimizedDescription function
export const generateOptimizedDescription = async (title: string, topic: string, hook: string, script: string, isRespin: boolean, language: string): Promise<DescriptionGenerationResult> => {
    const response = await generate({
        model: GEMINI_MODELS.textFast,
        contents: `Generate an optimized video description for title: ${title}, topic: ${topic}, script: ${script}, language: ${language}. Respin: ${isRespin}`,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    full_description: { type: Type.STRING },
                    component_breakdown: {
                        type: Type.OBJECT,
                        properties: {
                            opening_hook: { type: Type.STRING },
                            value_proposition: { type: Type.STRING },
                            content_bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
                            credibility_statement: { type: Type.STRING },
                            cta: { type: Type.STRING },
                            keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                            engagement_prompt: { type: Type.STRING },
                            disclaimer: { type: Type.STRING },
                            hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                            business_email: { type: Type.STRING }
                        }
                    },
                    character_count: { type: Type.INTEGER },
                    seo_score: { type: Type.NUMBER },
                    readability_grade: { type: Type.STRING }
                }
            }
        }
    }, { timeoutMs: TEXT_TIMEOUT, label: 'Description generation' });
    return safeJson<DescriptionGenerationResult>(response.text, 'Description generation');
};

// Fix: Added translateText function
export const translateText = async (text: string, language: string): Promise<string> => {
    if (!text?.trim()) return text;
    const response = await generate({
        model: GEMINI_MODELS.textFast,
        contents: `Translate the following text to ${language}. Return ONLY the translation, with no preamble or quotes.\n\n${text}`
    }, { timeoutMs: TEXT_TIMEOUT, label: 'Translation' });
    return response.text?.trim() || text;
};

// Scene image: every doodle frame goes through buildGolpoImagePrompt for a shared
// Golpo style + character lock. Non-default art styles are layered on as a variant.
const STYLE_MAP: Record<string, string> = {
    'Standard Sketch': "Quick pencil sketch on plain white paper. Loose graphite lines. No realism. No background scenery, just the subject. Black on white.",
    'Charcoal Pencil': "Isolated charcoal sketch on PURE WHITE background. High contrast black charcoal strokes. Subject only. Smudged shadows limited to the drawing itself. No background shading. Minimalist white space.",
    'Charcoal Pencil (Color Splash)': "Charcoal sketch on PURE WHITE background with selective COLOR SPLASH accents (Matte Orange #EA580C, Teal #0D9488, Rust Red). Gritty charcoal texture confined to the subject. Integrate the most important keywords as hand-drawn distressed lettering, spelled correctly.",
    'Apocalypse': "Gritty ink illustration, comic book style sketch. Stark black shadows, white highlights. No grey. Solid white background. Graphic novel style.",
    'Apocalypse (Color Splash)': "Gritty ink illustration, comic book style sketch on PURE WHITE background. Stark black ink shadows. Selective COLOR SPLASH accents in Dark Orange (#EA580C) and Teal (#0D9488). Dynamic colored kinetic lines. Minimalist, high contrast.",
    'Tin-Tin': "Ligne claire drawing. Clean uniform black outlines. Very flat. Minimal detail. White background. Comic strip style.",
    'Fallout': "Retro 1950s cartoon instructional sketch. Simple line art. Vintage mascot style. Black outlines on white. No shading.",
    'Stickman': "Crude child-like stick figure drawing. Simple circles for heads, single black lines for bodies. SOLID WHITE BACKGROUND. Absolutely NO shading. Flat 2D.",
    'Papercut': "Black silhouette cutout art on white background. High contrast. Sharp edges. No gradients.",
};
const GOLPO_DEFAULT_STYLES = new Set(['Nano Banana 2.5', 'Custom', '']);

const extractLabels = (prompt: string, keywords?: string): { scene: string; labels: string[] } => {
    const labels = new Set<string>();
    for (const m of (keywords || '').matchAll(/label:"([^"]+)"/g)) labels.add(m[1].trim());
    let scene = prompt || '';
    const tl = /\s*Text labels:\s*(.+?)\.?\s*$/i.exec(scene);
    if (tl) {
        for (const m of tl[1].matchAll(/"([^"]+)"/g)) labels.add(m[1].trim());
        scene = scene.slice(0, tl.index);
    }
    return { scene: scene.trim(), labels: [...labels].filter(Boolean) };
};

const invertStyle = (style: string) => style
    .replace(/black on white/gi, "white on black")
    .replace(/black/gi, "white")
    .replace(/white background/gi, "SOLID BLACK BACKGROUND")
    .replace(/white paper/gi, "SOLID BLACK BACKGROUND")
    + " High contrast white lines on pure black background. Chalkboard aesthetic.";

export const generateSceneImage = async (prompt: string, artStyle: ArtStyle, brushStyle: BrushStyle, aspectRatio: AspectRatio, analyzedStyle?: string, keywords?: string, language?: string, colorSplash?: string, characterLock?: string): Promise<string> => {
    const isInverted = String(artStyle).includes("(Inverted)");
    const baseKey = String(artStyle || '').replace(" (Inverted)", "");
    let variant: string | undefined = STYLE_MAP[baseKey];
    if (!variant && analyzedStyle && !GOLPO_DEFAULT_STYLES.has(baseKey)) variant = analyzedStyle;
    if (!variant && baseKey === 'Custom' && analyzedStyle) variant = analyzedStyle;
    if (isInverted) variant = invertStyle(variant || 'Hand-drawn marker doodle, black on white.');

    const { scene, labels } = extractLabels(prompt, keywords);
    const otherKeywords = (keywords || '').replace(/,?\s*label:"[^"]+"/g, '').trim().replace(/^,\s*/, '');
    const sceneText = [
        scene,
        'IGNORE descriptors like photorealistic, 4k, cinematic, octane render. Draw only the described elements as a doodle with lots of empty space.',
        otherKeywords ? `Keywords: ${otherKeywords}.` : '',
        language ? `Any lettering must be written in ${language}.` : '',
    ].filter(Boolean).join(' ');

    let fullPrompt = buildGolpoImagePrompt(sceneText, { characterLock: characterLock ?? currentCharacterLock, textLabels: labels });
    if (variant) fullPrompt += `\n\nSTYLE VARIANT (takes priority over STYLE/LINEWORK/COLOR above where they conflict): ${variant}`;
    if (colorSplash) fullPrompt += `\n\nACCENT COLOR PREFERENCE: ${colorSplash}`;
    if (brushStyle) fullPrompt += `\n\nBRUSH: ${brushStyle}`;

    const response = await generate({
        model: GEMINI_MODELS.image,
        contents: fullPrompt,
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
            imageConfig: { aspectRatio: DOODLE_IMAGE_ASPECT(aspectRatio) }
        }
    }, { timeoutMs: IMAGE_TIMEOUT, label: 'Scene image' });
    return firstImage(response, 'Scene image');
};

export const editImageWithGemini = async (imageBase64: string, prompt: string, aspectRatio: AspectRatio): Promise<string> => {
    const img = parseDataUrl(imageBase64);
    const response = await generate({
        model: GEMINI_MODELS.image,
        contents: {
            parts: [
                { inlineData: img },
                { text: `${prompt}\n\nKeep the existing hand-drawn whiteboard doodle style, line weight, palette and any characters exactly consistent.` }
            ]
        },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
            imageConfig: { aspectRatio: DOODLE_IMAGE_ASPECT(aspectRatio) }
        }
    }, { timeoutMs: IMAGE_TIMEOUT, label: 'Image edit' });
    return firstImage(response, 'Image edit');
};

const GOOGLE_VOICES = ['Puck', 'Charon', 'Fenrir', 'Zephyr', 'Orus', 'Iapetus', 'Enceladus', 'Kore', 'Aoede', 'Erinome'];

export const generateSpeech = async (text: string, voiceId: string, language?: string, style?: string, labsConfig?: GenAiProConfig): Promise<string> => {
    if (GOOGLE_VOICES.includes(voiceId)) {
        const spoken = style?.trim() ? `${style.trim()}: ${text}` : text;
        const response = await generate({
            model: GEMINI_MODELS.tts,
            contents: [{ parts: [{ text: spoken }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } },
                },
            },
        }, { timeoutMs: TEXT_TIMEOUT, label: 'Gemini TTS' });
        const inline = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData;
        if (inline?.data) {
            const rate = Number(/rate=(\d+)/.exec(inline.mimeType || '')?.[1]) || 24000;
            const wavData = addWavHeader(decodeBase64(inline.data), rate);
            return `data:audio/wav;base64,${encodeBase64(wavData)}`;
        }
        throw new GeminiServiceError('invalid_response', 'Gemini TTS: no audio returned');
    }
    return await generateLabsSpeech(text, voiceId, labsConfig || {} as GenAiProConfig);
};

export const translateImageText = async (imageBase64: string, language: string): Promise<string> => {
    const img = parseDataUrl(imageBase64);
    const response = await generate({
        model: GEMINI_MODELS.textFast,
        contents: {
            parts: [
                { inlineData: img },
                { text: `Extract text from this image and translate it to ${language}. Return only the translated text.` }
            ]
        }
    }, { timeoutMs: TEXT_TIMEOUT, label: 'Image text translation' });
    return response.text || '';
};

export const translateVisualPrompt = async (prompt: string, language: string): Promise<string> => {
    return await translateText(prompt, language);
};

export const scanAndTranslateImageText = async (imageBase64: string, language: string): Promise<string> => {
    return await translateImageText(imageBase64, language);
};

export const generateHighCTRThumbnail = async (context: string, niche: string, style: ThumbnailStyle, customPrompt?: string, stylePrompt?: string, colorPairDesc?: string): Promise<string> => {
    const fullPrompt = `Generate a high CTR YouTube thumbnail for a ${niche} video. Context: ${context}. Style: ${style}. ${stylePrompt || ''} ${customPrompt || ''} ${colorPairDesc || ''}`.trim();
    const response = await generate({
        model: GEMINI_MODELS.image,
        contents: { parts: [{ text: fullPrompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
            // YouTube thumbnails must stay 16:9 (not a doodle scene frame).
            imageConfig: { aspectRatio: "16:9", imageSize: "1K" }
        }
    }, { timeoutMs: IMAGE_TIMEOUT, label: 'Thumbnail' });
    return firstImage(response, 'Thumbnail');
};

// Veo video generation (long-running operation with bounded polling)
export const generateVeoVideo = async (model: VeoModel, prompt: string, aspectRatio: AspectRatio, durationSeconds: number, inputImageUrl?: string): Promise<string> => {
    const ai = getAi();
    const config: any = {
        numberOfVideos: 1,
        resolution: '720p',
        // Veo only supports 16:9 / 9:16.
        aspectRatio: aspectRatio === '9:16' ? '9:16' : '16:9',
    };
    if (durationSeconds) config.durationSeconds = durationSeconds;

    const img = inputImageUrl ? parseDataUrl(inputImageUrl) : undefined;
    let operation = await withRetry(signal => ai.models.generateVideos({
        model,
        prompt,
        ...(img ? { image: { imageBytes: img.data, mimeType: img.mimeType } } : {}),
        config: { ...config, abortSignal: signal },
    }), { timeoutMs: TEXT_TIMEOUT, label: 'Veo start' });

    const deadline = Date.now() + 10 * 60_000;
    while (!operation.done) {
        if (Date.now() > deadline) throw new GeminiServiceError('timeout', 'Veo: video generation timed out after 10 minutes');
        await sleep(10000);
        const op = operation;
        operation = await withRetry(() => ai.operations.getVideosOperation({ operation: op }), { timeoutMs: 30_000, label: 'Veo poll' });
    }
    if ((operation as any).error) {
        throw new GeminiServiceError('server', `Veo: ${(operation as any).error?.message || 'generation failed'}`);
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new GeminiServiceError('safety', 'Veo: no video returned (possibly filtered)');
    const blob = await withRetry(async signal => {
        const res = await fetch(downloadLink, { headers: { 'x-goog-api-key': getApiKey() }, signal });
        if (!res.ok) throw Object.assign(new Error(`Veo download HTTP ${res.status}`), { status: res.status });
        return res.blob();
    }, { timeoutMs: 120_000, label: 'Veo download' });
    return await blobToBase64(blob);
};

// ============================
// JACK THE RIPPER - TRANSCRIPTION ENGINE
// ============================

export interface TranscriptionResult {
    segments: { text: string; start_ms: number; end_ms: number; }[];
    full_text: string;
    duration_ms: number;
}

export interface SceneTimingMatch {
    sceneNumber: number;
    start_ms: number;
    end_ms: number;
    confidence: number;
}

const extractJson = (text: string): string => {
    const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    const firstBrace = cleanText.indexOf('{');
    const firstBracket = cleanText.indexOf('[');
    let startIdx = -1, endIdx = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        startIdx = firstBrace; endIdx = cleanText.lastIndexOf('}');
    } else if (firstBracket !== -1) {
        startIdx = firstBracket; endIdx = cleanText.lastIndexOf(']');
    }
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) return cleanText.substring(startIdx, endIdx + 1);
    return cleanText;
};

export const transcribeAudioAdvanced = async (audioBase64: string, mimeType: string = 'audio/mp3'): Promise<TranscriptionResult> => {
    const parsed = parseDataUrl(audioBase64, mimeType);
    const cleanBase64 = parsed.data;
    if (audioBase64.startsWith('data:')) mimeType = parsed.mimeType;
    const response = await generate({
        model: GEMINI_MODELS.textFast,
        config: {
            audioTimestamp: true,
            responseMimeType: 'application/json',
        },
        contents: [{
            role: 'user',
            parts: [
                { inlineData: { mimeType, data: cleanBase64 } },
                { text: `Transcribe this audio with PRECISE word-level timestamps in milliseconds.
                CRITICAL: Every word must be transcribed. Do not summarize.
                Output strictly JSON only.
                Return schema: { "segments": [ { "text": string, "start_ms": int, "end_ms": int } ], "full_text": string, "duration_ms": int }` }
            ]
        }]
    }, { timeoutMs: 300_000, retries: 2, label: 'Transcription' });
    try {
        return JSON.parse(extractJson(response.text || '')) as TranscriptionResult;
    } catch (e) {
        console.error('Transcription parse error');
        throw new Error('Transcription failed - invalid response format from AI');
    }
};

export const matchTranscriptToScenes = async (transcript: TranscriptionResult, sceneScripts: { number: number; script: string }[]): Promise<SceneTimingMatch[]> => {
    const response = await generate({
        model: GEMINI_MODELS.textFast,
        contents: [{
            role: 'user',
            parts: [{
                text: `TRANSCRIPT SEGMENTS: ${JSON.stringify(transcript.segments)}
                SCENE SCRIPTS TO MATCH: ${sceneScripts.map(s => `SCENE ${s.number}: "${s.script}"`).join('\n')}
                
                TASK: Find the start and end ms for each scene by matching script text to the transcript.
                RULES:
                1. Prioritize script text matching over silence detection.
                2. Add 15ms safety buffer to the start of each scene to ensure no transients are clipped.
                3. Scenes must be sequential.
                4. Do NOT create segments beyond the audio duration (${transcript.duration_ms}ms).
                
                Return strictly a JSON array: [{ "sceneNumber": int, "start_ms": int, "end_ms": int, "confidence": float }]`
            }]
        }],
        config: { responseMimeType: 'application/json' }
    }, { timeoutMs: 180_000, label: 'Scene matching' });
    try {
        return JSON.parse(extractJson(response.text || '')) as SceneTimingMatch[];
    } catch (e) {
        console.error('Scene matching parse error');
        throw new Error('Scene matching failed - invalid format');
    }
};
