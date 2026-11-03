import { GenAiProConfig } from "../types";

// =============================================================================
// DOODLEMINDS STUDIO - COMPREHENSIVE TTS SERVICE
// Supports: LMNT, ElevenLabs (Direct), GenAiPro (via Proxy)
// =============================================================================

// --- API KEYS ---
const LMNT_API_KEY = "ak_A6BZWJERjYdpUC4szTz2Jr";
const ELEVENLABS_API_KEY = "cc487b8cbd72fa70219667f381997df51eac0cb19de27d02dc2206bc098f72f3";
const GENAIPRO_JWT = "eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDIyMkFBQSIsImtpZCI6Imluc18ydmlCa3pCZzdVUUJ4eW9FTHh4WmN4Q1FWc0MiLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL2dlbmFpcHJvLnZuIiwiZXhwIjoxNzY4ODQyNzA3LCJpYXQiOjE3NjEwNjY3MDcsImlzcyI6Imh0dHBzOi8vY2xlcmsuZ2VuYWlwcm8udm4iLCJqdGkiOiI4NGM4YTQyMDU5YmE3YTU2MjY1OCIsIm5iZiI6MTc2MTA2NjcwMiwicHVibGljX21ldGFkYXRhIjp7ImNoYXRncHRfYWNjb3VudF9pZCI6IjI0N2E3ZWIxLTIxODktNDg4NS05YTU0LTUxNDA1MjFlOGNlNCIsInJvbGUiOiJ1c2VyIiwidXNlcl9kYl9pZCI6IjYzMmMyNmRlLTUxMGMtNDMwYy1iZDJkLWRkMDcxYmMwNjFiYyIsInZlb19hY2NvdW50X2lkIjoiM2IwODBlNzgtODIyOC00N2FlLTk4ZmItYTIxYmJiZjc0OGExIiwidmVvX3N1YnNjcmlwdGlvbl9lbmRfZGF0ZSI6IjIwMjUtMTAtMjJUMTg6NTE6NDIrMDc6MDAifSwic3ViIjoidXNlcl8zNExQdUJSZm1WdU9aa1dMMzN6ZmN4YUZhMWoiLCJ1c2VybmFtZSI6ImNocmlzYW5nZWxvIn0.RTFyhr9F3TZqMHKWlgw-7WzZq4NGgfKFKc6CuLDFfqKXcs8GAk1pE6jjFF_x7QMBCZMGlD7vsR0_h2tGkRBE-KX_zeW59-RlHSP1kPHqWzCubMFwX2uT3HFuAj7HRxWlDJqKoXNepwc8qvTHykiBs9d_pCO91oZk3ZtXG8bJkPQlg-UMUWWRQfhzBc7AeIwNHoknNxB3aVwz2VWyEjJSJBaRDpe45I0K8Uc4E_jU0PEWV4QMR9UD9iriny-xijBRpbVltIKlMSLbVNO0IJBLZTKh5Sl_1Tn_2olb-QbyGyogrdENV5yZsRVIFxSIsbrEUNBxN5BIxkajxW2u7Mhzkg";

// --- API URLS ---
const LMNT_API_URL = "https://api.lmnt.com/v1/ai/speech";
const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
const GENAIPRO_API_URL = "https://genaipro.vn/api/v1";
const LOCAL_PROXY_URL = "http://localhost:3002/proxy";

// --- LMNT VOICE IDS ---
export const LMNT_VOICES = {
    DoodleMinds: "462e2487-0af4-4eca-8a8b-7e9064810542",
    Harrison: "ecccd025-04e1-4382-9271-a2fe31432891",
    Maya: "52d72957-f745-4ffb-b5bc-244d0f10ab4d",
    Aussie: "36d4d99e-dd7a-4caf-9329-7c9aa3b2b3af"
};

// --- FALLBACK SILENT AUDIO ---
const FALLBACK_AUDIO = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAAABmYWN0BAAAAAAAAABkYXRhAAAAAA==";

