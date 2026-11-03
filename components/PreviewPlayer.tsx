
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProjectState, Scene, HandOption, Resolution, ExportOptions } from '../types';
import { Play, Pause, SkipBack, SkipForward, Download, Loader2, Volume2, VolumeX, AlertTriangle, Film, Settings2, RotateCcw, Power, Square, RefreshCw, CheckSquare, Square as SquareIcon, FileAudio, MonitorOff, Search, ArrowRightCircle, Cpu, LayoutGrid, ArrowLeft, FileText, Image as ImageIcon, Archive, ArrowRight, Maximize, Clock, PlayCircle, PauseCircle, MonitorPlay, X } from 'lucide-react';
import { renderOfflineAudio } from '../services/audioExport';
import { GOLPO_CANVAS, GOLPO_TIMING } from '../services/golpoStyle';
import { exportScriptToText, exportPromptsToText, exportProjectToZip } from '../services/projectExport';

// Default hands + logic to find them
const DEFAULT_HANDS: HandOption[] = [
    { id: 'no-hand', name: 'No Hand', category: 'None', src: '', tipOffset: {x: 0.5, y: 0.5}, scale: 1.0 },
];

const easeOutCubic = (t: number): number => {
  return 1 - Math.pow(1 - t, 3);
};

interface Props {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
}

interface DrawPoint {
    x: number;
    y: number;
    isJump: boolean;
}

// Helper interface for raw pixel data with color
interface RawPoint {
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
}


// Element boundaries (pen lifts) per path, cached so the 30fps loop does no extra work.
const elementStartsCache = new WeakMap<DrawPoint[], number[]>();
const getElementStarts = (path: DrawPoint[]): number[] => {
    let starts = elementStartsCache.get(path);
    if (!starts) {
        starts = [];
        for (let i = 0; i < path.length; i++) if (i === 0 || path[i].isJump) starts.push(i);
        elementStartsCache.set(path, starts);
    }
    return starts;
};

/**
 * Golpo sequential reveal: maps scene progress to a path index so that elements are drawn
 * one at a time, each getting a time slice that blends equal-per-element (Golpo's ~0.8s
 * per stroke feel) with its point count (so big shapes are not rushed).
 */
const progressToPathIndex = (path: DrawPoint[], progress: number): number => {
    const n = path.length;
    if (n === 0) return 0;
    const p = Math.min(1, Math.max(0, progress));
    if (p >= 1) return n - 1;
    const starts = getElementStarts(path);
    const count = starts.length;
    if (count <= 1) return Math.floor((n - 1) * p);
    // Weight = 0.5 * equal share + 0.5 * size share
    let acc = 0;
    for (let e = 0; e < count; e++) {
        const s = starts[e];
        const end = e + 1 < count ? starts[e + 1] : n;
        const w = 0.5 / count + 0.5 * ((end - s) / n);
        if (p < acc + w || e === count - 1) {
            const local = Math.min(1, Math.max(0, (p - acc) / w));
            // ease-in-out within a stroke, like a hand accelerating then settling
            const eased = local < 0.5 ? 2 * local * local : 1 - Math.pow(-2 * local + 2, 2) / 2;
            return Math.min(n - 1, s + Math.floor((end - 1 - s) * eased));
        }
        acc += w;
    }
    return n - 1;
};

type PlayerState = "IDLE" | "PREPARING" | "PLAYING" | "EXPORTING" | "COMPLETED" | "ERROR";

// Helper to reliably parse Data URIs into ArrayBuffers without fetch
const parseDataURI = (dataURI: string): ArrayBuffer | null => {
    try {
        const split = dataURI.split(',');
        if (split.length < 2) return null;
        const base64 = split[1];
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    } catch (e) {
        console.error("Failed to parse Data URI manually", e);
        return null;
    }
};

