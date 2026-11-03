
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Scene, VeoModel, TitleGenerationResult, DescriptionGenerationResult, ArtStyle, BrushStyle, AspectRatio, GenAiProConfig, ThumbnailStyle } from "../types";
import { generateLabsSpeech } from "./genAiProService";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to convert blob to base64
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

// Helper for base64 decoding
function decodeBase64(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// Helper for base64 encoding
function encodeBase64(bytes: Uint8Array): string {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// Helper to add WAV header to raw PCM data from Gemini TTS
function addWavHeader(pcmData: Uint8Array, sampleRate: number): Uint8Array {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    
    view.setUint32(0, 0x46464952, false); 
    view.setUint32(4, 36 + pcmData.length, true);
    view.setUint32(8, 0x45564157, false); 
    view.setUint32(12, 0x20746d66, false); 
    view.setUint16(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x61746164, false); 
    view.setUint32(40, pcmData.length, true);
    
    const result = new Uint8Array(44 + pcmData.length);
    result.set(new Uint8Array(header));
    result.set(pcmData, 44);
    return result;
}

// 1. Generate Script
export const generateScript = async (topic: string, niche: string, targetDuration: number, totalDurationMinutes: number, scriptLanguage: string = 'English (US)'): Promise<string> => {
    const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Write a viral video script about "${topic}" in the "${niche}" niche. 
        Total Video Length: ${totalDurationMinutes} minutes. 
        Scene Pacing: ${targetDuration} seconds per scene.
        Language: ${scriptLanguage}.
        
        Format the output as a continuous script with [SCENE] headers.
        Focus on high retention, storytelling, and emotional engagement.`
    });
    return response.text || '';
};

// 2. Parse Script
export const parseScriptToScenes = async (script: string): Promise<Scene[]> => {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Parse the following script into scenes. Return a JSON array.
        Script: ${script.substring(0, 30000)}...
        
        Output Schema:
        Array of objects: {
            number: number,
            script: string (the narration),
            visualDescription: string (visual prompt for image generation),
            visualKeywords: string (comma separated keywords)
        }
        
        Generate visually descriptive prompts for 'visualDescription'.`,
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
                        visualKeywords: { type: Type.STRING }
                    }
                }
            }
        }
    });
    
    try {
        const raw = JSON.parse(response.text || '[]');
        return raw.map((s: any) => ({
            ...s,
            id: `scene-${Date.now()}-${Math.random()}`,
            type: 'standard',
            isGenerating: false
        }));
    } catch (e) {
        console.error("Failed to parse scenes", e);
        return [];
    }
};

// 3. Analyze Image Style
export const analyzeImageStyle = async (imageBase64: string): Promise<string> => {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                { inlineData: { mimeType: 'image/png', data: imageBase64.split(',')[1] } },
                { text: "Analyze the art style of this image. Describe it in a detailed prompt suitable for generating similar images." }
            ]
        }
    });
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
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: instructions,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            }
        }
    });
    try {
        return JSON.parse(response.text || '[]');
    } catch (e) {
        return [];
    }
};

// Fix: Added generateOptimizedTitles function
export const generateOptimizedTitles = async (topic: string, hook: string, script: string, niche: string, isRespin: boolean, language: string): Promise<TitleGenerationResult> => {
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
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
    });
    return JSON.parse(response.text || '{}');
};

// Fix: Added generateOptimizedDescription function
export const generateOptimizedDescription = async (title: string, topic: string, hook: string, script: string, isRespin: boolean, language: string): Promise<DescriptionGenerationResult> => {
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
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
    });
    return JSON.parse(response.text || '{}');
};