// --- INTERFACES ---
export interface LabVoice {
    voice_id: string;
    name: string;
    category: string;
    labels: {
        accent?: string;
        description?: string;
        age?: string;
        gender?: string;
        use_case?: string;
    };
    preview_url?: string;
    provider?: 'elevenlabs' | 'genaipro' | 'lmnt';
}

export interface VoiceFilterParams {
    search?: string;
    language?: string;
    accent?: string;
    gender?: string;
    age?: string;
    category?: string;
    page?: number;
    page_size?: number;
}

// =============================================================================
// LMNT TTS - Direct API
// =============================================================================
export const generateLMNTSpeech = async (text: string, voiceId: string, speed: number = 1.0): Promise<string> => {
    console.log(`[LMNT] Generating speech with voice: ${voiceId}`);
    
    try {
        const response = await fetch(LMNT_API_URL, {
            method: 'POST',
            headers: {
                'X-API-Key': LMNT_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                voice: voiceId,
                speed: speed,
                format: 'mp3'
            })
        });
        
        if (!response.ok) {
            throw new Error(`LMNT API Error: ${response.status}`);
        }
        
        const blob = await response.blob();
        return await blobToDataUri(blob);
    } catch (error: any) {
        console.error('[LMNT] Failed:', error.message);
        throw error;
    }
};

// =============================================================================
// ELEVENLABS DIRECT - Using DoodleMinds API Key
// =============================================================================
export const generateElevenLabsSpeech = async (
    text: string,
    voiceId: string,
    config: GenAiProConfig
): Promise<string> => {
    console.log(`[ElevenLabs Direct] Generating speech with voice: ${voiceId}`);
    
    try {
        const payload = {
            text: text,
            model_id: config.model_id || "eleven_multilingual_v2",
            voice_settings: {
                stability: config.stability ?? 0.5,
                similarity_boost: config.similarity_boost ?? 0.75,
                style: config.style ?? 0.0,
                use_speaker_boost: config.use_speaker_boost ?? true
            }
        };
        
        const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'xi-api-key': ELEVENLABS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            throw new Error(`ElevenLabs API Error: ${response.status}`);
        }
        
        const blob = await response.blob();
        return await blobToDataUri(blob);
    } catch (error: any) {
        console.error('[ElevenLabs] Failed:', error.message);
        throw error;
    }
};

