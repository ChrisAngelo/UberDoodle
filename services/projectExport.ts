
import JSZip from 'jszip';
import { ProjectState } from '../types';

/**
 * PROJECT EXPORT SERVICE
 * 
 * Includes robust ZIP export with batch processing to prevent memory issues.
 * Enhanced text export with ElevenLabs V3 emotional tagging.
 */

// --- Emotion Tagging Logic ---

const EMOTION_PATTERNS = [
    { tag: '[whispering]', regex: /\b(chill|quiet|shh|secret|hidden|darkness|night|stalking|death|grim|scythe|unknown|faint|shadow|silence)\b/i },
    { tag: '[surprised]', regex: /\b(what|wait|wrong|mistake|error|identity|whoops|shock|sudden|unexpected|realization|gasp|impossible)\b/i },
    { tag: '[intense]', regex: /\b(run|fast|danger|survive|panic|fatal|kill|fight|escape|urgent|crisis|threat|alert|attack|scream)\b/i },
    { tag: '[chuckles]', regex: /\b(haha|funny|joke|laugh|lol|ridiculous|silly|bribe|snacks|squirrel|tiny hat|humor|smile)\b/i },
    { tag: '[sighs]', regex: /\b(tired|exhausted|give up|boring|overworked|underpaid|nap|coffee|break|sigh|fed up|waiting)\b/i },
    { tag: '[confused]', regex: /\b(why|how|explain|lost|clue|question|mix-up|gps|weird|strange|puzzle)\b/i },
    { tag: '[emphatic]', regex: /\b(never|always|must|stop|listen|rule|first|don\'t|crucial|important|absolute)\b/i },
    { tag: '[thoughtful]', regex: /\b(wonder|maybe|perhaps|consider|imagine|assume|think|reflect|ponder|theory)\b/i },
    { tag: '[excited]', regex: /\b(wow|amazing|epic|boom|win|victory|yes|finally|incredible)\b/i },
    { tag: '[annoyed]', regex: /\b(seriously|again|stupid|idiot|waste|annoying|bother)\b/i },
    { tag: '[sad]', regex: /\b(cry|tears|lost|gone|miss|heartbreak|sorrow|tragic|failure)\b/i },
];

function determineEmotion(text: string): string {
    // 1. Check Keywords
    for (const entry of EMOTION_PATTERNS) {
        if (entry.regex.test(text)) return entry.tag;
    }
    
    // 2. Fallback based on punctuation
    if (text.includes('?!')) return '[shocked]';
    if (text.includes('?')) return '[curious]';
    if (text.includes('!')) return '[energetic]';
    if (text.includes('...')) return '[hesitant]';
    
    // 3. Default
    return '[narrating]'; 
}

// --- Text Export Generators ---

const generateScriptFile = (project: ProjectState) => {
    let text = `==================================================\n`;
    text += `SECTION 1: FULL SCRIPT (STRUCTURED)\n`;
    text += `==================================================\n\n`;
    text += `SCRIPT: ${project.topic || 'Untitled'}\n`;
    text += `NICHE: ${project.niche}\n`;
    text += `TOTAL SCENES: ${project.scenes.length}\n\n`;

    project.scenes.forEach(s => {
        if (s.isDisabled) return;
        text += `[SCENE ${s.number}]\n`;
        text += `NARRATION: ${s.script}\n`;
        text += `--------------------------------------------------\n\n`;
    });

    // SECTION 2: RAW NARRATION
    text += `\n\n==================================================\n`;
    text += `SECTION 2: RAW NARRATION (LINE BY LINE)\n`;
    text += `Use this for teleprompters or clean reading.\n`;
    text += `==================================================\n\n`;
    project.scenes.forEach(s => {
        if (s.isDisabled || !s.script.trim()) return;
        text += `${s.script.trim()}\n`;
    });

    // SECTION 3: ELEVENLABS V3
    text += `\n\n==================================================\n`;
    text += `SECTION 3: ELEVENLABS V3 PROMPT (WITH EMOTION TAGS)\n`;
    text += `Copy this block directly into the ElevenLabs text box to maximize audio feel.\n`;
    text += `==================================================\n\n`;
    
    project.scenes.forEach(s => {
        if (s.isDisabled || !s.script.trim()) return;
        const tag = determineEmotion(s.script);
        text += `${tag} ${s.script.trim()}\n`;
    });

    return text;
};

const generatePromptsFile = (project: ProjectState) => {
    let text = `VISUAL PROMPTS: ${project.topic || 'Untitled'}\n\n`;
    
    project.scenes.forEach(s => {
        if (s.isDisabled) return;
        text += `[SCENE ${s.number}] (${s.type === 'video' ? 'VIDEO' : 'IMAGE'})\n`;
        text += `VISUAL PROMPT: ${s.visualDescription}\n`;
        
        if (s.type === 'video' && s.videoGenerationConfig) {
            text += `VIDEO MODEL: ${s.videoGenerationConfig.model}\n`;
            text += `VIDEO PROMPT: ${s.videoGenerationConfig.prompt}\n`;
        }
        text += `\n`;
    });
    return text;
};

// --- Helper Functions ---

const MIME_EXT: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac',
};
/** File extension from the blob's real MIME type, so a WAV isn't saved as .mp3 (or vice versa). */
const extFor = (blob: Blob, fallback: string): string => MIME_EXT[(blob.type || '').split(';')[0].trim().toLowerCase()] || fallback;

/** Short, credential-free description of a URL for logs. */
const describeUrl = (url: string): string => {
    if (!url) return '(empty)';
    if (url.startsWith('data:')) return url.substring(0, url.indexOf(',') > 0 ? Math.min(url.indexOf(','), 40) : 40);
    try { const u = new URL(url); return `${u.protocol}//${u.host}${u.pathname}`.substring(0, 80); } catch { return url.substring(0, 20); }
};

async function fetchBlob(url: string): Promise<Blob> {
  try {
    if (!url) return new Blob([], { type: 'application/octet-stream' });

    if (url.startsWith('data:')) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.blob();
    }
    
    if (url.startsWith('blob:')) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
      return await res.blob();
    }
    
    // Allow standard HTTP/HTTPS urls (e.g. from a CDN or external source)
    if (url.startsWith('http')) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.blob();
    }
    
    throw new Error(`Unsupported URL type: ${describeUrl(url)}`);
  } catch (err) {
    console.error('fetchBlob failed:', describeUrl(url), (err as Error)?.message || err);
    return new Blob([], { type: 'application/octet-stream' });
  }
}

