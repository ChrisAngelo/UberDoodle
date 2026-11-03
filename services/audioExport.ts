
import { ProjectState, Scene } from "../types";

// Helper to reliable fetch audio (handles blob urls, data urls, etc)
async function fetchAudio(url: string): Promise<ArrayBuffer> {
    try {
        if (!url) throw new Error("Empty URL");
        
        if (url.startsWith('data:')) {
            const split = url.split(',');
            const base64 = split[1];
            const binaryString = atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes.buffer;
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.blob().then(b => b.arrayBuffer());
    } catch(e) {
        console.error("Failed to fetch audio for offline render", e);
        // Return silent buffer of 1s to prevent crash
        return new ArrayBuffer(44100 * 2); 
    }
}

/**
 * Renders the project audio timeline offline using OfflineAudioContext.
 * Returns separate blobs for requested stems and a full mix.
 */
export const renderOfflineAudio = async (
    project: ProjectState,
    audioBuffers: Map<string, AudioBuffer>,
    sfxBuffers: Map<string, AudioBuffer>,
    musicBuffer: AudioBuffer | null
): Promise<{ narration?: Blob; sfx?: Blob; music?: Blob; fullMix?: Blob }> => {
    
    // 1. Calculate Total Duration
    let totalDuration = 0;
    const sceneStartTimes: number[] = [];
    
    const startSceneIdx = (project.exportStartScene || 1) - 1;
    const endSceneIdx = Math.min((project.exportEndScene || project.scenes.length), project.scenes.length);
    
    for (let i = startSceneIdx; i < endSceneIdx; i++) {
        sceneStartTimes[i] = totalDuration;
        const scene = project.scenes[i];
        
        let duration = 4.0;
        
        if (scene.type === 'video' && (scene.videoDuration || scene.videoMediaEnd)) {
             const start = scene.videoMediaStart || 0;
             const end = scene.videoMediaEnd || scene.videoDuration || 0;
             duration = Math.max(0, end - start);
             if (duration === 0) duration = 4.0; // Fallback
        } else if (scene.mediaEnd && scene.mediaStart !== undefined) {
             // Timecoded Audio Scene (Coherent Flow)
             duration = scene.mediaEnd - scene.mediaStart;
        } else {
             // Standard Audio Scene
             const buffer = audioBuffers.get(scene.id);
             if (buffer) duration = buffer.duration;
        }
        
        totalDuration += duration;
    }
    
    // Add 2 seconds extra for Music Fade Out
    const FADE_OUT_DURATION = 2.0;
    // Ensure render duration is at least 1 second to prevent OfflineAudioContext constructor error
    const renderDuration = Math.max(1.0, totalDuration + FADE_OUT_DURATION);
    
    // 2. Setup Context
    const sampleRate = 44100;
    
    // Prepare temporary context for decoding video audio on the fly if needed
    const decodingCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Cache decoded video buffers
    const videoAudioBuffers = new Map<string, AudioBuffer>();

    // Pre-fetch video audio
    for (let i = startSceneIdx; i < endSceneIdx; i++) {
        const scene = project.scenes[i];
        if (scene.type === 'video' && scene.videoUrl) {
            try {
                // Only decode if we haven't already (videoUrl is key)
                if (!videoAudioBuffers.has(scene.videoUrl)) {
                    const arrayBuffer = await fetchAudio(scene.videoUrl);
                    if (arrayBuffer.byteLength > 100) {
                        const audioBuffer = await decodingCtx.decodeAudioData(arrayBuffer);
                        videoAudioBuffers.set(scene.videoUrl, audioBuffer);
                    }
                }
            } catch (e) {
                console.warn(`Could not extract audio from video scene ${scene.number}`, e);
            }
        }
    }

    // Helper to render a pass
    const renderPass = async (type: 'narr' | 'sfx' | 'music' | 'full') => {
        // Ensure strictly positive length
        const length = Math.max(1, Math.ceil(renderDuration * sampleRate));
        const passCtx = new OfflineAudioContext(2, length, sampleRate);
        
        for (let i = startSceneIdx; i < endSceneIdx; i++) {
            const startTime = sceneStartTimes[i];
            const scene = project.scenes[i];
            
            // Recalculate duration for this specific scene loop to determine stop time
            let duration = 4.0;
            if (scene.type === 'video' && (scene.videoDuration || scene.videoMediaEnd)) {
                 const start = scene.videoMediaStart || 0;
                 const end = scene.videoMediaEnd || scene.videoDuration || 0;
                 duration = Math.max(0, end - start);
                 if(duration === 0) duration = 4.0;
            } else if (scene.mediaEnd && scene.mediaStart !== undefined) {
                 duration = scene.mediaEnd - scene.mediaStart;
            } else {
                 const buffer = audioBuffers.get(scene.id);
                 if (buffer) duration = buffer.duration;
            }

            // Video Audio Track (Mixed into Narration or Full)
            if (type === 'full' && scene.type === 'video' && scene.videoUrl) {
                const vBuffer = videoAudioBuffers.get(scene.videoUrl);
                if (vBuffer) {
                    const source = passCtx.createBufferSource();
                    source.buffer = vBuffer;
                    
                    const gain = passCtx.createGain();
                    // Video Volume Control
                    gain.gain.value = scene.videoVolume ?? 1.0;
                    
                    source.connect(gain);
                    gain.connect(passCtx.destination);
                    
                    // Video Trimming Logic
                    const offset = scene.videoMediaStart || 0;
                    // Protect against buffer overrun
                    if (offset < vBuffer.duration) {
                        source.start(startTime, offset, Math.min(duration, vBuffer.duration - offset));
                    }
                }
            }

            // Narration (Coherent Flow or Standard)
            if ((type === 'narr' || type === 'full') && scene.audioUrl) {
                const buffer = audioBuffers.get(scene.id);
                if (buffer) {
                    const source = passCtx.createBufferSource();
                    source.buffer = buffer;
                    
                    const gain = passCtx.createGain();
                    const volume = project.narrationMasterVolume;
                    
                    source.connect(gain);
                    gain.connect(passCtx.destination);
                    
                    // Audio Offset Logic (Coherent Flow)
                    const offset = scene.mediaStart || 0;
                    
                    // De-clicking Envelope
                    gain.gain.setValueAtTime(0, startTime);
                    gain.gain.linearRampToValueAtTime(volume, startTime + 0.005);
                    gain.gain.setValueAtTime(volume, startTime + duration - 0.005);
                    gain.gain.linearRampToValueAtTime(0, startTime + duration);

                    // If timecoded (Coherent Flow), play specific segment
                    if (scene.mediaEnd && scene.mediaStart !== undefined) {
                        if (offset < buffer.duration) {
                            source.start(startTime, offset, Math.min(duration, buffer.duration - offset));
                        }
                    } else {
                        // Standard TTS
                        source.start(startTime);
                    }
                }
            }
            
            // SFX
            if (type === 'sfx' || type === 'full') {
                const sfxUrl = scene.sfxUrl || project.globalSfxUrl;
                if (sfxUrl) {
                    const buffer = sfxBuffers.get(sfxUrl);
                    if (buffer) {
                        const source = passCtx.createBufferSource();
                        source.buffer = buffer;
                        source.loop = true;
                        
                        const gain = passCtx.createGain();
                        const vol = (scene.sfxVolume ?? 0.2) * project.sfxMasterVolume;
                        
                        gain.gain.setValueAtTime(0, startTime);
                        gain.gain.linearRampToValueAtTime(vol, startTime + 0.05); 
                        gain.gain.setValueAtTime(vol, startTime + duration - 0.05);
                        gain.gain.linearRampToValueAtTime(0, startTime + duration);
                        
                        source.connect(gain);
                        gain.connect(passCtx.destination);
                        
                        source.start(startTime);
                        source.stop(startTime + duration);
                    }
                }
            }
        }
        
        // Music (Global Loop with FADE OUT)
        if ((type === 'music' || type === 'full') && musicBuffer && project.musicUrl) {
            const source = passCtx.createBufferSource();
            source.buffer = musicBuffer;
            source.loop = true;
            const gain = passCtx.createGain();
            
            // Initial Volume
            gain.gain.setValueAtTime(project.musicVolume, 0);
            
            // Fade Out at end
            const fadeStartTime = Math.max(0, totalDuration); 
            gain.gain.setValueAtTime(project.musicVolume, fadeStartTime);
            gain.gain.linearRampToValueAtTime(0, fadeStartTime + FADE_OUT_DURATION);
            
            source.connect(gain);
            gain.connect(passCtx.destination);
            source.start(0);
            source.stop(renderDuration);
        }
        
        const renderedBuffer = await passCtx.startRendering();
        return bufferToWav(renderedBuffer);
    };
    
    // Cleanup temporary context if possible (though browser manages GC usually)
    try { if (decodingCtx.state !== 'closed') await decodingCtx.close(); } catch(e) {}

    return {
        narration: await renderPass('narr'),
        sfx: await renderPass('sfx'),
        music: await renderPass('music'),
        fullMix: await renderPass('full')
    };
};

// WAV Header Construction
export const bufferToWav = (buffer: AudioBuffer): Blob => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArr = new ArrayBuffer(length);
    const view = new DataView(bufferArr);
    const channels = [];
    let i;
    let sample;
    let offset = 0;
    
    // Header cursor
    let pos = 0;

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded in this case)

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // write interleaved data
    for(i = 0; i < buffer.numberOfChannels; i++)
        channels.push(buffer.getChannelData(i));

    // Reset sample cursor, keep offset for buffer writing
    let sampleIdx = 0;
    
    while(sampleIdx < buffer.length) {
        for(i = 0; i < numOfChan; i++) {
            // clamp
            sample = Math.max(-1, Math.min(1, channels[i][sampleIdx])); 
            // scale to 16-bit signed int
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
            view.setInt16(44 + offset, sample, true); 
            offset += 2;
        }
        sampleIdx++;
    }

    return new Blob([bufferArr], { type: "audio/wav" });

    function setUint16(data: number) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data: number) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}