// =============================================================================
// GENAIPRO TTS VIA LOCAL PROXY - Bypasses all CORS and browser blocks
// The proxy server handles all GenAiPro API communication
// =============================================================================
export const generateGenAiProSpeech = async (
    text: string,
    voiceId: string,
    config: GenAiProConfig
): Promise<string> => {
    console.log(`[GenAiPro via Proxy] Generating speech with voice: ${voiceId}`);
    
    try {
        // Step 1: Create TTS task via proxy
        const createResponse = await fetch(`${LOCAL_PROXY_URL}/genaipro/labs/task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: text,
                voice_id: voiceId,
                model_id: config.model_id || "eleven_v3",
                style: config.style ?? 0.0,
                speed: config.speed ?? 1.0,
                use_speaker_boost: config.use_speaker_boost ?? true,
                similarity: config.similarity_boost ?? 0.75,
                stability: config.stability ?? 0.5
            })
        });
        
        if (!createResponse.ok) {
            const errText = await createResponse.text();
            console.error(`[GenAiPro] Task creation failed: ${createResponse.status} - ${errText}`);
            throw new Error(`GenAiPro task creation failed: ${createResponse.status}`);
        }
        
        const createData = await createResponse.json();
        const taskId = createData.task_id;
        console.log(`[GenAiPro] Task created: ${taskId}`);
        
        // Step 2: Poll for completion (max 2 minutes)
        for (let attempt = 0; attempt < 60; attempt++) {
            await new Promise(r => setTimeout(r, 2000));
            
            const statusResponse = await fetch(`${LOCAL_PROXY_URL}/genaipro/labs/task/${taskId}`);
            
            if (statusResponse.ok) {
                const statusData = await statusResponse.json();
                console.log(`[GenAiPro] Status: ${statusData.status}`);
                
                if (statusData.status === 'completed' && statusData.result) {
                    // Step 3: Fetch audio file via proxy
                    const audioResponse = await fetch(`${LOCAL_PROXY_URL}/fetch-audio?url=${encodeURIComponent(statusData.result)}`);
                    if (audioResponse.ok) {
                        const blob = await audioResponse.blob();
                        console.log(`[GenAiPro] Audio received: ${blob.size} bytes`);
                        return await blobToDataUri(blob);
                    }
                } else if (statusData.status === 'failed') {
                    throw new Error('GenAiPro task failed: ' + (statusData.error || 'Unknown error'));
                }
            }
        }
        
        throw new Error('GenAiPro task timeout after 2 minutes');
    } catch (error: any) {
        console.error('[GenAiPro] Failed:', error.message);
        throw error;
    }
};

// =============================================================================
// FETCH GENAIPRO VOICES VIA PROXY
// =============================================================================
export const fetchGenAiProVoices = async (filters: VoiceFilterParams = {}): Promise<LabVoice[]> => {
    console.log('[GenAiPro] Fetching voices via proxy...');
    
    try {
        const params = new URLSearchParams();
        params.append('page', (filters.page || 0).toString());
        params.append('page_size', (filters.page_size || 100).toString());
        if (filters.search) params.append('search', filters.search);
        if (filters.gender) params.append('gender', filters.gender);
        if (filters.language) params.append('language', filters.language);
        if (filters.accent) params.append('accent', filters.accent);
        if (filters.age) params.append('age', filters.age);
        if (filters.category) params.append('category', filters.category);
        
        const response = await fetch(`${LOCAL_PROXY_URL}/genaipro/labs/voices?${params.toString()}`);
        
        if (response.ok) {
            const data = await response.json();
            const voices = (data.voices || []).map((v: any) => ({ ...v, provider: 'genaipro' as const }));
            console.log(`[GenAiPro] Loaded ${voices.length} voices`);
            return voices;
        } else {
            console.error(`[GenAiPro] Voice fetch failed: ${response.status}`);
        }
    } catch (e: any) {
        console.warn('[GenAiPro] Voice fetch error:', e.message);
    }
    return [];
};

// =============================================================================
// FETCH ELEVENLABS VOICES DIRECTLY
// =============================================================================
export const fetchElevenLabsVoices = async (): Promise<LabVoice[]> => {
    console.log('[ElevenLabs] Fetching voices directly...');
    
    try {
        const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
            headers: { 'xi-api-key': ELEVENLABS_API_KEY }
        });
        
        if (response.ok) {
            const data = await response.json();
            const voices = (data.voices || []).map((v: any) => ({ ...v, provider: 'elevenlabs' as const }));
            console.log(`[ElevenLabs] Loaded ${voices.length} voices`);
            return voices;
        } else {
            console.error(`[ElevenLabs] Voice fetch failed: ${response.status}`);
        }
    } catch (e: any) {
        console.warn('[ElevenLabs] Voice fetch error:', e.message);
    }
    return [];
};

// =============================================================================
// GET ALL LMNT VOICES
// =============================================================================
export const getLMNTVoices = (): LabVoice[] => {
    return [
        { voice_id: LMNT_VOICES.DoodleMinds, name: 'DoodleMinds', category: 'lmnt', labels: { gender: 'male', description: 'Custom DoodleMinds Voice' }, provider: 'lmnt' },
        { voice_id: LMNT_VOICES.Harrison, name: 'Harrison', category: 'lmnt', labels: { gender: 'male', description: 'Voice in the Night' }, provider: 'lmnt' },
        { voice_id: LMNT_VOICES.Maya, name: 'Maya', category: 'lmnt', labels: { gender: 'female', description: 'Sleepless With Maya' }, provider: 'lmnt' },
        { voice_id: LMNT_VOICES.Aussie, name: 'Aussie', category: 'lmnt', labels: { gender: 'male', accent: 'australian', description: 'Australian Accent' }, provider: 'lmnt' }
    ];
};

// =============================================================================
// COMBINED VOICE FETCHER
// =============================================================================
export const fetchLabsVoices = async (filters: VoiceFilterParams = {}, source: 'all' | 'elevenlabs' | 'genaipro' | 'lmnt' = 'all'): Promise<LabVoice[]> => {
    const allVoices: LabVoice[] = [];
    
    // Always include LMNT voices first
    if (source === 'all' || source === 'lmnt') {
        allVoices.push(...getLMNTVoices());
    }
    
    // Fetch ElevenLabs voices
    if (source === 'all' || source === 'elevenlabs') {
        try {
            const elVoices = await fetchElevenLabsVoices();
            allVoices.push(...elVoices);
        } catch (e) {
            console.warn('[Combined] ElevenLabs fetch failed');
        }
    }
    
    // Fetch GenAiPro voices via proxy
    if (source === 'all' || source === 'genaipro') {
        try {
            const gapVoices = await fetchGenAiProVoices(filters);
            allVoices.push(...gapVoices);
        } catch (e) {
            console.warn('[Combined] GenAiPro fetch failed');
        }
    }
    
    console.log(`[Combined] Total voices: ${allVoices.length}`);
    return allVoices;
};

// =============================================================================
// MAIN SPEECH GENERATION - Auto-routes to correct provider
// =============================================================================
export const generateLabsSpeech = async (
    text: string,
    voiceId: string,
    config: GenAiProConfig,
    provider?: 'elevenlabs' | 'genaipro' | 'lmnt'
): Promise<string> => {
    console.log(`[TTS] Generating speech - Voice: ${voiceId}, Provider hint: ${provider || 'auto'}`);
    
    const lmntVoiceIds = Object.values(LMNT_VOICES);
    
    // Auto-detect LMNT voices
    if (lmntVoiceIds.includes(voiceId) || provider === 'lmnt') {
        try {
            return await generateLMNTSpeech(text, voiceId, config.speed || 1.0);
        } catch (e) {
            console.warn('[TTS] LMNT failed, trying fallback...');
        }
    }
    
    // Try GenAiPro via proxy if specified
    if (provider === 'genaipro') {
        try {
            return await generateGenAiProSpeech(text, voiceId, config);
        } catch (e) {
            console.warn('[TTS] GenAiPro failed, trying ElevenLabs...');
        }
    }
    
    // Try ElevenLabs direct
    try {
        return await generateElevenLabsSpeech(text, voiceId, config);
    } catch (e) {
        console.warn('[TTS] ElevenLabs failed');
    }
    
    // Try GenAiPro as last resort
    try {
        return await generateGenAiProSpeech(text, voiceId, config);
    } catch (e) {
        console.warn('[TTS] All providers failed');
    }
    
    console.error('[TTS] All TTS providers failed, returning silent fallback');
    return FALLBACK_AUDIO;
};

// =============================================================================
// UTILITY
// =============================================================================
const blobToDataUri = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

// =============================================================================
// CHECK PROXY STATUS
// =============================================================================
export const checkProxyStatus = async (): Promise<boolean> => {
    try {
        const response = await fetch(`${LOCAL_PROXY_URL}/health`);
        return response.ok;
    } catch {
        return false;
    }
};

// =============================================================================
// GET API INFO (for debugging)
// =============================================================================
export const getApiInfo = () => ({
    lmnt: { url: LMNT_API_URL, hasKey: !!LMNT_API_KEY },
    elevenlabs: { url: ELEVENLABS_API_URL, hasKey: !!ELEVENLABS_API_KEY },
    genaipro: { url: GENAIPRO_API_URL, hasKey: !!GENAIPRO_JWT },
    proxy: { url: LOCAL_PROXY_URL }
});