// Fix: Added translateText function
export const translateText = async (text: string, language: string): Promise<string> => {
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Translate the following text to ${language}: ${text}`
    });
    return response.text || text;
};

// Fix: Added generateSceneImage function (rich style mapping + safety merged from candidate)
export const generateSceneImage = async (prompt: string, artStyle: ArtStyle, brushStyle: BrushStyle, aspectRatio: AspectRatio, analyzedStyle?: string, keywords?: string, language?: string, colorSplash?: string): Promise<string> => {
    const STYLE_MAP: Record<string, string> = {
        'Nano Banana 2.5': "Simple black marker doodle on SOLID WHITE background. Thick clean lines. Minimalist. No shading. No grey. No complex background. Center subject, wide white margins.",
        'Standard Sketch': "Quick pencil sketch on plain white paper. Loose graphite lines. No realism. No background scenery, just the subject. Black on white.",
        'Charcoal Pencil': "Isolated charcoal sketch on PURE WHITE background. High contrast black charcoal strokes. Subject only. Smudged shadows and raster texture limited to the drawing itself. No background shading. No grey paper tint. Rough, gritty manual illustration style. Minimalist white space.",
        'Charcoal Pencil (Color Splash)': "Charcoal sketch on PURE WHITE background with selective COLOR SPLASH accents (Matte Orange #EA580C, Teal #0D9488, Rust Red). Gritty, rough charcoal texture confined to the subject. TYPOGRAPHY: Boldly integrate the most important keywords into the artwork using a hand-drawn, distressed font. If the concept is a short phrase, write the entire sentence. Ensure spelling is correct. Use matte colors for the text and accents. Do not fill the whole background.",
        'Apocalypse': "Gritty ink illustration, comic book style sketch. Stark black shadows, white highlights. No grey. Solid white background. Graphic novel style.",
        'Apocalypse (Color Splash)': "Gritty ink illustration, comic book style sketch on PURE WHITE background. Stark black ink shadows. Selective COLOR SPLASH accents in Dark Orange (#EA580C) and Teal (#0D9488). Use dynamic colored kinetic lines and splatter effects to emphasize action. Do not fill the whole background. Minimalist graphic novel style with high contrast. No grey, just black, white, and accent colors.",
        'Tin-Tin': "Ligne claire drawing. Clean uniform black outlines. Very flat. Minimal detail. White background. Comic strip style.",
        'Fallout': "Retro 1950s cartoon instructional sketch. Simple line art. Vintage mascot style. Black outlines on white. No shading.",
        'Stickman': "Crude child-like stick figure drawing. Simple circles for heads, single black lines for bodies. SOLID WHITE BACKGROUND. Absolutely NO shading. Flat 2D.",
        'Papercut': "Black silhouette cutout art on white background. High contrast. Sharp edges. No gradients.",
        'Custom': "Black and white sketch. Simple lines. White background."
    };

    let visualStyle = STYLE_MAP['Nano Banana 2.5'];
    const isInverted = String(artStyle).includes("(Inverted)");
    const baseKey = String(artStyle).replace(" (Inverted)", "");
    if (STYLE_MAP[baseKey]) {
        visualStyle = STYLE_MAP[baseKey];
    } else if (analyzedStyle) {
        visualStyle = analyzedStyle;
    } else if (STYLE_MAP[String(artStyle)]) {
        visualStyle = STYLE_MAP[String(artStyle)];
    }

    if (isInverted) {
        visualStyle = visualStyle
            .replace(/black marker/gi, "white marker")
            .replace(/black ink/gi, "white ink")
            .replace(/black outlines/gi, "white outlines")
            .replace(/black graphite/gi, "white chalk")
            .replace(/pencil/gi, "white pencil")
            .replace(/charcoal/gi, "white charcoal")
            .replace(/black on white/gi, "white on black")
            .replace(/black/gi, "white")
            .replace(/white background/gi, "SOLID BLACK BACKGROUND")
            .replace(/white paper/gi, "SOLID BLACK BACKGROUND")
            .replace(/white margins/gi, "black margins");
        visualStyle += " High contrast white lines on pure black background. Neon or chalkboard aesthetic.";
    }

    const safetyInstruction = "IMPORTANT: IGNORE any descriptors in the scene description like 'photorealistic', '4k', 'cinematic', 'octane render', 'hyperrealistic'. Do NOT fill the entire screen. Leave empty space around the subject. DRAW ONLY THE SUBJECT as a sketch.";
    const fullPrompt = `Art Style: ${visualStyle}. \n\nScene Subject: ${prompt}. \n\n${safetyInstruction} ${keywords || ""} ${language ? `\n(Text/Culture: ${language})` : ""}`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: fullPrompt,
        config: {
            imageConfig: {
                aspectRatio: aspectRatio,
            }
        }
    });
    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
    }
    throw new Error("No image generated");
};

// Fix: Added editImageWithGemini function
export const editImageWithGemini = async (imageBase64: string, prompt: string, aspectRatio: AspectRatio): Promise<string> => {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: [
                { inlineData: { mimeType: 'image/png', data: imageBase64.split(',')[1] } },
                { text: prompt }
            ]
        },
        config: {
            imageConfig: {
                aspectRatio: aspectRatio
            }
        }
    });
    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            return `data:image/png;base64,${part.inlineData.data}`;
        }
    }
    throw new Error("Failed to edit image");
};

// Fix: Added generateSpeech function
export const generateSpeech = async (text: string, voiceId: string, language?: string, style?: string, labsConfig?: GenAiProConfig): Promise<string> => {
    const googleVoices = ['Puck', 'Charon', 'Fenrir', 'Zephyr', 'Orus', 'Iapetus', 'Enceladus', 'Kore', 'Aoede', 'Erinome'];
    if (googleVoices.includes(voiceId)) {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: `${style || ''} ${text}` }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceId },
                    },
                },
            },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            const pcmData = decodeBase64(base64Audio);
            const wavData = addWavHeader(pcmData, 24000);
            return `data:audio/wav;base64,${encodeBase64(wavData)}`;
        }
        throw new Error("Failed to generate Google TTS");
    } else {
        return await generateLabsSpeech(text, voiceId, labsConfig!);
    }
};

// Fix: Added translateImageText function
export const translateImageText = async (imageBase64: string, language: string): Promise<string> => {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                { inlineData: { mimeType: 'image/png', data: imageBase64.split(',')[1] } },
                { text: `Extract text from this image and translate it to ${language}.` }
            ]
        }
    });
    return response.text || '';
};

// Fix: Added translateVisualPrompt function
export const translateVisualPrompt = async (prompt: string, language: string): Promise<string> => {
    return await translateText(prompt, language);
};

// Fix: Added scanAndTranslateImageText function
export const scanAndTranslateImageText = async (imageBase64: string, language: string): Promise<string> => {
    return await translateImageText(imageBase64, language);
};

// Fix: Added generateHighCTRThumbnail function
export const generateHighCTRThumbnail = async (context: string, niche: string, style: ThumbnailStyle, customPrompt?: string, stylePrompt?: string, colorPairDesc?: string): Promise<string> => {
    const fullPrompt = `Generate a high CTR thumbnail for a ${niche} video. Context: ${context}. Style: ${style}. ${stylePrompt || ''}. ${customPrompt || ''}. ${colorPairDesc || ''}`;
    const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts: [{ text: fullPrompt }] },
        config: {
            imageConfig: {
                aspectRatio: "16:9",
                imageSize: "1K"
            }
        }
    });
    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            return `data:image/png;base64,${part.inlineData.data}`;
        }
    }
    throw new Error("Failed to generate thumbnail");
};

// 14. Generate Veo Video
export const generateVeoVideo = async (model: VeoModel, prompt: string, aspectRatio: AspectRatio, durationSeconds: number, inputImageUrl?: string): Promise<string> => {
    const aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const config: any = {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: aspectRatio
    };

    let operation;
    if (inputImageUrl) {
        operation = await aiInstance.models.generateVideos({
            model: model,
            prompt: prompt,
            image: {
                imageBytes: inputImageUrl.split(',')[1],
                mimeType: 'image/png',
            },
            config: config
        });
    } else {
        operation = await aiInstance.models.generateVideos({
            model: model,
            prompt: prompt,
            config: config
        });
    }

    while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await aiInstance.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
    const blob = await response.blob();
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
    const cleanBase64 = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        config: {
            audioTimestamp: true,
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
    });
    try {
        return JSON.parse(extractJson(response.text || '')) as TranscriptionResult;
    } catch (e) {
        console.error('Transcription parse error');
        throw new Error('Transcription failed - invalid response format from AI');
    }
};

export const matchTranscriptToScenes = async (transcript: TranscriptionResult, sceneScripts: { number: number; script: string }[]): Promise<SceneTimingMatch[]> => {
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
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
        }]
    });
    try {
        return JSON.parse(extractJson(response.text || '')) as SceneTimingMatch[];
    } catch (e) {
        console.error('Scene matching parse error');
        throw new Error('Scene matching failed - invalid format');
    }
};