// --- Main Export Functions ---

export const exportScriptToText = (project: ProjectState): Blob => {
    return new Blob([generateScriptFile(project)], { type: 'text/plain' });
};

export const exportPromptsToText = (project: ProjectState): Blob => {
    return new Blob([generatePromptsFile(project)], { type: 'text/plain' });
};

export const exportProjectToZip = async (project: ProjectState): Promise<Blob> => {
    // 1. Initialize Zip
    const zip = new JSZip();
    const safeTopic = ((project.topic || 'Project').replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').substring(0, 60)) || 'Project';
    const folderName = `${safeTopic}_Backup`;
    const root = zip.folder(folderName);
    
    if (!root) throw new Error("Failed to create zip root.");

    // 2. Setup Folders
    const fImages = root.folder("01_Images");
    const fVideos = root.folder("02_Videos");
    const fAudio = root.folder("03_Audio");
    const fMeta = root.folder("00_Metadata");

    // 3. Write Metadata
    console.log("Exporting metadata...");
    if (fMeta) {
        fMeta.file("script.txt", generateScriptFile(project));
        fMeta.file("prompts.txt", generatePromptsFile(project));
        fMeta.file("project_data.json", JSON.stringify(project, null, 2));
    }

    // 4. Batch Process Scenes
    console.log('Starting backup export with', project.scenes.length, 'scenes');
    const BATCH_SIZE = 3;
    const seenNumbers = new Set<number>();

    for (let i = 0; i < project.scenes.length; i += BATCH_SIZE) {
        const batch = project.scenes.slice(i, i + BATCH_SIZE);
        console.log(`Processing scene batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(project.scenes.length/BATCH_SIZE)}`);
        
        await Promise.all(batch.map(async (scene, j) => {
            // Use position as a fallback so duplicate/missing scene numbers don't overwrite files.
            const num = String(Number.isFinite(scene.number) ? scene.number : i + j + 1).padStart(3, '0') + (seenNumbers.has(scene.number) ? `_${i + j + 1}` : '');
            seenNumbers.add(scene.number);
            
            try {
                // Image
                if (scene.imageUrl && fImages) {
                    const blob = await fetchBlob(scene.imageUrl);
                    if (blob.size > 0) fImages.file(`Scene_${num}_Image.${extFor(blob, 'png')}`, blob);
                }

                // Video
                if (scene.type === 'video' && scene.videoUrl && fVideos) {
                    const blob = await fetchBlob(scene.videoUrl);
                    if (blob.size > 0) fVideos.file(`Scene_${num}_Video.${extFor(blob, 'mp4')}`, blob);
                }

                // Audio (Narration)
                if (scene.audioUrl && fAudio) {
                    const blob = await fetchBlob(scene.audioUrl);
                    if (blob.size > 0) fAudio.file(`Scene_${num}_Narration.${extFor(blob, 'wav')}`, blob);
                }

                // SFX
                if (scene.sfxUrl && fAudio) {
                    const blob = await fetchBlob(scene.sfxUrl);
                    if (blob.size > 0) fAudio.file(`Scene_${num}_SFX.${extFor(blob, 'mp3')}`, blob);
                }
            } catch (error) {
                console.warn(`Failed to export assets for scene ${scene.id}:`, error);
            }
        }));
    }

    // 5. Global Assets
    try {
        if (project.musicUrl && fAudio) {
            const blob = await fetchBlob(project.musicUrl);
            if (blob.size > 0) fAudio.file(`Background_Music.${extFor(blob, 'mp3')}`, blob);
        }
        if (project.globalSfxUrl && fAudio) {
            const blob = await fetchBlob(project.globalSfxUrl);
            if (blob.size > 0) fAudio.file(`Global_SFX.${extFor(blob, 'mp3')}`, blob);
        }
    } catch (e) {
        console.warn("Failed to export global assets", e);
    }

    // 6. Generate Zip
    try {
        console.log('Generating ZIP file...');
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
        console.log('Zip generation complete:', (zipBlob.size / 1024 / 1024).toFixed(2), 'MB');
        return zipBlob;
    } catch (error: any) {
        console.error('ZIP generation failed:', error);
        throw new Error(`Backup export failed: ${error.message}`);
    }
};

export const exportImagesToZip = async (project: ProjectState): Promise<Blob> => {
    throw new Error("Image ZIP Export has been disabled. Use Backup Project instead.");
};