const PreviewPlayer: React.FC<Props> = ({ project, setProject }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [renderMessage, setRenderMessage] = useState<string>("");
  const [exportProgress, setExportProgress] = useState(0); // 0-100
  const [jumpToSceneNum, setJumpToSceneNum] = useState("");
  
  // Export Options UI State - Default to TRUE as requested
  const [showExportMenu, setShowExportMenu] = useState(true);
  const [exportOpts, setExportOpts] = useState<ExportOptions>(project.exportOptions || {
      includeVideo: true,
      includeNarration: false,
      includeSfx: false,
      includeMusic: false,
      includeCaptions: false
  });
  
  // Range Inputs Local State
  const [localStartScene, setLocalStartScene] = useState(project.exportStartScene || 1);
  const [localEndScene, setLocalEndScene] = useState(project.exportEndScene || project.scenes.length);
  
  // Ref to hold the range values for the loop closure
  const exportRangeRef = useRef({ start: localStartScene, end: localEndScene });
  useEffect(() => {
      exportRangeRef.current = { start: localStartScene, end: localEndScene };
  }, [localStartScene, localEndScene]);

  // Sync inputs with project IF exportEndScene is undefined (meaning use full length)
  // OR if project changes. This fixes the issue where added cards aren't included in export.
  useEffect(() => {
      if (project.exportEndScene === undefined) {
          // If no explicit end scene set in project, always sync to current length
          setLocalEndScene(project.scenes.length);
      } else {
          // Otherwise respect the saved project setting (but cap at current length just in case)
          setLocalEndScene(Math.min(project.exportEndScene, project.scenes.length));
      }
      
      if (project.exportStartScene !== undefined) {
          setLocalStartScene(project.exportStartScene);
      }
  }, [project.scenes.length, project.exportEndScene, project.exportStartScene]);

  // SYNC ACTIVE SCENE NUMBER IN HEADER
  useEffect(() => {
      setJumpToSceneNum((currentSceneIndex + 1).toString());
  }, [currentSceneIndex]);
  
  // Keep export options in ref for the loop to access without staleness
  const exportOptsRef = useRef(exportOpts);
  useEffect(() => { exportOptsRef.current = exportOpts; }, [exportOpts]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const jumpInputRef = useRef<HTMLInputElement>(null);
  
  // Offscreen Mask & Path Logic
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // NEW: Offscreen Reveal Buffer for Blend Modes
  const revealBufferRef = useRef<HTMLCanvasElement | null>(null); 
  
  const brushTipRef = useRef<HTMLCanvasElement | null>(null); // Brush Tip Texture
  const drawingPathRef = useRef<DrawPoint[]>([]);
  const lastDrawnPointIndexRef = useRef<number>(0);
  
  // Export Specific Refs (The Ghost Pipeline)
  const exportCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const exportMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // NEW: Export Reveal Buffer
  const exportRevealBufferRef = useRef<HTMLCanvasElement | null>(null);
  
  const scenesRenderedCountRef = useRef(0);
  
  // Animation Refs
  const animationFrameRef = useRef<number>(0);
  const startTimeRef = useRef<number | null>(null);
  const sceneProgressRef = useRef<number>(0);
  const currentTipPosRef = useRef<{x: number, y: number} | null>(null);
  
  // Reference to latest project state for Loop
  const projectRef = useRef(project);

  // CRITICAL: Track Scene Index in Ref for Engine Loop / Polling
  const currentSceneIndexRef = useRef(currentSceneIndex);
  useEffect(() => { currentSceneIndexRef.current = currentSceneIndex; }, [currentSceneIndex]);
  
  // Audio / Media Context
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activePlaybackIdRef = useRef<number>(0); // Prevents audio overlap race conditions
  
  // Audio Mixing Nodes
  const narrationGainRef = useRef<GainNode | null>(null);
  const sfxGainRef = useRef<GainNode | null>(null);
  const musicGainRef = useRef<GainNode | null>(null); 
  const globalMasterGainRef = useRef<GainNode | null>(null);
  const speakerGainRef = useRef<GainNode | null>(null); 
  
  // Video Audio Routing Ref
  const videoMasterGainRef = useRef<GainNode | null>(null); // New Gain Node for Videos

  // Store original volumes for restore after export
  const originalVolumesRef = useRef<{narr: number, sfx: number, music: number}>({narr: 1, sfx: 1, music: 0.5});

  // SFX Refs
  const sfxSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const sfxIsPlayingRef = useRef(false);

  // Music Refs
  const musicSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const musicBufferRef = useRef<AudioBuffer | null>(null);
  const isMusicPlayingRef = useRef(false);

  // Media Recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // Export Safety & Readiness State
  const playerStateRef = useRef<PlayerState>("IDLE");
  const isImageLoadedRef = useRef(false);
  const isMaskReadyRef = useRef(false);
  const isPathsReadyRef = useRef(false);
  const isCanvasReadyRef = useRef(false);
  const recorderStartedRef = useRef(false);
  const pollerRef = useRef<number | null>(null);

  // Assets
  const handImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const currentImageRef = useRef<HTMLImageElement | null>(null);
  const currentBackgroundRef = useRef<HTMLImageElement | null>(null); // Current BG Image
  
  const audioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const sfxBuffersCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  
  // NEW: Shared URL Buffer Cache to avoid re-downloading master files
  const sharedAudioCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  
  // VIDEO REFERENCES & AUDIO ROUTING
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const videoMediaNodesMapRef = useRef<Map<string, MediaElementAudioSourceNode>>(new Map());

  // Track loaded URLs to detect changes
  const loadedAudioUrlsRef = useRef<Map<string, string>>(new Map());

  // Config - Derived from projectRef in loop, but here for initial setup
  const allHands = [...DEFAULT_HANDS, ...project.customHands];
  
  const getCurrentHand = () => {
      // ALWAYS use projectRef to avoid stale closure issues in animation loop
      const p = projectRef.current;
      const allHandsRef = [...DEFAULT_HANDS, ...p.customHands];
      const idx = currentSceneIndexRef.current;
      const scene = p.scenes[idx];
      if (scene?.handId) return allHandsRef.find(h => h.id === scene.handId) || allHandsRef[0];
      return allHandsRef.find(h => h.id === p.selectedHandId) || allHandsRef[0];
  };

  const isVertical = project.aspectRatio === '9:16';
  const LOGICAL_W = isVertical ? GOLPO_CANVAS.height : GOLPO_CANVAS.width;
  const LOGICAL_H = isVertical ? GOLPO_CANVAS.width : GOLPO_CANVAS.height;

  /**
   * Golpo-style pacing: the drawing must finish GOLPO_TIMING.holdSec before the scene
   * ends so the completed doodle holds on screen, and every element (stroke group
   * between pen lifts) gets at least ~strokeDrawSec, drawn strictly one after another.
   */
  const getDrawingDuration = (sceneDurationMs: number, pace: number, path: DrawPoint[]) => {
      const holdMs = GOLPO_TIMING.holdSec * 1000;
      let elements = 0;
      for (let i = 0; i < path.length; i++) if (i === 0 || path[i].isJump) elements++;
      const perElementMs = (GOLPO_TIMING.strokeDrawSec * 1000) / Math.max(0.1, pace);
      // Clamp the per-element budget so very busy images still finish in the scene.
      const available = Math.max(500, sceneDurationMs - holdMs);
      const ideal = Math.max(1, elements) * perElementMs;
      return Math.max(500, Math.min(available, Math.max(available * 0.6, Math.min(ideal, available))));
  };

  const allReady = () => isImageLoadedRef.current && isMaskReadyRef.current && isPathsReadyRef.current && isCanvasReadyRef.current;

  // Stop All Loops Helper
  const stopAllLoops = useCallback(() => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (pollerRef.current) clearInterval(pollerRef.current);
      pollerRef.current = null;
      animationFrameRef.current = 0;
  }, []);

  // Stop Audio Helpers
  const stopAudio = () => { if (audioSourceRef.current) { try { audioSourceRef.current.stop(); } catch(e) {} audioSourceRef.current = null; } };
  const stopSfx = () => { if (sfxSourceRef.current) { try { sfxSourceRef.current.stop(); } catch(e) {} sfxSourceRef.current = null; } sfxIsPlayingRef.current = false; };
  const stopMusic = () => { if (musicSourceRef.current) { try { musicSourceRef.current.stop(); } catch(e) {} musicSourceRef.current = null; } isMusicPlayingRef.current = false; };

  // FINISH EXPORT (Early Definition)
  const finishExport = useCallback(() => {
      setIsExporting(false);
      setRenderMessage("");
      playerStateRef.current = "IDLE";
      stopAllLoops();
      
      if (recorderStartedRef.current && mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          mediaRecorderRef.current.stop();
      }
      
      // Clean up
      if (destNodeRef.current) destNodeRef.current.disconnect();
      
      // Restore volumes
      if (narrationGainRef.current) narrationGainRef.current.gain.value = originalVolumesRef.current.narr;
      if (sfxGainRef.current) sfxGainRef.current.gain.value = originalVolumesRef.current.sfx;
      if (musicGainRef.current) musicGainRef.current.gain.value = originalVolumesRef.current.music;
      if (speakerGainRef.current) speakerGainRef.current.gain.value = 1.0;
      
      // Reset index to start of selection (using ref for safety)
      setCurrentSceneIndex((exportRangeRef.current.start || 1) - 1);
      setIsPlaying(false);
  }, [stopAllLoops]);

  // KEYBOARD SHORTCUTS
  useEffect(() => {
      const handleShortcut = (e: KeyboardEvent) => {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

          if (e.code === 'Space') {
              e.preventDefault();
              togglePlay();
          }
          if (e.key.toLowerCase() === 's') {
              e.preventDefault();
              jumpInputRef.current?.focus();
          }
      };
      window.addEventListener('keydown', handleShortcut);
      return () => window.removeEventListener('keydown', handleShortcut);
  }, [isPlaying]); // Added dependency to ensure togglePlay has correct state

  const togglePlay = () => {
      if (playerStateRef.current === "PLAYING") {
          setIsPlaying(false);
      } else {
          startPlayback();
      }
  };

  useEffect(() => {
      projectRef.current = project;
      if (playerStateRef.current !== "EXPORTING" && playerStateRef.current !== "PREPARING") {
          if (narrationGainRef.current) narrationGainRef.current.gain.value = project.narrationMasterVolume ?? 1.0;
          if (sfxGainRef.current) sfxGainRef.current.gain.value = project.sfxMasterVolume ?? 1.0;
          if (musicGainRef.current) musicGainRef.current.gain.value = project.musicVolume ?? 0.5;
          if (globalMasterGainRef.current) globalMasterGainRef.current.gain.value = project.masterVolume ?? 1.0;
      }
  }, [project]);

  // HANDLE AUTO PLAY (Fix: Play specific card range correctly)
  useEffect(() => {
      if (project.shouldAutoPlay) {
          setProject(prev => ({ ...prev, shouldAutoPlay: false })); 
          // Sync local range to project settings immediately to ensure visual match
          if (project.exportStartScene) setLocalStartScene(project.exportStartScene);
          if (project.exportEndScene) setLocalEndScene(project.exportEndScene);
          
          setCurrentSceneIndex((project.exportStartScene || 1) - 1); 
          setTimeout(() => startPlayback(), 100); 
      }
  }, [project.shouldAutoPlay]);

  useEffect(() => {
      if (project.isAutoExporting && playerStateRef.current === "IDLE" && !isPlaying) {
           handleExportOrchestrator();
      }
  }, [project.isAutoExporting]);

  useEffect(() => {
      allHands.forEach(hand => {
          if (hand.category !== 'None' && hand.src && !handImagesRef.current.has(hand.id)) {
              const img = new Image();
              if (!hand.src.startsWith('data:')) img.crossOrigin = "anonymous";
              img.src = hand.src;
              handImagesRef.current.set(hand.id, img);
          }
      });
  }, [allHands]);

  // --- OPTIMIZED AUDIO INITIALIZATION FOR DATA URIS ---
  useEffect(() => {
      const initAudio = async () => {
          if (!audioContextRef.current) {
              const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
              audioContextRef.current = ctx;
              
              globalMasterGainRef.current = ctx.createGain();
              narrationGainRef.current = ctx.createGain();
              sfxGainRef.current = ctx.createGain();
              musicGainRef.current = ctx.createGain();
              videoMasterGainRef.current = ctx.createGain(); // New Gain for Video routing
              speakerGainRef.current = ctx.createGain();
              
              const compressor = ctx.createDynamicsCompressor();
              compressor.threshold.value = -2;
              compressor.knee.value = 30;
              compressor.ratio.value = 12;
              compressor.attack.value = 0.003;
              compressor.release.value = 0.25;

              narrationGainRef.current.connect(globalMasterGainRef.current);
              sfxGainRef.current.connect(globalMasterGainRef.current);
              musicGainRef.current.connect(globalMasterGainRef.current);
              videoMasterGainRef.current.connect(globalMasterGainRef.current); // Connect Video Mix to Master
              
              globalMasterGainRef.current.connect(compressor);
              compressor.connect(speakerGainRef.current);
              speakerGainRef.current.connect(ctx.destination);
              
              narrationGainRef.current.gain.value = project.narrationMasterVolume ?? 1.0;
              sfxGainRef.current.gain.value = project.sfxMasterVolume ?? 1.0;
              musicGainRef.current.gain.value = project.musicVolume ?? 0.5;
              videoMasterGainRef.current.gain.value = 1.0; // Default Full volume for video mix
              globalMasterGainRef.current.gain.value = project.masterVolume ?? 1.0;
              speakerGainRef.current.gain.value = 1.0;
          }
          const ctx = audioContextRef.current;
          if (ctx.state === 'suspended') await ctx.resume().catch(console.error);
          if (ctx.state === 'running') setAudioUnlocked(true);
          else setAudioUnlocked(false);

          // 1. Load Background Music
          if (project.musicUrl) {
              try {
                  // Try manual parse first if Data URI to be robust
                  let arrayBuffer: ArrayBuffer | null = null;
                  if (project.musicUrl.startsWith('data:')) {
                      arrayBuffer = parseDataURI(project.musicUrl);
                  }
                  
                  if (!arrayBuffer) {
                      const response = await fetch(project.musicUrl);
                      arrayBuffer = await response.arrayBuffer();
                  }
                  
                  if (arrayBuffer) {
                      musicBufferRef.current = await ctx.decodeAudioData(arrayBuffer);
                  }
              } catch (e) {
                  console.warn("Failed to load music", e);
              }
          } else {
              musicBufferRef.current = null;
          }

          // 2. Load Scene Audio
          for (const scene of project.scenes) {
              const currentUrl = scene.audioUrl;
              const loadedUrl = loadedAudioUrlsRef.current.get(scene.id);
              
              // Only load if URL changed or not loaded yet
              if (currentUrl && (currentUrl !== loadedUrl || !audioBuffersRef.current.has(scene.id))) {
                  // Check shared cache first
                  if (sharedAudioCacheRef.current.has(currentUrl)) {
                      const cachedBuffer = sharedAudioCacheRef.current.get(currentUrl);
                      if (cachedBuffer) {
                          audioBuffersRef.current.set(scene.id, cachedBuffer);
                          loadedAudioUrlsRef.current.set(scene.id, currentUrl);
                          continue; 
                      }
                  }
                  
                  try {
                      let arrayBuffer: ArrayBuffer | null = null;
                      if (currentUrl.startsWith('data:')) {
                          arrayBuffer = parseDataURI(currentUrl);
                      }
                      
                      // Fallback to fetch if parse failed or not data URI
                      if (!arrayBuffer) {
                          const response = await fetch(currentUrl);
                          if (!response.ok) throw new Error(`Status ${response.status}`);
                          arrayBuffer = await response.arrayBuffer();
                      }

                      if (arrayBuffer) {
                          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                          sharedAudioCacheRef.current.set(currentUrl, audioBuffer);
                          audioBuffersRef.current.set(scene.id, audioBuffer);
                          loadedAudioUrlsRef.current.set(scene.id, currentUrl);
                      }
                  } catch (e) {
                      console.warn(`Failed to load audio for scene ${scene.number}`, e);
                  }
              }
              
              // Load Video Elements
              if (scene.type === 'video' && scene.videoUrl) {
                  if (!videoRefs.current.has(scene.id) || videoRefs.current.get(scene.id)?.src !== scene.videoUrl) {
                       const video = document.createElement('video');
                       video.src = scene.videoUrl;
                       video.preload = 'auto';
                       video.muted = false; // Must be false to emit audio
                       video.playsInline = true;
                       video.crossOrigin = "anonymous"; 
                       videoRefs.current.set(scene.id, video);
                       
                       if (ctx && videoMasterGainRef.current) {
                           try {
                               if (!videoMediaNodesMapRef.current.has(scene.id)) {
                                   const sourceNode = ctx.createMediaElementSource(video);
                                   sourceNode.connect(videoMasterGainRef.current);
                                   videoMediaNodesMapRef.current.set(scene.id, sourceNode);
                               }
                           } catch (err) {}
                       }
                  }
              }
          }
          
          // 3. Load Global SFX
          if (project.globalSfxUrl && !sfxBuffersCacheRef.current.has(project.globalSfxUrl)) {
              try {
                  let ab: ArrayBuffer | null = null;
                  if (project.globalSfxUrl.startsWith('data:')) {
                      ab = parseDataURI(project.globalSfxUrl);
                  }
                  if (!ab) {
                      const response = await fetch(project.globalSfxUrl);
                      ab = await response.arrayBuffer();
                  }
                  if (ab) {
                      const buff = await ctx.decodeAudioData(ab);
                      sfxBuffersCacheRef.current.set(project.globalSfxUrl, buff);
                  }
              } catch(e) {}
          }
      };
      initAudio();
  }, [project.scenes, project.globalSfxUrl, project.musicUrl]);

  useEffect(() => {
      return () => {
          stopAllLoops();
          stopAudio();
          stopSfx();
          stopMusic();
          playerStateRef.current = "IDLE";
          // Close (not just suspend) so the AudioContext and its media nodes are released on unmount.
          if (audioContextRef.current) {
              const ctx = audioContextRef.current;
              audioContextRef.current = null;
              videoMediaNodesMapRef.current.clear();
              ctx.close().catch(() => {});
          }
      }
  }, []);

  useEffect(() => {
    const mask = document.createElement('canvas');
    mask.width = LOGICAL_W;
    mask.height = LOGICAL_H;
    maskCanvasRef.current = mask;
    
    const reveal = document.createElement('canvas');
    reveal.width = LOGICAL_W;
    reveal.height = LOGICAL_H;
    revealBufferRef.current = reveal;

    const brushSize = 32; 
    const brush = document.createElement('canvas');
    brush.width = brushSize;
    brush.height = brushSize;
    const bCtx = brush.getContext('2d');
    if (bCtx) {
        bCtx.fillStyle = 'rgba(0,0,0,1)';
        bCtx.beginPath();
        bCtx.rect(4, 4, brushSize - 8, brushSize - 8);
        bCtx.fill();
        const idata = bCtx.getImageData(0,0,brushSize,brushSize);
        const data = idata.data;
        for(let i=0; i<data.length; i+=4) {
            const alpha = data[i+3];
            if (alpha > 0) {
                if (Math.random() > 0.6) data[i+3] = Math.floor(Math.random() * 200);
                if (Math.random() > 0.9) data[i+3] = 0;
            }
        }
        bCtx.putImageData(idata, 0, 0);
    }
    brushTipRef.current = brush;
    isMaskReadyRef.current = true;
    isCanvasReadyRef.current = true;
  }, [LOGICAL_W, LOGICAL_H]);

  const ensureAudioUnlocked = async () => {
      if (audioContextRef.current) {
          try {
             if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
          } catch(e){}
          if (audioContextRef.current.state === 'running') setAudioUnlocked(true);
      }
  };

  const handleResetEngine = () => {
      stopAllLoops();
      stopAudio();
      stopSfx();
      stopMusic();
      setIsPlaying(false);
      setIsExporting(false);
      playerStateRef.current = "IDLE";
      sceneProgressRef.current = 0;
      lastDrawnPointIndexRef.current = 0;
      currentTipPosRef.current = null;
      startTimeRef.current = null;
      setExportProgress(0);
      
      if (narrationGainRef.current) narrationGainRef.current.gain.value = project.narrationMasterVolume ?? 1.0;
      if (sfxGainRef.current) sfxGainRef.current.gain.value = project.sfxMasterVolume ?? 1.0;
      if (musicGainRef.current) musicGainRef.current.gain.value = project.musicVolume ?? 0.5;
      if (speakerGainRef.current) speakerGainRef.current.gain.value = 1.0;
      
      if (maskCanvasRef.current) maskCanvasRef.current.getContext('2d')?.clearRect(0,0,maskCanvasRef.current.width,maskCanvasRef.current.height);
      if (exportMaskCanvasRef.current) exportMaskCanvasRef.current.getContext('2d')?.clearRect(0,0,exportMaskCanvasRef.current.width,exportMaskCanvasRef.current.height);
      if (revealBufferRef.current) revealBufferRef.current.getContext('2d')?.clearRect(0,0,revealBufferRef.current.width,revealBufferRef.current.height);
      
      drawFrame(0, 0);
  };

  // ... (Path generation functions omitted for brevity, assume same) ...
  const generateClusterSketchPath = (points: {x: number, y: number}[]) => {
      if (points.length === 0) return [{x: LOGICAL_W/2, y: LOGICAL_H/2, isJump: false}];
      const CLUSTER_SIZE = 40; 
      const clusters: Record<string, {x:number, y:number}[]> = {};
      points.forEach(p => {
          const cx = Math.floor(p.x / CLUSTER_SIZE);
          const cy = Math.floor(p.y / CLUSTER_SIZE);
          const key = `${cx},${cy}`;
          if (!clusters[key]) clusters[key] = [];
          clusters[key].push(p);
      });
      const clusterKeys = Object.keys(clusters);
      if (clusterKeys.length === 0) return points.map(p => ({...p, isJump: false}));
      const finalPath: DrawPoint[] = [];
      const visitedClusters = new Set<string>();
      let currentKey = clusterKeys[0];
      let minStartDist = Infinity;
      const center = { x: LOGICAL_W/2, y: LOGICAL_H/2 };
      clusterKeys.forEach(key => {
           const [nx, ny] = key.split(',').map(Number);
           const dist = Math.hypot((nx*CLUSTER_SIZE) - center.x, (ny*CLUSTER_SIZE) - center.y);
           if (dist < minStartDist) { minStartDist = dist; currentKey = key; }
      });
      while(visitedClusters.size < clusterKeys.length) {
          visitedClusters.add(currentKey);
          const clusterPoints = clusters[currentKey];
          const fillStrategy = Math.floor(Math.random() * 4);
          if (fillStrategy === 0) clusterPoints.sort((a,b) => a.y - b.y || a.x - b.x);
          else if (fillStrategy === 1) clusterPoints.sort((a,b) => a.x - b.x || a.y - b.y);
          else clusterPoints.sort((a,b) => (a.x + a.y) - (b.x + b.y));
          
          if (clusterPoints.length > 0) {
              finalPath.push({ x: clusterPoints[0].x, y: clusterPoints[0].y, isJump: true });
              for(let i=1; i<clusterPoints.length; i++) {
                  const prev = clusterPoints[i-1];
                  const curr = clusterPoints[i];
                  if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > 2) finalPath.push({ ...curr, isJump: false });
              }
          }
          const [cx, cy] = currentKey.split(',').map(Number);
          const currentCenter = { x: (cx * CLUSTER_SIZE), y: (cy * CLUSTER_SIZE) };
          const unvisitedNeighbors = [];
          for (const key of clusterKeys) {
              if (!visitedClusters.has(key)) {
                  const [nx, ny] = key.split(',').map(Number);
                  const nextCenter = { x: (nx * CLUSTER_SIZE), y: (ny * CLUSTER_SIZE) };
                  const dist = Math.hypot(nextCenter.x - currentCenter.x, nextCenter.y - currentCenter.y);
                  unvisitedNeighbors.push({ key, dist });
              }
          }
          if (unvisitedNeighbors.length === 0) break;
          unvisitedNeighbors.sort((a,b) => a.dist - b.dist);
          currentKey = unvisitedNeighbors[Math.floor(Math.random() * Math.min(5, unvisitedNeighbors.length))].key;
      }
      return finalPath;
  };

  const generatePath = (img: HTMLImageElement): DrawPoint[] => {
      const p = projectRef.current;
      const sampleW = 100; 
      const sampleH = Math.floor(LOGICAL_H * (sampleW / LOGICAL_W));
      const c = document.createElement('canvas');
      c.width = sampleW; c.height = sampleH;
      const ctx = c.getContext('2d');
      if(!ctx) return [];
      ctx.drawImage(img, 0, 0, sampleW, sampleH);
      const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
      
      let allPoints: RawPoint[] = [];
      for(let y=0; y<sampleH; y++) {
          for(let x=0; x<sampleW; x++) {
              const idx = (y * sampleW + x) * 4;
              const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
              const brightness = (r+g+b)/3;
              if(brightness < 250 && a > 20) { 
                  allPoints.push({ 
                      x: (x / sampleW) * LOGICAL_W, 
                      y: (y / sampleH) * LOGICAL_H,
                      r, g, b
                  });
              }
          }
      }

      if (allPoints.length < 10) {
           let fallback = [];
           for(let i=0; i<360; i+=10) {
               const rad = i * Math.PI / 180;
               fallback.push({ x: LOGICAL_W/2 + Math.cos(rad) * i/2, y: LOGICAL_H/2 + Math.sin(rad) * i/2 });
           }
           return fallback.map(p => ({...p, isJump: false}));
      }

      let textPath: DrawPoint[] = [];
      let bodyPoints = [...allPoints];

      if (p.textFirst) {
          const textZoneHeight = LOGICAL_H * 0.25;
          const textZonePoints = allPoints.filter(p => p.y < textZoneHeight);
          bodyPoints = allPoints.filter(p => p.y >= textZoneHeight);
          
          if (textZonePoints.length > 0) {
              textZonePoints.sort((a, b) => {
                  const rowHeight = 15;
                  const rowA = Math.floor(a.y / rowHeight);
                  const rowB = Math.floor(b.y / rowHeight);
                  if (rowA !== rowB) return rowA - rowB;
                  return a.x - b.x;
              });
              
              textPath = textZonePoints.map((p, i) => {
                  const prev = i > 0 ? textZonePoints[i-1] : null;
                  const dist = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0;
                  return {
                      x: p.x, y: p.y,
                      isJump: !prev || dist > 20 
                  };
              });
          }
      }

      let finalBodyPath: DrawPoint[] = [];
      
      if (p.outlinesFirst) {
          const outlines = bodyPoints.filter(p => (0.299*p.r + 0.587*p.g + 0.114*p.b) < 128);
          const fills = bodyPoints.filter(p => (0.299*p.r + 0.587*p.g + 0.114*p.b) >= 128);
          
          const outlinePath = generateClusterSketchPath(outlines);
          const fillPath = generateClusterSketchPath(fills);
          
          const jumpToFills = fillPath.length > 0 ? [{ ...fillPath[0], isJump: true }] : [];
          const remainingFills = fillPath.slice(1);
          
          finalBodyPath = [...outlinePath, ...jumpToFills, ...remainingFills];
      } else {
          finalBodyPath = generateClusterSketchPath(bodyPoints);
      }

      const jumpToBody = finalBodyPath.length > 0 ? [{ ...finalBodyPath[0], isJump: true }] : [];
      const remainingBody = finalBodyPath.slice(1);
      
      return [...textPath, ...jumpToBody, ...remainingBody];
  };

  const startScenePlayback = useCallback(async () => {
        const p = projectRef.current; 
        const idx = currentSceneIndexRef.current; 
        const scene = p.scenes[idx];
        if(!scene) return;
        
        const playbackId = ++activePlaybackIdRef.current;

        if (scene.audioUrl && !audioBuffersRef.current.has(scene.id)) {
            if (sharedAudioCacheRef.current.has(scene.audioUrl)) {
                audioBuffersRef.current.set(scene.id, sharedAudioCacheRef.current.get(scene.audioUrl)!);
            } else {
                try {
                    let arrayBuffer: ArrayBuffer | null = null;
                    if (scene.audioUrl.startsWith('data:')) {
                        arrayBuffer = parseDataURI(scene.audioUrl);
                    }
                    if (!arrayBuffer) {
                        const response = await fetch(scene.audioUrl);
                        if (response.ok) arrayBuffer = await response.arrayBuffer();
                    }
                    
                    if (arrayBuffer && audioContextRef.current) {
                        const buff = await audioContextRef.current.decodeAudioData(arrayBuffer);
                        sharedAudioCacheRef.current.set(scene.audioUrl, buff);
                        audioBuffersRef.current.set(scene.id, buff);
                    }
                } catch(e) {}
            }
        }
        
        sceneProgressRef.current = 0;
        lastDrawnPointIndexRef.current = 0;
        currentTipPosRef.current = null;
        startTimeRef.current = null;
        
        const maskTarget = playerStateRef.current === "EXPORTING" ? exportMaskCanvasRef.current : maskCanvasRef.current;
        if (maskTarget) maskTarget.getContext('2d')?.clearRect(0, 0, maskTarget.width, maskTarget.height);
        
        if (p.isOfflineRender && playerStateRef.current === "PREPARING") return;

        const exportStart = exportRangeRef.current.start;
        const isFirstScene = idx === 0 || (playerStateRef.current === "EXPORTING" && idx === (exportStart - 1));
        
        if (isFirstScene) {
            stopMusic();
            if ((playerStateRef.current !== "IDLE") && p.musicUrl) startMusic();
        } else if ((playerStateRef.current !== "IDLE") && !isMusicPlayingRef.current && p.musicUrl) startMusic();
        
        // Hand entry delay check - do not start audio yet if in entry phase
        const isFirstScenePlayback = idx === (exportRangeRef.current.start - 1);
        const hasHandEntry = isFirstScenePlayback && scene.type !== 'video' && p.showHand;
        
        if (!hasHandEntry) {
             // Narration Playback (uses mediaStart/End for Coherent Flow offset)
             await playAudioForScene(scene.id, playbackId);
        }
        
        if (playbackId !== activePlaybackIdRef.current) {
            return;
        }
        
        // Video Playback (Concurrent)
        if (scene.type === 'video' && videoRefs.current.has(scene.id)) {
            const video = videoRefs.current.get(scene.id);
            if(video) {
                // Ensure audio isn't muted
                video.muted = false;
                // Set Volume based on scene setting * master
                if (videoMediaNodesMapRef.current.has(scene.id) && videoMasterGainRef.current) {
                    videoMasterGainRef.current.gain.value = scene.videoVolume ?? 1.0;
                }
                
                // Use videoMediaStart if available (seconds), or fallback to 0
                video.currentTime = scene.videoMediaStart || 0;
                video.play().catch(e => console.warn("Video play failed:", e));
            }
        }
        
        if (playerStateRef.current === "EXPORTING" && p.isOfflineRender && exportCanvasRef.current) {
            // @ts-ignore
            const stream = exportCanvasRef.current._capturedStream;
            const track = stream ? stream.getVideoTracks()[0] : null;
            offlineLoop(track);
        } else {
            loop();
        }
  }, []); 

  useEffect(() => {
    const scene = project.scenes[currentSceneIndex];
    if (!scene) return;
    
    stopAllLoops();
    stopAudio();
    stopSfx();
    videoRefs.current.forEach(v => v.pause());

    activePlaybackIdRef.current++; 

    sceneProgressRef.current = 0;
    lastDrawnPointIndexRef.current = 0;
    currentTipPosRef.current = null;
    startTimeRef.current = null;
    isImageLoadedRef.current = false;
    isPathsReadyRef.current = false;
    canvasRef.current?.getContext('2d')?.clearRect(0,0, canvasRef.current.width, canvasRef.current.height);
    
    currentBackgroundRef.current = null;
    const bgUrl = scene.backgroundUrl || 
        ((scene.enableGlobalBackground ?? true) && project.selectedBackgroundId ? project.customBackgrounds.find(b => b.id === project.selectedBackgroundId)?.src : null);
        
    if (bgUrl) {
        const bgImg = new Image();
        bgImg.src = bgUrl;
        currentBackgroundRef.current = bgImg;
    }

    if (scene.type === 'video') {
         isImageLoadedRef.current = true;
         isPathsReadyRef.current = true;
         isCanvasReadyRef.current = true;
         if (videoRefs.current.has(scene.id)) {
             const v = videoRefs.current.get(scene.id);
             if (v) v.currentTime = scene.videoMediaStart || 0;
         }
         if (playerStateRef.current === "IDLE") drawFrame(0, 0); 
         else startScenePlayback();
         return;
    }

    const onLoad = (img: HTMLImageElement | null) => {
        currentImageRef.current = img;
        drawingPathRef.current = img ? generatePath(img) : [];
        isImageLoadedRef.current = true;
        isPathsReadyRef.current = true;
        if (playerStateRef.current === "IDLE") drawFrame(0, 0); 
        else startScenePlayback();
    };

    if (scene.imageUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = scene.imageUrl;
        img.onload = () => onLoad(img);
        img.onerror = () => onLoad(null);
        if (img.complete) onLoad(img);
    } else {
        onLoad(null);
    }
  }, [currentSceneIndex, LOGICAL_W, LOGICAL_H, project.selectedBackgroundId, project.customBackgrounds]); 

  const startPlayback = async () => {
      const startIdx = project.scenes.findIndex((s, i) => i >= currentSceneIndex && !s.isDisabled);
      if (startIdx !== -1) {
          if (startIdx !== currentSceneIndex) {
              setCurrentSceneIndex(startIdx);
          } else {
              await ensureAudioUnlocked();
              setIsPlaying(true);
              playerStateRef.current = "PLAYING";
              if (allReady()) startScenePlayback();
          }
      } else {
          const firstEnabled = project.scenes.findIndex(s => !s.isDisabled);
          if (firstEnabled !== -1) {
              setCurrentSceneIndex(firstEnabled);
          } else {
              alert("No enabled scenes to play.");
          }
      }
  };

  useEffect(() => {
    if (!isPlaying && playerStateRef.current === "PLAYING") {
        playerStateRef.current = "IDLE";
        stopAllLoops();
        stopAudio();
        stopSfx();
        stopMusic();
        videoRefs.current.forEach(v => v.pause());
        activePlaybackIdRef.current++; 
    }
  }, [isPlaying]);

  const startSfx = (scene: Scene) => {
      const p = projectRef.current;
      const sfxUrl = scene.sfxUrl || p.globalSfxUrl;
      if (!sfxUrl || sfxIsPlayingRef.current) return;
      const buffer = sfxBuffersCacheRef.current.get(sfxUrl);
      if (buffer && audioContextRef.current && sfxGainRef.current) {
          const source = audioContextRef.current.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          source.connect(sfxGainRef.current);
          source.disconnect();
          const localGain = audioContextRef.current.createGain();
          localGain.gain.value = scene.sfxVolume !== undefined ? scene.sfxVolume : 0.2;
          source.connect(localGain);
          localGain.connect(sfxGainRef.current);
          source.start(0);
          sfxSourceRef.current = source;
          sfxIsPlayingRef.current = true;
      }
  };

  const startMusic = () => {
      if (musicBufferRef.current && audioContextRef.current && musicGainRef.current && !isMusicPlayingRef.current) {
          const source = audioContextRef.current.createBufferSource();
          source.buffer = musicBufferRef.current;
          source.loop = true;
          source.connect(musicGainRef.current);
          source.start(0);
          musicSourceRef.current = source;
          isMusicPlayingRef.current = true;
      }
  };

  const playAudioForScene = async (sceneId: string, playbackId: number) => {
      stopAudio();
      await ensureAudioUnlocked();
      
      if (playbackId !== activePlaybackIdRef.current) return;
      
      const buffer = audioBuffersRef.current.get(sceneId);
      if (buffer && audioContextRef.current && narrationGainRef.current) {
          const scene = projectRef.current.scenes.find(s => s.id === sceneId);
          const source = audioContextRef.current.createBufferSource();
          source.buffer = buffer;
          
          const localGain = audioContextRef.current.createGain();
          source.connect(localGain);
          localGain.connect(narrationGainRef.current);
          
          const now = audioContextRef.current.currentTime;
          
          // Use mediaStart/End for Narration trimming (Coherent Flow uses this)
          const offset = scene?.mediaStart || 0;
          let duration = undefined;
          
          if (scene?.mediaEnd && scene.mediaStart !== undefined) {
              duration = scene.mediaEnd - scene.mediaStart;
          }
          
          localGain.gain.setValueAtTime(0, now);
          localGain.gain.linearRampToValueAtTime(1, now + 0.01);
          
          if (duration !== undefined) {
              source.start(0, offset, duration);
              localGain.gain.setValueAtTime(1, now + duration - 0.01);
              localGain.gain.linearRampToValueAtTime(0, now + duration);
          } else {
              source.start(0, offset);
          }
          
          audioSourceRef.current = source;
      }
  };

  const getSceneDuration = (idx = currentSceneIndexRef.current) => {
      const scene = projectRef.current.scenes[idx];
      if (!scene) return 4000;

      if (scene.type === 'video' && (scene.videoDuration || scene.videoMediaEnd)) {
          const start = scene.videoMediaStart || 0;
          const end = scene.videoMediaEnd || scene.videoDuration || 0;
          // Ensure positive duration
          const duration = Math.max(0, end - start);
          return duration > 0 ? duration * 1000 : 4000;
      }
      
      if (scene.mediaEnd && scene.mediaStart !== undefined) {
          return (scene.mediaEnd - scene.mediaStart) * 1000;
      }

      const buffer = audioBuffersRef.current.get(scene.id);
      if (buffer) return buffer.duration * 1000;

      const wordCount = scene.script ? scene.script.split(/\s+/).length : 0;
      if (wordCount < 10) return 3000;
      if (wordCount <= 15) return 4000;
      return 5000;
  };

  const offlineLoop = async (videoTrack?: any) => {
      if (!allReady()) { animationFrameRef.current = requestAnimationFrame(() => offlineLoop(videoTrack)); return; }
      if (!startTimeRef.current) startTimeRef.current = performance.now();
      
      const currentProject = projectRef.current; 
      const activeIndex = currentSceneIndexRef.current;

      if (playerStateRef.current === "EXPORTING") {
          const targetEndIndex = exportRangeRef.current.end - 1; 
          console.log(`OFFLINE RENDER: Scene ${activeIndex + 1}, Target End: ${targetEndIndex + 1}`);
          if (activeIndex > targetEndIndex) { finishExport(); return; }
      }

      const isFirstScene = activeIndex === (exportRangeRef.current.start - 1);
      const handEntryDuration = (isFirstScene && currentProject.showHand && currentProject.scenes[activeIndex].type !== 'video') ? 800 : 0;
      const step = 33.33; 

      // Render Hand Entry Frames
      if (handEntryDuration > 0) {
          let entryTime = 0;
          while (entryTime < handEntryDuration) {
              const t = entryTime / handEntryDuration;
              const eased = easeOutCubic(t);
              const path = drawingPathRef.current;
              const target = path.length > 0 ? path[0] : { x: LOGICAL_W/2, y: LOGICAL_H/2 };
              const start = { x: LOGICAL_W * 0.8, y: LOGICAL_H * 1.2 };
              
              const currentX = start.x + (target.x - start.x) * eased;
              const currentY = start.y + (target.y - start.y) * eased;
              
              drawFrame(0, 0, { x: currentX, y: currentY });
              
              if (videoTrack && videoTrack.requestFrame) {
                  try { videoTrack.requestFrame(); } catch(e) {}
              }
              
              const now = performance.now();
              // Simulating realtime delay in offline export not needed, just frame processing
              entryTime += step;
          }
      }

      let virtualElapsed = 0;
      const audioDuration = getSceneDuration(activeIndex);
      const pace = Math.max(0.1, currentProject.scenes[activeIndex]?.customPace || currentProject.drawingPace || 1.0);
      const drawingDuration = getDrawingDuration(audioDuration, pace, drawingPathRef.current);
      // Scene length is driven by narration; the hold is carved out of it (min hold guaranteed).
      const totalSceneDuration = Math.max(audioDuration, drawingDuration + GOLPO_TIMING.holdSec * 1000);
      
      let lastFrameTime = performance.now();
      
      while (virtualElapsed <= totalSceneDuration + 500) {
          if (playerStateRef.current !== "EXPORTING") break;
          drawFrame(Math.min(1, virtualElapsed / drawingDuration), virtualElapsed);
          
          if (videoTrack && videoTrack.requestFrame) {
              try { videoTrack.requestFrame(); } catch(e) {}
          }
          
          const now = performance.now();
          const waitTime = Math.max(0, step - (now - lastFrameTime));
          if (waitTime > 0) await new Promise(r => setTimeout(r, waitTime));
          
          lastFrameTime = performance.now();
          virtualElapsed += step;
      }
      
      drawFrame(1.0, totalSceneDuration);
      if (videoTrack && videoTrack.requestFrame) {
         try { videoTrack.requestFrame(); } catch(e) {}
      }
      handleSceneComplete();
  };

  const loop = () => {
      if (!allReady()) { animationFrameRef.current = requestAnimationFrame(loop); return; }
      const now = performance.now();
      if (!startTimeRef.current) startTimeRef.current = now;

      const currentProject = projectRef.current; 
      const activeIndex = currentSceneIndexRef.current;
      const scene = currentProject.scenes[activeIndex];
      
      // Determine End Index for Export vs Playback
      const targetEndIndex = playerStateRef.current === "EXPORTING" ? exportRangeRef.current.end - 1 : (currentProject.scenes.length - 1);

      // HAND ENTRY LOGIC
      const isFirstScene = activeIndex === (exportRangeRef.current.start - 1);
      const handEntryDuration = (isFirstScene && scene.type !== 'video' && currentProject.showHand) ? 800 : 0;
      const rawElapsed = now - startTimeRef.current;

      // Check for hand entry phase
      if (rawElapsed < handEntryDuration) {
          const entryProgress = rawElapsed / handEntryDuration;
          const eased = easeOutCubic(entryProgress);
          
          // Calculate Target (First point of path)
          const path = drawingPathRef.current;
          const target = path.length > 0 ? path[0] : { x: LOGICAL_W/2, y: LOGICAL_H/2 };
          
          // Calculate Start (Offscreen)
          const start = { x: LOGICAL_W * 0.8, y: LOGICAL_H * 1.2 }; // Bottom right approximation
          
          const currentX = start.x + (target.x - start.x) * eased;
          const currentY = start.y + (target.y - start.y) * eased;
          
          drawFrame(0, 0, { x: currentX, y: currentY });
          
          if (playerStateRef.current !== "IDLE") animationFrameRef.current = requestAnimationFrame(loop);
          return;
      }

      // Check if we need to start audio late (after entry duration)
      if (handEntryDuration > 0 && !audioSourceRef.current && playerStateRef.current === "PLAYING" && scene.type !== 'video') {
           // We passed the entry duration, start audio now
           // Use activePlaybackIdRef to ensure we are still valid
           playAudioForScene(scene.id, activePlaybackIdRef.current);
      }

      const elapsed = rawElapsed - handEntryDuration;

      if (playerStateRef.current === "EXPORTING") {
          console.log(`EXPORT LOOP: Active Index ${activeIndex}, Target End Index ${targetEndIndex}`);
          if (activeIndex > targetEndIndex) { finishExport(); return; }
          
          if (!currentProject.isOfflineRender && mediaRecorderRef.current?.stream) {
               const track = mediaRecorderRef.current.stream.getVideoTracks()[0];
               if(track && (track as any).requestFrame) (track as any).requestFrame();
          }
      }
      
      const audioDuration = getSceneDuration(activeIndex);
      const pace = Math.max(0.1, scene?.customPace || currentProject.drawingPace || 1.0);
      const drawingDuration = getDrawingDuration(audioDuration, pace, drawingPathRef.current);
      const visualProgress = Math.max(0, Math.min(1, elapsed / drawingDuration));
      sceneProgressRef.current = visualProgress;
      
      if (scene.type === 'video' && videoRefs.current.has(scene.id)) {
          const v = videoRefs.current.get(scene.id);
          if (v) {
               // Use videoMediaStart (seconds)
               const start = scene.videoMediaStart || 0;
               const end = scene.videoMediaEnd || scene.videoDuration || v.duration;
               
               // Sync loop
               if (v.currentTime < start || v.currentTime > end) {
                   v.currentTime = start + (elapsed / 1000); 
               }
          }
      }
      
      if (visualProgress >= 1) { if (sfxIsPlayingRef.current) stopSfx(); } 
      else if (visualProgress > 0 && !sfxIsPlayingRef.current && scene.type !== 'video') startSfx(scene);
      
      if (playerStateRef.current === "EXPORTING") {
          const start = exportRangeRef.current.start;
          const end = exportRangeRef.current.end;
          setExportProgress(Math.min(100, Math.floor(((scenesRenderedCountRef.current + visualProgress) / (end - start + 1)) * 100)));
          
          if (scene.number === end && (audioDuration - elapsed) < 2000 && musicGainRef.current) {
              musicGainRef.current.gain.value = ((audioDuration - elapsed) / 2000) * (currentProject.musicVolume ?? 0.5);
          }
      }

      drawFrame(visualProgress, elapsed);

      if (visualProgress >= 1 && elapsed >= Math.max(audioDuration, drawingDuration + GOLPO_TIMING.holdSec * 1000)) {
          drawFrame(1.0, elapsed);
          handleSceneComplete();
          return;
      }
      if (playerStateRef.current !== "IDLE") animationFrameRef.current = requestAnimationFrame(loop);
  };

  const handleSceneComplete = () => {
      stopAudio();
      stopSfx();
      const prevScene = projectRef.current.scenes[currentSceneIndexRef.current];
      if (prevScene && videoRefs.current.has(prevScene.id)) {
          videoRefs.current.get(prevScene.id)?.pause();
      }
      
      const currentProject = projectRef.current;
      const activeIndex = currentSceneIndexRef.current;

      // Find next enabled scene
      let nextIndex = activeIndex + 1;
      while (nextIndex < currentProject.scenes.length && currentProject.scenes[nextIndex].isDisabled) {
          nextIndex++;
      }

      const isExporting = (playerStateRef.current as string) === "EXPORTING";
      const targetEndIndex = isExporting ? (exportRangeRef.current.end - 1) : (currentProject.scenes.length - 1);

      if (isExporting) {
          scenesRenderedCountRef.current += 1;
          
          if (nextIndex >= currentProject.scenes.length || nextIndex > targetEndIndex || activeIndex >= targetEndIndex) { 
              finishExport(); 
              return; 
          }
          
          setTimeout(() => {
              setCurrentSceneIndex(nextIndex);
          }, 0);
          
      } else {
          // Normal Playback: Automatically continue if next scene exists
          if (nextIndex < currentProject.scenes.length) {
              setCurrentSceneIndex(nextIndex);
              // Ensure we stay in PLAYING state visually
              setIsPlaying(true);
          } else {
              // End of Project
              setIsPlaying(false); 
              sceneProgressRef.current = 1; 
              drawFrame(1, 0); 
              playerStateRef.current = "COMPLETED";
          }
      }
  };

  const handleBackToStoryboard = () => {
      setProject(prev => ({
          ...prev,
          currentStep: 'storyboard',
          // FIXED: Return to context of current scene index + 1 (human readable number)
          jumpToSceneOnMount: currentSceneIndex + 1
      }));
  };

  // ... (Remaining rendering functions: applyUnifiedTransform, updateMask, drawHandSynced, calculateCumulativeTime, drawFrame, etc. - assume they exist and are correct) ...
  const applyUnifiedTransform = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, logicalWidth: number) => {
      const scale = canvas.width / logicalWidth;
      ctx.scale(scale, scale);
  }

  const updateMask = (path: DrawPoint[], progress: number) => {
      const isExport = playerStateRef.current === "EXPORTING";
      const maskCtx = isExport ? exportMaskCanvasRef.current?.getContext('2d') : maskCanvasRef.current?.getContext('2d');
      const targetCanvas = isExport ? exportMaskCanvasRef.current : maskCanvasRef.current;
      const brush = brushTipRef.current;
      if (!maskCtx || !brush || !targetCanvas || path.length === 0) return;

      const safeProgress = Math.min(1, Math.max(0, progress));
      const targetIndex = progressToPathIndex(path, safeProgress);
      const prevIndex = lastDrawnPointIndexRef.current;
      if (targetIndex <= prevIndex && progress < 1.0) return;

      currentTipPosRef.current = path[targetIndex]; 
      maskCtx.save();
      applyUnifiedTransform(maskCtx, targetCanvas, LOGICAL_W);

      for (let i = prevIndex; i < targetIndex; i++) {
          const p1 = path[i];
          const p2 = path[i+1];
          if (!p2 || p2.isJump) continue;
          const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          const steps = Math.ceil(dist / 3); 
          for (let j = 0; j <= steps; j++) {
              const t = j / steps;
              maskCtx.save();
              maskCtx.translate(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t);
              maskCtx.rotate(Math.random() * Math.PI * 2);
              const s = 0.8 + Math.random() * 0.4;
              maskCtx.scale(s, s);
              maskCtx.drawImage(brush, -brush.width/2, -brush.height/2);
              maskCtx.restore();
          }
      }
      maskCtx.restore();
      lastDrawnPointIndexRef.current = targetIndex;
  };

  const drawHandSynced = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, tipX: number, tipY: number, handScale: number, tipOffset: { x: number, y: number }, rotation: number, wobbleScale: number) => {
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(rotation);
      ctx.scale(wobbleScale, wobbleScale);
      ctx.scale(handScale, handScale);
      ctx.drawImage(img, -img.width * tipOffset.x, -img.height * tipOffset.y);
      ctx.restore();
  };

  const drawFrame = (progress: number, time: number, handPosOverride?: {x: number, y: number}) => {
      const p = projectRef.current;
      const activeIndex = currentSceneIndexRef.current;
      const isExport = playerStateRef.current === "EXPORTING";
      const canvas = isExport ? exportCanvasRef.current : canvasRef.current;
      const mask = isExport ? exportMaskCanvasRef.current : maskCanvasRef.current;
      const revealBuffer = isExport ? exportRevealBufferRef.current : revealBufferRef.current; 
      const ctx = canvas?.getContext('2d');
      const img = currentImageRef.current;
      const path = drawingPathRef.current;
      const scene = p.scenes[activeIndex];
      const bgImg = currentBackgroundRef.current;

      if (!canvas || !ctx || !mask) return;

      if (scene.type === 'video' && scene.videoUrl) {
          const video = videoRefs.current.get(scene.id);
          if (video) {
              if (isExport && p.isOfflineRender) {
                  // Use videoMediaStart for offline sync (in seconds)
                  video.currentTime = (scene.videoMediaStart || 0) + (time / 1000);
              }
              if (videoMediaNodesMapRef.current.has(scene.id) && videoMasterGainRef.current) {
                  videoMasterGainRef.current.gain.value = scene.videoVolume ?? 1.0;
              }
              
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.save();
              applyUnifiedTransform(ctx, canvas, LOGICAL_W);
              const scale = Math.max(LOGICAL_W / video.videoWidth, LOGICAL_H / video.videoHeight);
              const x = (LOGICAL_W - video.videoWidth * scale) / 2;
              const y = (LOGICAL_H - video.videoHeight * scale) / 2;
              ctx.drawImage(video, x, y, video.videoWidth * scale, video.videoHeight * scale);
              ctx.restore();
              
              if (isExport && !p.isOfflineRender && canvasRef.current) {
                  canvasRef.current.getContext('2d')?.drawImage(exportCanvasRef.current!, 0, 0, canvasRef.current.width, canvasRef.current.height);
              }
              return;
          }
      }

      if (progress === 0) {
          mask.getContext('2d')?.clearRect(0, 0, mask.width, mask.height);
      }
      
      if (progress > 0 && path.length > 0) updateMask(path, progress); 

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (isExport && !exportRevealBufferRef.current) {
          const eb = document.createElement('canvas');
          eb.width = LOGICAL_W; eb.height = LOGICAL_H;
          exportRevealBufferRef.current = eb;
      }
      
      const buffCanvas = isExport ? exportRevealBufferRef.current : revealBufferRef.current;
      if (buffCanvas) {
          const bCtx = buffCanvas.getContext('2d');
          if (bCtx && img) {
              bCtx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
              if (progress >= 1.0) {
                  bCtx.drawImage(img, 0, 0, LOGICAL_W, LOGICAL_H);
              } else {
                  bCtx.drawImage(mask, 0, 0, LOGICAL_W, LOGICAL_H);
                  bCtx.globalCompositeOperation = 'source-in';
                  bCtx.drawImage(img, 0, 0, LOGICAL_W, LOGICAL_H);
                  bCtx.globalCompositeOperation = 'source-over'; 
              }
          }
      }

      ctx.save();
      applyUnifiedTransform(ctx, canvas, LOGICAL_W);
      
      if (bgImg) {
          const scale = Math.max(LOGICAL_W / bgImg.width, LOGICAL_H / bgImg.height);
          const x = (LOGICAL_W - bgImg.width * scale) / 2;
          const y = (LOGICAL_H - bgImg.height * scale) / 2;
          ctx.drawImage(bgImg, x, y, bgImg.width * scale, bgImg.height * scale);
      } else {
          const blendMode = scene.layerBlendMode || 'multiply';
          ctx.fillStyle = blendMode === 'screen' ? '#000000' : GOLPO_CANVAS.background;
          ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      }

      if (buffCanvas && img) {
          const blend = scene.layerBlendMode || (bgImg ? 'multiply' : 'source-over');
          ctx.globalCompositeOperation = (blend === 'normal' ? 'source-over' : blend) as GlobalCompositeOperation;
          ctx.drawImage(buffCanvas, 0, 0, LOGICAL_W, LOGICAL_H);
      }
      
      ctx.restore(); 

      const activeHand = getCurrentHand();
      
      // Draw Hand (if enabled and progress is appropriate OR override is present)
      if (p.showHand && activeHand.category !== 'None' && ((progress <= 1 && progress > 0) || handPosOverride)) {
          ctx.globalCompositeOperation = 'source-over';
          
          let logicalX = LOGICAL_W / 2, logicalY = LOGICAL_H / 2;
          
          if (handPosOverride) {
              logicalX = handPosOverride.x;
              logicalY = handPosOverride.y;
          } else if (path.length > 0) {
              const pt = path[progressToPathIndex(path, progress)];
              if(pt) { logicalX = pt.x; logicalY = pt.y; }
          } else if (currentTipPosRef.current) {
              logicalX = currentTipPosRef.current.x;
              logicalY = currentTipPosRef.current.y;
          }
          const handImg = handImagesRef.current.get(activeHand.id);
          if (handImg) {
              const sceneWobble = scene?.customWobble !== undefined ? scene.customWobble : p.spreadLevel;
              let rotBase = 0;
              let wobbleScale = 1.0;

              // Disable wobble during forced entry
              if (!handPosOverride && sceneWobble > 0) {
                 const intensity = sceneWobble / 100;
                 const speedMult = 0.0005 + (intensity * 0.003); 
                 const ampMult = 2.0 + (intensity * 10.0); 
                 const wave1 = Math.sin(time * speedMult);
                 const wave2 = Math.cos(time * (speedMult * 1.3)) * 0.5;
                 rotBase = (wave1 + wave2) * ampMult;
                 wobbleScale = 1.0 + (Math.sin(time * (speedMult * 0.5)) * (intensity * 0.02));
              }

              ctx.save();
              applyUnifiedTransform(ctx, canvas, LOGICAL_W);
              drawHandSynced(ctx, handImg, logicalX, logicalY, 0.8 * (activeHand.scale || 1.0), activeHand.tipOffset || {x:0.5,y:0.5}, rotBase * Math.PI / 180, wobbleScale);
              ctx.restore();
          }
      }

      if (isExport && !p.isOfflineRender && canvasRef.current) {
          canvasRef.current.getContext('2d')?.drawImage(exportCanvasRef.current!, 0, 0, canvasRef.current.width, canvasRef.current.height);
      }
  };

  const safeStartRecorder = () => { if (!recorderStartedRef.current && mediaRecorderRef.current) { recorderStartedRef.current = true; mediaRecorderRef.current.start(1000); } };
  
  const handleStopExport = () => {
      const state = playerStateRef.current as string;
      if (state === "EXPORTING" || state === "PREPARING") finishExport();
  };

  const handleExportOrchestrator = async () => {
      setRenderMessage("Preparing export...");
      setIsExporting(true);
      setExportProgress(0);
      
      const effectiveProject = {
          ...project,
          exportStartScene: localStartScene,
          exportEndScene: localEndScene
      };
      
      if (exportOpts.includeNarration || exportOpts.includeSfx || exportOpts.includeMusic) {
          try {
              setRenderMessage("Bouncing audio stems (Offline)...");
              const stems = await renderOfflineAudio(effectiveProject, audioBuffersRef.current, sfxBuffersCacheRef.current, musicBufferRef.current);
              if (exportOpts.includeNarration && stems.narration) downloadBlob(stems.narration, `narration_stem.wav`);
              if (exportOpts.includeSfx && stems.sfx) downloadBlob(stems.sfx, `sfx_stem.wav`);
              if (exportOpts.includeMusic && stems.music) downloadBlob(stems.music, `music_stem.wav`);
          } catch (e) { alert("Failed to bounce audio stems."); }
      }
      if (exportOpts.includeVideo) await handleExportVideo();
      else { setIsExporting(false); setRenderMessage(""); }
  };
  
  const handleExportAudioOnly = async () => {
      setRenderMessage("Rendering Audio Full Mix...");
      setIsExporting(true);
      try {
          const effectiveProject = { ...project, exportStartScene: localStartScene, exportEndScene: localEndScene };
          const stems = await renderOfflineAudio(effectiveProject, audioBuffersRef.current, sfxBuffersCacheRef.current, musicBufferRef.current);
          if (stems.fullMix) downloadBlob(stems.fullMix, `full_audio_mix.wav`); 
      } catch (e) { alert("Failed to render audio."); } 
      finally { setIsExporting(false); setRenderMessage(""); }
  }

  // --- NEW EXPORT ACTIONS ---
  const handleExportScript = () => {
      const blob = exportScriptToText(project);
      downloadBlob(blob, `project_script.txt`);
  };

  const handleExportPrompts = () => {
      const blob = exportPromptsToText(project);
      downloadBlob(blob, `visual_prompts.txt`);
  };
  
  // --- NEW: Backup Function ---
  const handleBackup = async () => {
      if (isExporting) return;
      setIsExporting(true);
      setRenderMessage("Creating Project Backup (.zip)...");
      setExportProgress(10); 

      try {
          const zipBlob = await exportProjectToZip(project);
          setExportProgress(100);
          downloadBlob(zipBlob, `${project.topic || 'project'}_backup.zip`);
          setRenderMessage("Backup Complete!");
      } catch (e: any) {
          console.error(e);
          alert(`Backup failed: ${e.message}`);
          setRenderMessage("Backup Failed");
      } finally {
          // Keep message for a moment
          setTimeout(() => {
              setIsExporting(false);
              setRenderMessage("");
              setExportProgress(0);
          }, 2000);
      }
  };
  
  const downloadBlob = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after the download has been handed off to avoid leaking the blob.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const handleExportVideo = async () => {
      await ensureAudioUnlocked();
      if (project.scenes.length === 0 || !audioContextRef.current) return;
      
      setIsExporting(true);
      playerStateRef.current = "PREPARING"; 
      setRenderMessage("Initializing Video Engine...");
      setExportProgress(0);
      recorderStartedRef.current = false;
      scenesRenderedCountRef.current = 0; 
      
      originalVolumesRef.current = { narr: narrationGainRef.current?.gain.value || 1, sfx: sfxGainRef.current?.gain.value || 1, music: musicGainRef.current?.gain.value || 0.5 };
      if (narrationGainRef.current) narrationGainRef.current.gain.value = project.narrationMasterVolume ?? 1.0;
      if (sfxGainRef.current) sfxGainRef.current.gain.value = project.sfxMasterVolume ?? 1.0;
      if (musicGainRef.current) musicGainRef.current.gain.value = project.musicVolume ?? 0.5;
      if (speakerGainRef.current) speakerGainRef.current.gain.value = project.isOfflineRender ? 0 : 1;
      
      const startSceneNum = exportRangeRef.current.start;
      
      let targetStartIndex = Math.max(0, startSceneNum - 1);
      while (targetStartIndex < project.scenes.length && project.scenes[targetStartIndex].isDisabled) {
           targetStartIndex++;
      }
      
      const targetEndIndex = exportRangeRef.current.end;
      
      console.log(`EXPORT INIT: Start Index ${targetStartIndex} (Scene ${startSceneNum}), End Index ${targetEndIndex}`);
      
      setCurrentSceneIndex(targetStartIndex);
      
      sceneProgressRef.current = 0;
      lastDrawnPointIndexRef.current = 0;
      currentTipPosRef.current = null;
      startTimeRef.current = null;
      
      const exportW = project.exportResolution === '1080p' ? 1920 : 1280;
      const exportH = Math.round(exportW * (LOGICAL_H / LOGICAL_W)); 

      const ghostCanvas = document.createElement('canvas');
      ghostCanvas.width = exportW; ghostCanvas.height = exportH;
      exportCanvasRef.current = ghostCanvas;
      
      const ghostMask = document.createElement('canvas');
      ghostMask.width = exportW; ghostMask.height = exportH;
      exportMaskCanvasRef.current = ghostMask;
      ghostMask.getContext('2d')?.clearRect(0,0,exportW, exportH);
      
      const preferredTypes = [
          "video/mp4;codecs=avc1.42E01E,mp4a.40.2", 
          "video/mp4;codecs=avc1.640028,mp4a.40.2", 
          "video/mp4",
          "video/webm;codecs=vp9,opus",
          "video/webm"
      ];
      
      const mimeType = preferredTypes.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";
      
      const stream = ghostCanvas.captureStream(30);
      // @ts-ignore - Store stream on canvas for offline loop to access
      ghostCanvas._capturedStream = stream;

      const dest = audioContextRef.current.createMediaStreamDestination();
      destNodeRef.current = dest;
      globalMasterGainRef.current?.connect(dest);
      
      const tracks = [...stream.getVideoTracks(), ...dest.stream.getAudioTracks()];
      const combinedStream = new MediaStream(tracks);
      
      const recorder = new MediaRecorder(combinedStream, {
          mimeType,
          videoBitsPerSecond: 8000000 
      });
      
      recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          chunksRef.current = [];
          const ext = mimeType.includes("mp4") ? "mp4" : "webm";
          const filename = `doodleminds_export_${Date.now()}.${ext}`;
          downloadBlob(blob, filename);
          setIsExporting(false);
          setRenderMessage("Export Complete!");
      };
      
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      
      setTimeout(() => {
          playerStateRef.current = "EXPORTING";
          safeStartRecorder();
          startScenePlayback();
      }, 500);
  };

  const calculatedTotalDuration = () => {
      let total = 0;
      const start = localStartScene - 1;
      const end = localEndScene;
      for(let i=start; i<end; i++) {
          total += getSceneDuration(i);
      }
      const s = Math.floor(total/1000);
      const m = Math.floor(s/60);
      const sec = s % 60;
      return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
          containerRef.current?.requestFullscreen().catch(err => {
              console.error(`Error attempting to enable fullscreen: ${err.message}`);
          });
      } else {
          document.exitFullscreen();
      }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 pb-32">
        {/* Header */}
        <div className="bg-slate-900 text-white p-4 rounded-t-xl flex justify-between items-center shadow-lg">
            <h2 className="text-xl font-bold font-doodle flex items-center gap-2">
                <button onClick={handleBackToStoryboard} className="p-1 hover:bg-slate-700 rounded transition-colors mr-2" title="Back to Timeline Card">
                    <ArrowLeft size={24} className="text-highlight"/>
                </button>
                <Film className="text-highlight"/> Preview & Export
            </h2>
            <div className="flex items-center gap-4">
                 <div className="flex items-center gap-2 bg-slate-800 px-3 py-1 rounded text-xs font-bold text-slate-300">
                    <input ref={jumpInputRef} type="text" value={jumpToSceneNum} onChange={e => setJumpToSceneNum(e.target.value)} onKeyDown={e => { if(e.key==='Enter') { const idx = parseInt(jumpToSceneNum)-1; if(project.scenes[idx]) setCurrentSceneIndex(idx); }}} className="w-8 bg-transparent text-white text-center focus:outline-none placeholder:text-slate-600" placeholder="#"/>
                    <span>/ {project.scenes.length}</span>
                 </div>
            </div>
        </div>

        {/* Main Canvas Container */}
        <div 
            ref={containerRef} 
            className={`relative bg-black shadow-2xl overflow-hidden flex items-center justify-center group/player mx-auto ${isVertical ? 'h-[70vh] aspect-[9/16]' : 'aspect-video w-full'}`}
            onClick={togglePlay}
        >
            <canvas ref={canvasRef} width={LOGICAL_W} height={LOGICAL_H} className="max-w-full max-h-full object-contain pointer-events-none" />
            
            {/* Play Overlay - Removed immediately when playing using conditional rendering */}
            {!isPlaying && !isExporting && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
                    <div className="text-white backdrop-blur-sm transform hover:scale-110 transition-transform drop-shadow-2xl">
                        <Play size={120} fill="white" className="opacity-80"/>
                    </div>
                </div>
            )}

            {isPlaying && !isImageLoadedRef.current && (
                <div className="absolute top-4 right-4 bg-black/60 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2 z-40">
                    <Loader2 size={12} className="animate-spin"/> Buffering Scene...
                </div>
            )}
            
            <div className="absolute bottom-4 left-4 bg-black/60 text-white px-3 py-1 rounded text-xs font-bold backdrop-blur-sm pointer-events-none transition-opacity opacity-0 group-hover/player:opacity-100 z-40">
                Scene {project.scenes[currentSceneIndex]?.number} - {project.scenes[currentSceneIndex]?.type === 'video' ? 'Video' : 'Sketch'}
            </div>
        </div>

        {/* Control Bar */}
        <div className="bg-slate-800 p-4 rounded-b-xl flex items-center justify-between gap-4 mb-6 shadow-lg">
             <div className="flex items-center gap-2">
                 <button onClick={() => setCurrentSceneIndex(Math.max(0, currentSceneIndex - 1))} className="text-slate-400 hover:text-white p-2 hover:bg-slate-700 rounded transition-colors"><SkipBack size={20}/></button>
                 <button onClick={isPlaying ? () => setIsPlaying(false) : startPlayback} className="bg-highlight hover:bg-orange-600 text-white p-3 rounded-full shadow-md transition-transform active:scale-95">
                     {isPlaying ? <Pause size={24} fill="currentColor"/> : <Play size={24} fill="currentColor" className="ml-1"/>}
                 </button>
                 <button onClick={() => setCurrentSceneIndex(Math.min(project.scenes.length - 1, currentSceneIndex + 1))} className="text-slate-400 hover:text-white p-2 hover:bg-slate-700 rounded transition-colors"><SkipForward size={20}/></button>
                 <button onClick={handleResetEngine} className="text-slate-400 hover:text-red-400 p-2 hover:bg-slate-700 rounded transition-colors ml-2" title="Stop & Reset"><SquareIcon size={16} fill="currentColor"/></button>
                 <div className="w-[1px] h-6 bg-slate-700 mx-1"></div>
                 <button onClick={toggleFullscreen} className="text-slate-400 hover:text-white p-2 hover:bg-slate-700 rounded transition-colors" title="Toggle Fullscreen"><Maximize size={18}/></button>
             </div>
             
             <div className="flex-1 h-12 bg-slate-900 rounded-lg relative overflow-hidden cursor-pointer group/timeline"
                  onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const pct = Math.max(0, Math.min(1, x / rect.width));
                      const total = project.scenes.length;
                      const target = Math.floor(total * pct);
                      setCurrentSceneIndex(target);
                  }}
             >
                {/* Visual Timeline Bar */}
                <div className="absolute inset-0 flex items-center px-1 gap-0.5">
                    {project.scenes.map((s, i) => (
                        <div 
                          key={s.id} 
                          className={`h-8 rounded-sm transition-all ${
                              i === currentSceneIndex ? 'bg-highlight flex-[2] shadow-lg scale-y-110 z-10' : 
                              (i < currentSceneIndex ? 'bg-slate-600 flex-1' : 'bg-slate-800 flex-1')
                          } ${s.isDisabled ? 'opacity-20' : 'opacity-100'}`}
                          title={`Scene ${s.number}`}
                        />
                    ))}
                </div>
             </div>

             <div className="flex items-center gap-2">
                 <button 
                    onClick={() => setShowExportMenu(!showExportMenu)} 
                    className={`px-4 py-3 rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-md ${showExportMenu ? 'bg-white text-slate-900' : 'bg-slate-700 text-white hover:bg-slate-600'}`}
                 >
                     <Download size={18}/> Export
                 </button>
             </div>
        </div>

        {/* EXPORT MENU */}
        {showExportMenu && (
            <div className="bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-xl animate-in fade-in slide-in-from-bottom-4 mb-8">
                 <div className="flex justify-between items-start mb-6">
                     <div>
                         <h3 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2"><Archive className="text-highlight"/> Export Studio</h3>
                         <p className="text-xs text-slate-500 dark:text-slate-400 font-bold mt-1">Render video, audio stems, or backup project.</p>
                     </div>
                     <button onClick={() => setShowExportMenu(false)} className="text-slate-400 hover:text-slate-800 dark:hover:text-white"><X size={24}/></button>
                 </div>
                 
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                     {/* Column 1: Config */}
                     <div className="space-y-4 border-r border-slate-100 dark:border-slate-800 pr-4">
                         <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Export Range</h4>
                         <div className="flex items-center gap-2">
                             <div className="flex-1">
                                 <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase">Start Scene</label>
                                 <input type="number" min="1" max={localEndScene} value={localStartScene} onChange={(e) => setLocalStartScene(Math.max(1, parseInt(e.target.value)))} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm font-bold text-slate-900 dark:text-white"/>
                             </div>
                             <ArrowRight size={16} className="text-slate-300 dark:text-slate-600 mt-4"/>
                             <div className="flex-1">
                                 <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase">End Scene</label>
                                 <input type="number" min={localStartScene} max={project.scenes.length} value={localEndScene} onChange={(e) => setLocalEndScene(Math.min(project.scenes.length, parseInt(e.target.value)))} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm font-bold text-slate-900 dark:text-white"/>
                             </div>
                         </div>
                         <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 flex justify-between">
                             <span>Est. Duration:</span>
                             <span>{calculatedTotalDuration()}</span>
                         </div>
                         
                         <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                             <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Resolution</h4>
                             <div className="grid grid-cols-2 gap-2">
                                 <button onClick={() => setProject(p => ({...p, exportResolution: '720p'}))} className={`p-2 rounded border text-xs font-bold ${project.exportResolution === '720p' ? 'bg-slate-800 text-white border-slate-900' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>720p (HD)</button>
                                 <button onClick={() => setProject(p => ({...p, exportResolution: '1080p'}))} className={`p-2 rounded border text-xs font-bold ${project.exportResolution === '1080p' ? 'bg-slate-800 text-white border-slate-900' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>1080p (FHD)</button>
                             </div>
                         </div>
                     </div>

                     {/* Column 2: Video Render */}
                     <div className="space-y-4 border-r border-slate-100 dark:border-slate-800 pr-4">
                         <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Film size={12}/> Video Render</h4>
                         
                         <div className="space-y-2">
                             <label className="flex items-center gap-2 cursor-pointer p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded">
                                 <input type="checkbox" checked={project.isOfflineRender} onChange={(e) => setProject(p => ({...p, isOfflineRender: e.target.checked}))} className="accent-highlight w-4 h-4" />
                                 <div>
                                     <div className="text-sm font-bold text-slate-800 dark:text-white">Offline Renderer (Best Quality)</div>
                                     <div className="text-[10px] text-slate-500 dark:text-slate-400">Frame-by-frame export. Slower but no frame drops.</div>
                                 </div>
                             </label>
                         </div>

                         <button 
                            onClick={handleExportOrchestrator}
                            disabled={isExporting}
                            className="w-full py-4 bg-slate-900 dark:bg-slate-100 dark:text-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 disabled:opacity-50 flex flex-col items-center justify-center gap-1 transition-all shadow-lg"
                         >
                             {isExporting ? <Loader2 size={24} className="animate-spin"/> : <MonitorPlay size={24}/>}
                             <span>{isExporting ? `Rendering ${exportProgress}%` : 'Render Video'}</span>
                         </button>
                         
                         {renderMessage && <div className="text-xs font-bold text-center text-highlight animate-pulse">{renderMessage}</div>}
                     </div>

                     {/* Column 3: Assets & Backup */}
                     <div className="space-y-4">
                         <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><LayoutGrid size={12}/> Data & Backup</h4>
                         
                         <div className="grid grid-cols-1 gap-2">
                             <button onClick={handleExportAudioOnly} disabled={isExporting} className="p-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                 <FileAudio size={16}/> Export Audio Mix (.wav)
                             </button>
                             <button onClick={handleExportScript} className="p-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                 <FileText size={16}/> Export Script (.txt)
                             </button>
                             <button onClick={handleExportPrompts} className="p-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                 <ImageIcon size={16}/> Export Prompts (.txt)
                             </button>
                             <button onClick={handleBackup} disabled={isExporting} className="p-3 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40 border border-orange-200 dark:border-orange-800 rounded-lg text-xs font-bold flex items-center gap-2 text-orange-700 dark:text-orange-400 mt-2">
                                 <Archive size={16}/> Backup Project (.zip)
                             </button>
                         </div>
                     </div>
                 </div>
            </div>
        )}
    </div>
  );
};

export default PreviewPlayer;
