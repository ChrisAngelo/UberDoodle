
import React, { useState, useRef, useEffect } from 'react';
import { ProjectState, Scene, HandOption, VeoModel, LANGUAGES, TTS_VOICES, VoiceOption, GenAiProConfig } from '../types';
import { generateSceneImage, generateSpeech, translateImageText, translateText, translateVisualPrompt, scanAndTranslateImageText, generateVeoVideo } from '../services/geminiService';
const ImageEditModal = React.lazy(() => import('./ImageEditModal'));
const VoiceSelectorModal = React.lazy(() => import('./VoiceSelectorModal'));
import JackTheRipper from './JackTheRipper';
import { JackPersistedState } from '../App'; // Import State Type
import { Play, Image as ImageIcon, Edit, RefreshCw, Loader2, Mic, Smartphone, Monitor, Upload, Trash2, RotateCcw, Settings2, Hand, Download, X, Music, Mic2, Speaker, ArrowRight, ChevronDown, ChevronUp, Languages, CopyCheck, Sliders, Disc, Film, Search, ArrowDownCircle, Wand2, Activity, Scan, Video, Film as FilmIcon, Power, Blend, Copy, Film as AnimateIcon, FileAudio, Square, Split, Eye, Volume2, Octagon, Lock, Unlock, Globe, Scissors } from 'lucide-react';

interface Props {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  jackState?: JackPersistedState;
  setJackState?: React.Dispatch<React.SetStateAction<JackPersistedState>>;
}

const DEFAULT_HANDS: HandOption[] = [
    { id: 'no-hand', name: 'No Hand', category: 'None', src: '', tipOffset: {x: 0.5, y: 0.5}, scale: 1.0 },
];

const DEFAULT_GENAIPRO_CONFIG: GenAiProConfig = {
    model_id: 'eleven_multilingual_v2',
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.0,
    use_speaker_boost: true
};

const Storyboard: React.FC<Props> = ({ project, setProject, jackState, setJackState }) => {
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const [generatingAudioId, setGeneratingAudioId] = useState<string | null>(null);
  const [isRegeneratingAllAudio, setIsRegeneratingAllAudio] = useState(false);
  const [regenProgress, setRegenProgress] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatingState, setTranslatingState] = useState<{sceneId: string, type: 'script' | 'visual'} | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [isPreparingAnimation, setIsPreparingAnimation] = useState(false);
  const [showJackTheRipper, setShowJackTheRipper] = useState(false);
  
  const [jumpToScene, setJumpToScene] = useState("");
  const [showFloatingSearch, setShowFloatingSearch] = useState(false);
  const [floatingSearchQuery, setFloatingSearchQuery] = useState("");
  const [showConfig, setShowConfig] = useState(true);
  
  const [auditioningVoice, setAuditioningVoice] = useState<string | null>(null);
  const [selectingHandForSceneId, setSelectingHandForSceneId] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, { speed?: number, wobble?: number }>>({});

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null); // To track active Blob URLs for revocation
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  
  const [localSpread, setLocalSpread] = useState(project.spreadLevel);
  const [localPace, setLocalPace] = useState(project.drawingPace);
  const [localTextFirst, setLocalTextFirst] = useState(project.textFirst || false);
  const [localOutlinesFirst, setLocalOutlinesFirst] = useState(project.outlinesFirst || false);
  
  const [localNarrMaster, setLocalNarrMaster] = useState(project.narrationMasterVolume ?? 1.0);
  const [localSfxMaster, setLocalSfxMaster] = useState(project.sfxMasterVolume ?? 1.0);
  const [localMusicMaster, setLocalMusicMaster] = useState(project.musicVolume ?? 0.5); 
  const [localGlobalMaster, setLocalGlobalMaster] = useState(project.masterVolume ?? 1.0);
  const [audioSettingsChanged, setAudioSettingsChanged] = useState(false);
  
  const [coherentStart, setCoherentStart] = useState<number>(1);
  const [coherentEnd, setCoherentEnd] = useState<number>(Math.min(5, project.scenes.length));
  const [isCoherentGenerating, setIsCoherentGenerating] = useState(false);

  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  // New Voice Selector State
  const [showVoiceSelector, setShowVoiceSelector] = useState(false);
  const [selectedVoiceLabel, setSelectedVoiceLabel] = useState("");

  useEffect(() => {
      // Resolve label for display
      const v = TTS_VOICES.find(v => v.id === project.voice);
      if (v) setSelectedVoiceLabel(`${v.label} (${v.provider})`);
      else if (project.voiceProvider === 'GenAiPro') {
          // If we have custom label stored somewhere or just show ID shortened
          setSelectedVoiceLabel(`Custom GenAiPro (${project.voice.substring(0,8)}...)`);
      } else {
          setSelectedVoiceLabel(project.voice);
      }
  }, [project.voice, project.voiceProvider]);

  const updateScene = (sceneId: string, updates: Partial<Scene>) => {
      setProject(prev => ({
          ...prev,
          scenes: prev.scenes.map(s => s.id === sceneId ? { ...s, ...updates } : s)
      }));
  };

  useEffect(() => {
      setLocalSpread(project.spreadLevel);
      setLocalPace(project.drawingPace);
      setLocalTextFirst(project.textFirst || false);
      setLocalOutlinesFirst(project.outlinesFirst || false);
      
      if (!audioSettingsChanged) {
          setLocalNarrMaster(project.narrationMasterVolume ?? 1.0);
          setLocalSfxMaster(project.sfxMasterVolume ?? 1.0);
          setLocalMusicMaster(project.musicVolume ?? 0.5);
          setLocalGlobalMaster(project.masterVolume ?? 1.0);
      }
  }, [project]);

  useEffect(() => {
      if (project.scenes.length > 0 && (coherentEnd === 0 || coherentEnd > project.scenes.length)) {
          setCoherentEnd(Math.min(project.scenes.length, 5));
      }
  }, [project.scenes.length]);

  const [calibratingHand, setCalibratingHand] = useState<HandOption | null>(null);
  const [calibrationScale, setCalibrationScale] = useState(1.0);
  const [dragOverSceneId, setDragOverSceneId] = useState<string | null>(null);
  
  const sceneRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const floatingSearchInputRef = useRef<HTMLInputElement>(null);

  const allHands = [...DEFAULT_HANDS, ...project.customHands];

  const getActiveBackgroundUrl = (scene: Scene) => {
      if (scene.backgroundUrl) return scene.backgroundUrl;
      // NOTE: enableGlobalBackground changed to FALSE by default in UI, so this only runs if explicitly TRUE
      if ((scene.enableGlobalBackground === true) && project.selectedBackgroundId) {
          return project.customBackgrounds.find(b => b.id === project.selectedBackgroundId)?.src;
      }
      return null;
  };

  const mergeSceneLayers = async (scene: Scene): Promise<string> => {
      const bgUrl = getActiveBackgroundUrl(scene);
      if (!bgUrl || !scene.imageUrl) return scene.imageUrl || "";

      return new Promise((resolve) => {
          const canvas = document.createElement('canvas');
          const isPortrait = project.aspectRatio === '9:16';
          const w = isPortrait ? 1080 : 1920;
          const h = isPortrait ? 1920 : 1080;
          canvas.width = w;
          canvas.height = h;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(scene.imageUrl!); return; }

          const imgBg = new Image();
          imgBg.crossOrigin = 'anonymous';
          const imgFg = new Image();
          imgFg.crossOrigin = 'anonymous';

          let loaded = 0;
          const onLoaded = () => {
              loaded++;
              if (loaded === 2) {
                  const bgRatio = imgBg.width / imgBg.height;
                  const canvasRatio = w / h;
                  let drawW = w, drawH = h, offX = 0, offY = 0;
                  
                  if (bgRatio > canvasRatio) {
                      drawH = h;
                      drawW = h * bgRatio;
                      offX = (w - drawW) / 2;
                  } else {
                      drawW = w;
                      drawH = w / bgRatio;
                      offY = (h - drawH) / 2;
                  }
                  ctx.drawImage(imgBg, offX, offY, drawW, drawH);

                  ctx.globalCompositeOperation = (scene.layerBlendMode === 'normal' ? 'source-over' : scene.layerBlendMode) || 'multiply';
                  
                  const fgRatio = imgFg.width / imgFg.height;
                  let fgW = w, fgH = h, fgX = 0, fgY = 0;
                  
                  if (fgRatio > canvasRatio) {
                      fgW = w;
                      fgH = w / fgRatio;
                      fgY = (h - fgH) / 2;
                  } else {
                      fgH = h;
                      fgW = h * fgRatio;
                      fgX = (w - fgW) / 2;
                  }
                  
                  ctx.drawImage(imgFg, fgX, fgY, fgW, fgH);
                  
                  ctx.globalCompositeOperation = 'source-over';
                  
                  resolve(canvas.toDataURL('image/png'));
              }
          };
          
          imgBg.onload = onLoaded;
          imgBg.onerror = () => { console.warn("Failed to load BG for merge"); resolve(scene.imageUrl!); };
          imgBg.src = bgUrl;

          imgFg.onload = onLoaded;
          imgFg.onerror = () => { console.warn("Failed to load FG for merge"); resolve(scene.imageUrl!); };
          imgFg.src = scene.imageUrl!;
      });
  };

  const handleSmartDownload = async (scene: Scene) => {
      let url = scene.imageUrl;
      if (getActiveBackgroundUrl(scene) || scene.layerBlendMode) {
          try {
              url = await mergeSceneLayers(scene);
          } catch(e) {
              console.warn("Download merge failed", e);
          }
      }
      if (!url) return;
      downloadImage(url, scene.number);
  };

  useEffect(() => {
      if (project.jumpToSceneOnMount) {
          const sceneNum = project.jumpToSceneOnMount;
          const scene = project.scenes.find(s => s.number === sceneNum);
          
          if (scene) {
             const el = sceneRefs.current.get(scene.id);
             if (el) {
                 setTimeout(() => {
                     el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                     el.classList.add('ring-4', 'ring-highlight');
                     setTimeout(() => el.classList.remove('ring-4', 'ring-highlight'), 2000);
                 }, 100);
             }
          }
          setProject(prev => ({ ...prev, jumpToSceneOnMount: undefined }));
      }
  }, []);

  useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
          if (e.key.toLowerCase() === 's' && !showFloatingSearch && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
              e.preventDefault();
              setShowFloatingSearch(true);
              setTimeout(() => floatingSearchInputRef.current?.focus(), 100);
          }
          if (e.key === 'Escape' && showFloatingSearch) {
              setShowFloatingSearch(false);
          }
      };
      window.addEventListener('keydown', handleGlobalKeyDown);
      return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [showFloatingSearch]);

  const handleScrollToScene = (query: string) => {
      const q = query.toLowerCase();
      const match = project.scenes.find(s => 
          s.number.toString() === q || 
          s.script.toLowerCase().includes(q)
      );
      
      if (match) {
          const el = sceneRefs.current.get(match.id);
          if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add('ring-2', 'ring-highlight');
              setTimeout(() => el.classList.remove('ring-2', 'ring-highlight'), 2000);
              setShowFloatingSearch(false);
              setFloatingSearchQuery("");
              setJumpToScene("");
          }
      }
  };

  const renumberScenes = (scenes: Scene[]) => {
      let counter = 1;
      return scenes.map(s => {
          if (s.isDisabled) return s; 
          return { ...s, number: counter++ };
      });
  };

  const handleMoveToLast = (e: React.MouseEvent, sceneId: string) => {
      e.stopPropagation(); 
      e.preventDefault();
      
      setProject(prev => {
          const index = prev.scenes.findIndex(s => s.id === sceneId);
          if (index === -1 || index === prev.scenes.length - 1) return prev;
          
          const newScenes = [...prev.scenes];
          const [moved] = newScenes.splice(index, 1);
          newScenes.push(moved);
          
          return { ...prev, scenes: renumberScenes(newScenes) };
      });
  };

  const handleDuplicateScene = (e: React.MouseEvent, sceneId: string) => {
      e.stopPropagation();
      e.preventDefault();
      
      const scene = project.scenes.find(s => s.id === sceneId);
      
      if (!scene) return;
      
      const index = project.scenes.findIndex(s => s.id === sceneId);
      if (index === -1) return;

      const clonedScene: Scene = {
          ...scene,
          id: `scene-clone-${Date.now()}`,
          number: index + 2, 
          isGenerating: false, 
          videoGenerationConfig: scene.videoGenerationConfig ? {...scene.videoGenerationConfig} : undefined
      };
      
      setProject(prev => {
          const newScenes = [...prev.scenes];
          newScenes.splice(index + 1, 0, clonedScene);
          return { ...prev, scenes: renumberScenes(newScenes) };
      });
  };
  
  const handleAnimateImage = async (e: React.MouseEvent, scene: Scene) => {
      e.stopPropagation();
      e.preventDefault();
      
      if (!scene.imageUrl) {
          alert("No image to animate.");
          return;
      }
      
      setIsPreparingAnimation(true);
      
      let finalImage = scene.imageUrl;
      try {
          finalImage = await mergeSceneLayers(scene);
      } catch(e) {
          console.warn("Merge failed, defaulting to raw image", e);
      }
      
      const index = project.scenes.findIndex(s => s.id === scene.id);
      
      const newVideoScene: Scene = {
          id: `scene-video-anim-${Date.now()}`,
          type: 'video',
          number: index + 2,
          script: scene.script, 
          visualDescription: `Animated version of: ${scene.visualDescription}`,
          isGenerating: false,
          sfxVolume: 0.2,
          videoGenerationConfig: {
              model: 'veo-3.1-fast-generate-preview',
              prompt: `Animate this image: ${scene.visualDescription}, subtle movement, cinematic`,
              durationSeconds: 8,
              inputImageUrl: finalImage 
          }
      };
      
      setProject(prev => {
          const newScenes = [...prev.scenes];
          newScenes.splice(index + 1, 0, newVideoScene);
          return { ...prev, scenes: renumberScenes(newScenes) };
      });
      
      setIsPreparingAnimation(false);
      
      setTimeout(() => {
          const el = sceneRefs.current.get(newVideoScene.id);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
  };

  const handleMoveScene = (e: React.MouseEvent, sceneId: string, direction: 'up' | 'down') => {
      e.stopPropagation();
      e.preventDefault();
      
      setProject(prev => {
          const index = prev.scenes.findIndex(s => s.id === sceneId);
          if (index === -1) return prev;
          if (direction === 'up' && index === 0) return prev;
          if (direction === 'down' && index === prev.scenes.length - 1) return prev;

          const newScenes = [...prev.scenes];
          const targetIndex = direction === 'up' ? index - 1 : index + 1;
          
          const temp = newScenes[targetIndex];
          newScenes[targetIndex] = newScenes[index];
          newScenes[index] = temp;

          return { ...prev, scenes: renumberScenes(newScenes) };
      });
  };

  const toggleDisableScene = (e: React.MouseEvent, sceneId: string) => {
      e.stopPropagation();
      e.preventDefault();
      
      setProject(prev => {
          const newScenes = prev.scenes.map(s => 
              s.id === sceneId ? { ...s, isDisabled: !s.isDisabled } : s
          );
          return { ...prev, scenes: renumberScenes(newScenes) };
      });
  };

  const toggleSceneLock = (sceneId: string) => {
      setProject(prev => ({
          ...prev,
          scenes: prev.scenes.map(s => 
              s.id === sceneId ? { ...s, isLocked: !s.isLocked } : s
          )
      }));
  };

  const applyAudioSettings = () => {
      setProject(prev => ({
          ...prev,
          narrationMasterVolume: localNarrMaster,
          sfxMasterVolume: localSfxMaster,
          musicVolume: localMusicMaster,
          masterVolume: localGlobalMaster
      }));
      setAudioSettingsChanged(false);
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      setProject(prev => ({ ...prev, targetLanguage: e.target.value }));
  };

  const handleGenerateVideo = async (scene: Scene) => {
      if (!scene.videoGenerationConfig) return;
      const { model, prompt, durationSeconds, inputImageUrl } = scene.videoGenerationConfig;
      
      if (!prompt) { alert("Please enter a prompt."); return; }
      
      updateScene(scene.id, { isGenerating: true });
      try {
          const videoUrl = await generateVeoVideo(model, prompt, project.aspectRatio, durationSeconds, inputImageUrl);
          
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () => {
               updateScene(scene.id, { 
                   videoUrl, 
                   videoDuration: video.duration,
                   mediaStart: 0,
                   mediaEnd: video.duration,
                   videoVolume: 1.0,
                   isGenerating: false
               });
               video.remove();
          };
          video.onerror = () => {
               updateScene(scene.id, { videoUrl, isGenerating: false });
          }
          video.src = videoUrl;
      } catch (e: any) {
          alert(`Video generation failed: ${e.message}`);
          updateScene(scene.id, { isGenerating: false });
      }
  };

  const handleApplyHandToAllScenes = () => {
      const currentHand = allHands.find(h => h.id === project.selectedHandId);
      const handName = currentHand ? currentHand.name : "Unknown Hand";

      if (window.confirm(`Force ALL scenes to use the currently selected Global Hand "${handName}"? This overrides individual scene settings.`)) {
          setProject(prev => ({
              ...prev,
              scenes: prev.scenes.map(s => {
                  if (s.isLocked) return s; 
                  return { ...s, handId: prev.selectedHandId };
              })
          }));
          alert(`Successfully applied "${handName}" to unlocked scenes.`);
      }
  };
  
  const handleApplyAudioToAll = () => {
      if (!project.globalSfxUrl) return;
      if (window.confirm("Apply the current Global SFX to ALL scenes? This overwrites specific scene SFX.")) {
          setProject(prev => ({
              ...prev,
              scenes: prev.scenes.map(s => {
                  if (s.isLocked) return s; 
                  return { ...s, sfxUrl: prev.globalSfxUrl, sfxVolume: 0.2 };
              })
          }));
      }
  };
  
  const handleGenerateCoherentAudio = async () => {
      console.log("--- COHERENT FLOW V1 (TIMECODE MODE) ---"); 
      const start = Math.max(1, coherentStart);
      const end = Math.min(project.scenes.length, coherentEnd);
      console.log(`Range: ${start} to ${end}`); 

      if (end < start) { 
          console.warn("Invalid Range");
          alert("Invalid Range for Coherent Flow."); return; 
      }
      
      const scenesInRange = project.scenes.filter(s => s.number >= start && s.number <= end && !s.isDisabled && !s.isLocked);
      
      if (scenesInRange.length === 0) { 
          alert("No enabled scenes in range."); return; 
      }
      
      console.log("Generating Master Audio for Coherent Flow..."); 
      setIsCoherentGenerating(true);
      let audioCtx: AudioContext | null = null;
      
      try {
          const fullText = scenesInRange.map(s => s.script.trim()).join(" . . . ");
          const audioUrl = await generateSpeech(
              fullText, 
              project.voice, 
              project.targetLanguage, 
              project.narrationStyle,
              // Only pass config if provider is GenAiPro
              project.voiceProvider === 'GenAiPro' ? (project.genAiProConfig || DEFAULT_GENAIPRO_CONFIG) : undefined
          );
          
          audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          if (audioCtx.state === 'suspended') await audioCtx.resume();
          
          // CRITICAL FIX: Convert Data URI to ArrayBuffer reliably
          let arrayBuffer: ArrayBuffer | null = null;
          if (audioUrl.startsWith('data:')) {
              try {
                  const blob = base64ToBlob(audioUrl);
                  arrayBuffer = await blob.arrayBuffer();
              } catch(e) {
                  console.error("Coherent Flow: Failed to convert blob", e);
              }
          }
          
          if (!arrayBuffer) {
              const response = await fetch(audioUrl);
              arrayBuffer = await response.arrayBuffer();
          }
          
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          
          const channelData = audioBuffer.getChannelData(0);
          const splitPoints: number[] = [0]; 
          let silenceStart = -1;
          const silenceThreshold = 0.015;
          const minSilenceDuration = 0.3 * audioBuffer.sampleRate;
          
          for (let i = 0; i < channelData.length; i++) {
              if (Math.abs(channelData[i]) < silenceThreshold) {
                  if (silenceStart === -1) silenceStart = i;
              } else {
                  if (silenceStart !== -1) {
                      const duration = i - silenceStart;
                      if (duration > minSilenceDuration) {
                          if (splitPoints.length < scenesInRange.length) {
                              splitPoints.push(Math.floor(silenceStart + duration / 2));
                          }
                      }
                      silenceStart = -1;
                  }
              }
          }
          splitPoints.push(channelData.length);
          
          let finalSplitPoints = splitPoints;
          // Fallback if silence detection fails to match scene count exactly
          if (splitPoints.length - 1 !== scenesInRange.length) {
              console.warn(`Coherent Flow: Silence detection mismatch. Found ${splitPoints.length-1} segments for ${scenesInRange.length} scenes. Falling back to even split.`);
              const chunkLen = Math.floor(channelData.length / scenesInRange.length);
              finalSplitPoints = [0];
              for(let k=1; k<scenesInRange.length; k++) {
                  finalSplitPoints.push(k * chunkLen);
              }
              finalSplitPoints.push(channelData.length);
          }
          
          const updates: {id: string, url: string, start: number, end: number}[] = [];
          
          for (let i = 0; i < scenesInRange.length; i++) {
              const startSample = finalSplitPoints[i];
              const endSample = finalSplitPoints[i+1];
              const startTime = startSample / audioBuffer.sampleRate;
              const endTime = endSample / audioBuffer.sampleRate;
              
              updates.push({ 
                  id: scenesInRange[i].id, 
                  url: audioUrl, 
                  start: startTime,
                  end: endTime
              });
          }
          
          setProject(prev => ({
              ...prev,
              scenes: prev.scenes.map(s => {
                  const up = updates.find(u => u.id === s.id);
                  if (up) {
                      return { 
                          ...s, 
                          audioUrl: up.url,
                          mediaStart: up.start, 
                          mediaEnd: up.end      
                      };
                  }
                  return s;
              })
          }));
          
          alert(`Success! Coherent audio generated for ${scenesInRange.length} scenes.`);
          
      } catch (e: any) {
          console.error("Coherent Gen Failed:", e);
          alert("Coherent generation failed: " + e.message);
      } finally {
          if (audioCtx) await audioCtx.close();
          setIsCoherentGenerating(false);
      }
  };

  const handleScriptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, sceneIndex: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const textarea = e.currentTarget;
        const cursorPosition = textarea.selectionStart;
        const originalText = project.scenes[sceneIndex].script;
        const firstPart = originalText.slice(0, cursorPosition).trim();
        const secondPart = originalText.slice(cursorPosition).trim();

        if (!secondPart) return;

        const newScenes = [...project.scenes];
        newScenes[sceneIndex] = {
            ...newScenes[sceneIndex],
            script: firstPart,
            audioUrl: undefined
        };

        const newScene: Scene = {
            id: `scene-split-${Date.now()}`,
            number: newScenes[sceneIndex].number + 1,
            script: secondPart,
            visualDescription: `Continued: ${newScenes[sceneIndex].visualDescription}`,
            isGenerating: false,
            customPace: project.drawingPace || 0.5,
            customWobble: project.spreadLevel || 5,
            sfxVolume: 0.2
        };

        newScenes.splice(sceneIndex + 1, 0, newScene);
        setProject(prev => ({ ...prev, scenes: renumberScenes(newScenes) }));
    }
  };

  const handleScriptChange = (sceneId: string, newText: string) => {
      const scene = project.scenes.find(s => s.id === sceneId);
      if (scene?.isLocked) return;
      updateScene(sceneId, { script: newText, audioUrl: undefined }); 
  };

  const handleGenerateImage = async (scene: Scene) => {
    if (scene.isLocked || scene.type === 'video') return;
    
    if (!scene.visualDescription?.trim()) {
        alert("Visual description is empty. Cannot generate image.");
        return;
    }
    
    updateScene(scene.id, { isGenerating: true, imageUrl: undefined });
    try {
      const imageUrl = await generateSceneImage(
          scene.visualDescription, 
          project.artStyle, 
          project.brushStyle, 
          project.aspectRatio,
          project.analyzedStylePrompt,
          scene.visualKeywords,
          project.targetLanguage 
      );
      updateScene(scene.id, { imageUrl, isGenerating: false });
    } catch (error: any) {
      console.error(error);
      alert(`Generation failed: ${error.message}`);
      updateScene(scene.id, { isGenerating: false });
    }
  };

  const handleReplaceImage = (sceneId: string, file: File) => {
      const scene = project.scenes.find(s => s.id === sceneId);
      if (scene?.isLocked) return;
      
      if (scene?.type === 'video') {
           if (!file || !file.type.startsWith('video/')) {
               alert("Please upload a valid video file (MP4/MOV).");
               return;
           }

           const reader = new FileReader();
           reader.onload = (e) => {
               const base64Url = e.target?.result as string;
               
               const video = document.createElement('video');
               video.preload = 'metadata';
               video.onloadedmetadata = () => {
                   updateScene(sceneId, { 
                       videoUrl: base64Url, 
                       videoDuration: video.duration,
                       videoMediaStart: 0,
                       videoMediaEnd: video.duration,
                       videoVolume: 1.0 
                   });
                   video.remove();
               };
               video.onerror = () => {
                    alert("Failed to read video metadata.");
               }
               video.src = base64Url;
           };
           reader.readAsDataURL(file); 
           return;
      }

      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (e) => {
          const result = e.target?.result as string;
          updateScene(sceneId, { imageUrl: result });
      };
      reader.readAsDataURL(file);
  };

  const handleSfxUpload = (sceneId: string, file: File) => {
      const scene = project.scenes.find(s => s.id === sceneId);
      if (scene?.isLocked) return;
      if(!file) return;
      if (!file.type.startsWith('audio/')) {
          alert("Please upload a valid audio file (MP3/WAV).");
          return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
          updateScene(sceneId, { sfxUrl: e.target?.result as string, sfxVolume: 0.2 });
      }
      reader.readAsDataURL(file);
  };

  const processAudioFiles = (files: FileList | File[], targetSceneId?: string) => {
      const fileArray = Array.from(files) as File[];
      
      if (fileArray.length === 1) {
          const file = fileArray[0];
          if (!file.type.startsWith('audio/')) return alert("Not an audio file");
          
          let targetId = targetSceneId;
          
          if (!targetId) {
               const match = file.name.match(/(\d+)/);
               if (match) {
                   const num = parseInt(match[1]);
                   const scene = project.scenes.find(s => s.number === num);
                   if (scene) targetId = scene.id;
               }
          }
          
          if (targetId) {
              const scene = project.scenes.find(s => s.id === targetId);
              if (scene) {
                  if (scene.isLocked) return alert("Scene is locked.");
                  
                  if (scene.audioUrl) {
                      if (!window.confirm(`Scene ${scene.number} already has narration. Replace it with "${file.name}"?`)) return;
                  }
                  
                  const reader = new FileReader();
                  reader.onload = (e) => updateScene(targetId!, { audioUrl: e.target?.result as string });
                  reader.readAsDataURL(file);
              }
          }
          return;
      }

      const updates: {id: string, url: string, name: string}[] = [];
      const conflicts: string[] = [];
      
      const readFile = (f: File): Promise<string> => {
          return new Promise(resolve => {
              const r = new FileReader();
              r.onload = (e) => resolve(e.target?.result as string);
              r.readAsDataURL(f);
          });
      };
      
      (async () => {
          for (const file of fileArray) {
              if (!file.type.startsWith('audio/')) continue;
              
              const match = file.name.match(/(\d+)/);
              let num = match ? parseInt(match[1]) : -1;
              
              if (num === -1) {
                  const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
                  const lowerName = file.name.toLowerCase();
                  const idx = words.findIndex(w => lowerName.includes(w));
                  if (idx !== -1) num = idx + 1;
              }

              if (num !== -1) {
                  const scene = project.scenes.find(s => s.number === num);
                  if (scene) {
                      if (scene.audioUrl) conflicts.push(`Scene ${scene.number}`);
                      const url = await readFile(file);
                      updates.push({ id: scene.id, url, name: file.name });
                  }
              }
          }

          if (updates.length === 0) return alert("No matching scenes found. Filenames must contain numbers (e.g., '1.wav', 'Scene 2.mp3').");
          
          if (conflicts.length > 0) {
              const msg = `The following scenes already have audio:\n${conflicts.slice(0,5).join(', ')}${conflicts.length > 5 ? '...' : ''}\n\nBatch overwrite enabled (includes locked cards). Proceed?`;
              if (!window.confirm(msg)) return;
          }
          
          setProject(prev => ({
              ...prev,
              scenes: prev.scenes.map(s => {
                  const update = updates.find(u => u.id === s.id);
                  if (update) return { ...s, audioUrl: update.url };
                  return s;
              })
          }));
          
          alert(`Successfully batch updated ${updates.length} scenes.`);
      })();
  };

  const handleAudioBatchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          processAudioFiles(e.target.files);
      }
      e.target.value = '';
  };
  
  const handleBulkImageImport = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      
      const fileArray = Array.from(files) as File[];
      const updates: {id: string, url: string}[] = [];
      const readFile = (f: File): Promise<string> => new Promise(res => {
          const r = new FileReader();
          r.onload = (e) => res(e.target?.result as string);
          r.readAsDataURL(f);
      });
      
      (async () => {
          for (const file of fileArray) {
              if (!file.type.startsWith('image/')) continue;
              
              const match = file.name.match(/(\d+)/);
              let num = match ? parseInt(match[1]) : -1;
              
              if (num !== -1) {
                  const scene = project.scenes.find(s => s.number === num);
                  if (scene) {
                      const url = await readFile(file);
                      updates.push({ id: scene.id, url });
                  }
              }
          }
          
          if (updates.length > 0) {
              setProject(prev => ({
                  ...prev,
                  scenes: prev.scenes.map(s => {
                      const up = updates.find(u => u.id === s.id);
                      if (up && !s.isLocked) return { ...s, imageUrl: up.url };
                      return s;
                  })
              }));
              alert(`Successfully matched and imported ${updates.length} images.`);
          } else {
              alert("No matching scenes found. Filenames must contain scene numbers (e.g. '1.png', 'Scene 5.jpg').");
          }
      })();
      e.target.value = '';
  };
  
  const handleSceneBackgroundUpload = (sceneId: string, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (ev) => {
              updateScene(sceneId, { backgroundUrl: ev.target?.result as string, enableGlobalBackground: false });
          };
          reader.readAsDataURL(file);
      }
      e.target.value = '';
  }

  const handleMusicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
              const result = ev.target?.result as string;
              setProject(prev => ({ ...prev, musicUrl: result }));
          };
          reader.readAsDataURL(file);
      }
      e.target.value = '';
  };

  const handleGenerateAudio = async (scene: Scene) => {
    if (scene.isLocked) return;
    if (!scene.script.trim()) return;
    
    if (scene.audioUrl) {
         if(!window.confirm("Overwrite existing audio with new AI Generation?")) return;
    }

    setGeneratingAudioId(scene.id);
    try {
      const audioUrl = await generateSpeech(
          scene.script, 
          project.voice, 
          project.targetLanguage, 
          project.narrationStyle,
          // Only pass config if provider is GenAiPro
          project.voiceProvider === 'GenAiPro' ? (project.genAiProConfig || DEFAULT_GENAIPRO_CONFIG) : undefined
      );
      updateScene(scene.id, { audioUrl, mediaStart: undefined, mediaEnd: undefined });
    } catch (error) {
      console.error(error);
      alert("Failed to generate audio. Check API key or Quota.");
    } finally {
      setGeneratingAudioId(null);
    }
  };
  
  const handleAuditionVoice = async (voiceId: string) => {
      setAuditioningVoice(voiceId);
      try {
          const url = await generateSpeech(
              "Hello, I am ready to narrate your video.", 
              voiceId, 
              undefined, 
              undefined, 
              // Audition assumes current selected provider matches context of button, 
              // but if auditioning from list, we should check the voice object. 
              // Here we rely on project.voiceProvider which corresponds to project.voice
              project.voiceProvider === 'GenAiPro' ? (project.genAiProConfig || DEFAULT_GENAIPRO_CONFIG) : undefined
          );
          // For immediate playback of generated DataURI
          await new Promise((resolve, reject) => {
              const audio = new Audio(url);
              audio.onended = resolve;
              audio.onerror = reject;
              audio.play().catch(reject);
          });
      } catch (e) {
          console.error("Audition failed", e);
          alert("Failed to audition voice.");
      } finally {
          setAuditioningVoice(null);
      }
  };
  
  // VOICE SELECTION HANDLER
  const handleVoiceSelected = (voice: VoiceOption, config: GenAiProConfig | undefined) => {
      setProject(prev => ({
          ...prev,
          voice: voice.id,
          voiceProvider: voice.provider,
          genAiProConfig: config,
          // If it's GenAiPro, we clear the narration style as it uses specific model params
          narrationStyle: voice.provider === 'GenAiPro' ? undefined : prev.narrationStyle
      }));
      setSelectedVoiceLabel(`${voice.label} (${voice.provider})`);
  };

  const handleResetAudio = (sceneId: string) => {
      if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
          currentAudioRef.current = null;
      }
      if (currentAudioUrlRef.current) {
          URL.revokeObjectURL(currentAudioUrlRef.current);
          currentAudioUrlRef.current = null;
      }
      setPlayingAudioId(null);
      updateScene(sceneId, { audioUrl: undefined, mediaStart: undefined, mediaEnd: undefined });
  };

  const handleStopAllSound = () => {
      if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current.src = "";
          currentAudioRef.current = null;
      }
      if (currentAudioUrlRef.current) {
          URL.revokeObjectURL(currentAudioUrlRef.current);
          currentAudioUrlRef.current = null;
      }
      setPlayingAudioId(null);
      window.speechSynthesis.cancel();
  };

  const handlePlayAudio = async (url: string, sceneId: string, start?: number, end?: number) => {
      // Toggle logic
      if (playingAudioId === sceneId && currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current.currentTime = 0;
          setPlayingAudioId(null);
          return;
      }

      handleStopAllSound(); 

      // Robust handling for large Data URIs (saved audio)
      let playUrl = url;
      let isTempBlob = false;

      if (url.startsWith('data:')) {
          try {
              // Manual conversion is safer for large strings than fetch() on some browsers
              const blob = base64ToBlob(url);
              playUrl = URL.createObjectURL(blob);
              currentAudioUrlRef.current = playUrl; // Track for revocation
              isTempBlob = true;
          } catch (e) {
              console.warn("Failed to convert Data URI to Blob for playback, using direct source", e);
          }
      }

      const a = new Audio(playUrl);
      currentAudioRef.current = a;
      
      if (start !== undefined) {
          a.currentTime = start;
      }
      
      if (end !== undefined) {
          const checkTime = () => {
              if (a.currentTime >= end) {
                  a.pause();
                  setPlayingAudioId(null);
                  a.removeEventListener('timeupdate', checkTime);
              }
          };
          a.addEventListener('timeupdate', checkTime);
      }
      
      a.onerror = (e) => {
          console.error("Audio Playback Error:", e);
          alert("Failed to play audio. The source file may be corrupted or unsupported.");
          setPlayingAudioId(null);
      };
      
      a.play().catch(e => {
          console.error("Play failed:", e);
      });
      
      setPlayingAudioId(sceneId);
      
      a.onended = () => {
          if (playingAudioId === sceneId) setPlayingAudioId(null);
          if (isTempBlob && playUrl) {
              // Revoke later to be safe
              setTimeout(() => URL.revokeObjectURL(playUrl), 1000);
          }
      };
  };

  const handleRegenerateAllAudio = async () => {
      setIsRegeneratingAllAudio(true);
      setRegenProgress("Starting...");
      
      const scenesToGen = project.scenes.filter(s => !!s.script.trim() && !s.audioUrl && !s.isLocked && !s.isDisabled);
      let processed = 0;

      if (scenesToGen.length === 0) {
          if(window.confirm("All enabled scenes have audio. Force regenerate EVERYTHING (ignoring locked)?")) {
               const allScenes = project.scenes.filter(s => !!s.script.trim() && !s.isLocked && !s.isDisabled);
               for (const scene of allScenes) {
                   processed++;
                   setRegenProgress(`${processed}/${allScenes.length}`);
                   try {
                       const audioUrl = await generateSpeech(
                           scene.script, 
                           project.voice, 
                           project.targetLanguage, 
                           project.narrationStyle,
                           // Only pass config if provider is GenAiPro
                           project.voiceProvider === 'GenAiPro' ? (project.genAiProConfig || DEFAULT_GENAIPRO_CONFIG) : undefined
                       );
                       updateScene(scene.id, { audioUrl, sfxVolume: scene.sfxVolume ?? 0.2, mediaStart: undefined, mediaEnd: undefined });
                   } catch(e){}
                   await new Promise(r => setTimeout(r, 800)); 
               }
          }
          setIsRegeneratingAllAudio(false);
          setRegenProgress("");
          return;
      }

      for (const scene of scenesToGen) {
          processed++;
          setRegenProgress(`${processed}/${scenesToGen.length}`);
          
          try {
              const audioUrl = await generateSpeech(
                  scene.script, 
                  project.voice, 
                  project.targetLanguage, 
                  project.narrationStyle,
                  // Only pass config if provider is GenAiPro
                  project.voiceProvider === 'GenAiPro' ? (project.genAiProConfig || DEFAULT_GENAIPRO_CONFIG) : undefined
              );
              updateScene(scene.id, { audioUrl, sfxVolume: scene.sfxVolume ?? 0.2, mediaStart: undefined, mediaEnd: undefined });
          } catch (e: any) {
              console.error(`Failed audio gen for scene ${scene.id}`, e);
          }
          
          if (processed < scenesToGen.length) {
              await new Promise(r => setTimeout(r, 800)); 
          }
      }
      
      setIsRegeneratingAllAudio(false);
      setRegenProgress("");
  };

  const handleGenerateAllVisuals = async () => {
    const scenesToGen = project.scenes.filter(s => 
        !s.imageUrl && !s.isLocked && s.type !== 'video' && !s.isDisabled && !s.isGenerating
    );
    
    if (scenesToGen.length === 0) {
        alert("No missing images found.");
        return;
    }

    for (const scene of scenesToGen) {
        await handleGenerateImage(scene);
        await new Promise(r => setTimeout(r, 500));
    }
  };

  const handleTranslateAllImages = async () => {
      const targetLang = project.targetLanguage || 'English';
      if (!window.confirm(`Translate text in ALL unlocked images to ${targetLang}? This will re-render them with the same visual style.`)) return;
      
      const scenesToProcess = project.scenes.filter(s => s.imageUrl && !s.isLocked && s.type !== 'video' && !s.isDisabled);
      
      for (const scene of scenesToProcess) {
          updateScene(scene.id, { isGenerating: true });
          try {
              const translatedImage = await translateImageText(scene.imageUrl!, targetLang);
              updateScene(scene.id, { imageUrl: translatedImage });
          } catch (e) {
              console.error(`Translation failed for scene ${scene.number}`, e);
          } finally {
              updateScene(scene.id, { isGenerating: false });
          }
      }
  };
  
  const handleTranslateAllScripts = async () => {
      const targetLang = project.targetLanguage;
      if (!targetLang) return;
      if (!window.confirm(`Translate ALL unlocked scene scripts to ${targetLang}? This will invalidate existing audio.`)) return;
      
      setIsTranslating(true);
      const scenesToProcess = project.scenes.filter(s => s.script && !s.isLocked && !s.isDisabled);
      
      for (const scene of scenesToProcess) {
          setTranslatingState({ sceneId: scene.id, type: 'script' });
          try {
              const translated = await translateText(scene.script, targetLang);
              updateScene(scene.id, {
                  originalScript: scene.originalScript || scene.script,
                  script: translated,
                  audioUrl: undefined
              });
          } catch (e) {
              console.error(`Script translation failed for scene ${scene.number}`, e);
          }
      }
      setIsTranslating(false);
      setTranslatingState(null);
  };

  const handleTranslateAllPrompts = async () => {
      const targetLang = project.targetLanguage;
      if (!targetLang) return;
      if (!window.confirm(`Translate ALL unlocked visual prompts to ${targetLang}?`)) return;
      
      setIsTranslating(true);
      const scenesToProcess = project.scenes.filter(s => s.visualDescription && !s.isLocked && s.type !== 'video' && !s.isDisabled);
      
      for (const scene of scenesToProcess) {
           setTranslatingState({ sceneId: scene.id, type: 'visual' });
           try {
               const translated = await translateVisualPrompt(scene.visualDescription, targetLang);
               updateScene(scene.id, {
                   originalVisualDescription: scene.originalVisualDescription || scene.visualDescription,
                   visualDescription: translated
               });
           } catch (e) {
               console.error(`Prompt translation failed for scene ${scene.number}`, e);
           }
      }
      setIsTranslating(false);
      setTranslatingState(null);
  };

  const handleTranslateScript = async (scene: Scene) => {
      if (scene.isLocked) return;
      if (!project.targetLanguage) {
          alert("Please select a Translation Language in Global Configuration first.");
          return;
      }
      setTranslatingState({ sceneId: scene.id, type: 'script' });
      try {
          const translated = await translateText(scene.script, project.targetLanguage);
          updateScene(scene.id, {
              originalScript: scene.originalScript || scene.script, 
              script: translated,
              audioUrl: undefined
          });
      } catch (e) {
          console.error("Translation failed", e);
      } finally {
          setTranslatingState(null);
      }
  };

  const handleRestoreScript = (scene: Scene) => {
      if (scene.isLocked) return;
      if (!scene.originalScript) return;
      updateScene(scene.id, {
          script: scene.originalScript,
          originalScript: undefined,
          audioUrl: undefined
      });
  };

  const handleTranslateVisualPrompt = async (scene: Scene) => {
      if (scene.isLocked) return;
      if (!project.targetLanguage) {
          alert("Please select a Translation Language in Global Configuration first.");
          return;
      }
      setTranslatingState({ sceneId: scene.id, type: 'visual' });
      try {
          const translated = await translateVisualPrompt(scene.visualDescription, project.targetLanguage);
          updateScene(scene.id, {
              originalVisualDescription: scene.originalVisualDescription || scene.visualDescription,
              visualDescription: translated
          });
      } catch (e) {
          console.error("Prompt translation failed", e);
      } finally {
          setTranslatingState(null);
      }
  };
  
  const handleScanText = async (scene: Scene) => {
      if (!scene.imageUrl) return;
      if (!project.targetLanguage) {
          alert("Please select a target language first in Global Configuration.");
          return;
      }
      
      setScanningId(scene.id);
      try {
          const result = await scanAndTranslateImageText(scene.imageUrl, project.targetLanguage);
          alert(`SCANNED TEXT RESULTS (${project.targetLanguage}):\n\n${result}`);
      } catch (e) {
          console.error(e);
          alert("Failed to scan text.");
      } finally {
          setScanningId(null);
      }
  };

  const handleRestoreVisualPrompt = (scene: Scene) => {
      if (scene.isLocked) return;
      if (!scene.originalVisualDescription) return;
      updateScene(scene.id, {
          visualDescription: scene.originalVisualDescription,
          originalVisualDescription: undefined
      });
  };

  const handleQuickPreview = (sceneNumber: number) => {
      setProject(prev => ({
          ...prev,
          exportStartScene: sceneNumber,
          exportEndScene: sceneNumber,
          shouldAutoPlay: true, 
          currentStep: 'preview',
      }));
  };

  const downloadImage = (url: string, sceneNumber: number) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sceneNumber}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };

  const handleHandUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        const result = ev.target?.result as string;
        const newHand: HandOption = {
            id: `custom-${Date.now()}`,
            name: file.name.replace(/\.[^/.]+$/, "").substring(0, 12),
            category: 'Custom',
            src: result,
            isCustom: true,
            tipOffset: { x: 0.5, y: 0.5 }, 
            scale: 0.3 
        };
        setProject(prev => ({
            ...prev,
            customHands: [...prev.customHands, newHand],
            selectedHandId: newHand.id,
            showHand: true
        }));
        setSelectingHandForSceneId(null);
        setCalibrationScale(0.3);
        setCalibratingHand(newHand);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const saveCalibration = (handId: string, x: number, y: number) => {
      const updatedHands = project.customHands.map(h => 
          h.id === handId ? { ...h, tipOffset: { x, y }, scale: calibrationScale } : h
      );
      setProject(prev => ({ ...prev, customHands: updatedHands }));
      setCalibratingHand(prev => prev ? ({...prev, tipOffset: { x, y }, scale: calibrationScale}) : null);
  };

  const nudgeCalibration = (dx: number, dy: number) => {
      if (!calibratingHand) return;
      const currentX = calibratingHand.tipOffset?.x ?? 0.5;
      const currentY = calibratingHand.tipOffset?.y ?? 0.5;
      const newX = Math.max(0, Math.min(1, currentX + dx));
      const newY = Math.max(0, Math.min(1, currentY + dy));
      const newHand = { ...calibratingHand, tipOffset: { x: newX, y: newY } };
      setCalibratingHand(newHand);
      const updatedHands = project.customHands.map(h => 
          h.id === calibratingHand.id ? { ...h, tipOffset: { x: newX, y: newY } } : h
      );
      setProject(prev => ({ ...prev, customHands: updatedHands }));
  };

  useEffect(() => {
      if (!calibratingHand) return;
      const handler = (e: KeyboardEvent) => {
          const step = e.shiftKey ? 0.01 : 0.001;
          if (e.key === 'ArrowUp') { e.preventDefault(); nudgeCalibration(0, -step); }
          if (e.key === 'ArrowDown') { e.preventDefault(); nudgeCalibration(0, step); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeCalibration(-step, 0); }
          if (e.key === 'ArrowRight') { e.preventDefault(); nudgeCalibration(step, 0); }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
  }, [calibratingHand]);

  const applyCardPhysics = (sceneId: string) => {
      const pending = pendingChanges[sceneId];
      if (pending) {
          updateScene(sceneId, { 
              customPace: pending.speed !== undefined ? pending.speed : undefined, 
              customWobble: pending.wobble !== undefined ? pending.wobble : undefined
          });
          const next = {...pendingChanges};
          delete next[sceneId];
          setPendingChanges(next);
      }
  };

  const updatePending = (sceneId: string, type: 'speed' | 'wobble', val: number) => {
      setPendingChanges(prev => ({
          ...prev,
          [sceneId]: {
              ...prev[sceneId],
              [type]: val
          }
      }));
  };

  const handleInsertScene = (indexToInsertAfter: number, type: 'standard' | 'video') => {
      const uniqueId = `scene-insert-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const newScene: Scene = {
          id: uniqueId,
          type: type,
          number: indexToInsertAfter + 2, 
          script: "",
          visualDescription: type === 'standard' ? "A new scene..." : "Describe your video generation prompt...",
          isGenerating: false,
          customPace: project.drawingPace || 0.5,
          customWobble: project.spreadLevel || 5,
          sfxVolume: 0.2,
          videoGenerationConfig: type === 'video' ? {
              model: 'veo-3.1-fast-generate-preview',
              prompt: "", 
              durationSeconds: 8
          } : undefined
      };
      
      const newScenes = [...project.scenes];
      newScenes.splice(indexToInsertAfter + 1, 0, newScene);
      
      setProject(prev => ({ ...prev, scenes: renumberScenes(newScenes) }));
  };

  const getSceneBlendMode = (scene: Scene, hasBg: boolean) => {
      if (!hasBg) return 'normal';
      return scene.layerBlendMode || 'multiply'; 
  };

  const handleIndividualAudioUpload = (sceneId: string, file: File) => {
      if (!file) return;
      if (!file.type.startsWith('audio/')) {
          alert("Please upload a valid audio file (MP3/WAV).");
          return;
      }
      
      const scene = project.scenes.find(s => s.id === sceneId);
      if (scene && scene.audioUrl) {
          if (!window.confirm("Overwrite existing audio narration?")) return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
          updateScene(sceneId, { audioUrl: e.target?.result as string });
      }
      reader.readAsDataURL(file);
  };
  
  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-32">
      {/* ... (Header code unchanged) ... */}
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="bg-white dark:bg-slate-900 p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
            <div className="flex items-center gap-3">
                <Film className="text-highlight" size={24} />
                <div>
                    <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">{project.topic || "Untitled Project"}</h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{project.scenes.length} Scenes • {project.niche} • {project.artStyle}</p>
<button onClick={() => setShowJackTheRipper(true)} className="mt-2 bg-gradient-to-r from-red-600 to-orange-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow flex items-center gap-1"><Scissors size={14}/> Jack The Ripper</button>
                </div>
            </div>
            
            <div className="flex items-center gap-4">
                 <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                     <span className="text-[10px] font-bold text-slate-400 uppercase">JUMP TO SCENE</span>
                     <input 
                        type="text" 
                        value={jumpToScene} 
                        onChange={(e) => setJumpToScene(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleScrollToScene(jumpToScene)}
                        placeholder="#" 
                        className="w-12 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5 text-center text-xs font-bold focus:border-highlight focus:outline-none"
                     />
                 </div>
                 <button onClick={() => setShowConfig(!showConfig)} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                     {showConfig ? <ChevronUp size={20}/> : <ChevronDown size={20}/>}
                 </button>
            </div>
        </div>
        
        {showConfig && (
        <div className="p-6 bg-slate-50/50 dark:bg-slate-950/50">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <div className="space-y-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><Settings2 size={12}/> Global Configuration</h3>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm space-y-3">
                            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1"><Mic size={10}/> Narrator</label>
                            
                            {/* UPDATED VOICE SELECTOR WITH GENAIPRO GLOBE */}
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        {project.voiceProvider === 'GenAiPro' ? <Globe size={12} className="text-blue-500"/> : <Mic size={12} className="text-slate-400"/>}
                                    </div>
                                    <select 
                                        value={project.voice} 
                                        onChange={(e) => {
                                            // Handle internal static list changes
                                            const v = TTS_VOICES.find(v => v.id === e.target.value);
                                            // Fix: Only pass config if provider is GenAiPro, else undefined to clear it/ignore it
                                            if (v) handleVoiceSelected(v, v.provider === 'GenAiPro' ? (project.genAiProConfig || DEFAULT_GENAIPRO_CONFIG) : undefined);
                                        }} 
                                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-2 font-bold text-slate-700 dark:text-slate-200 text-xs focus:border-highlight focus:outline-none focus:bg-white dark:focus:bg-slate-800 transition-all"
                                    >
                                        {project.voiceProvider === 'GenAiPro' && (
                                            <option value={project.voice}>{selectedVoiceLabel}</option>
                                        )}
                                        <optgroup label="GenAiPro (Labs)">{TTS_VOICES.filter(v => v.provider === 'GenAiPro').map(v => (<option key={v.id} value={v.id}>{v.label} ({v.desc})</option>))}</optgroup>
                                        <optgroup label="Google - Male">{TTS_VOICES.filter(v => v.provider === 'Google' && v.gender === 'Male').map(v => (<option key={v.id} value={v.id}>{v.label} ({v.desc})</option>))}</optgroup>
                                        <optgroup label="Google - Female">{TTS_VOICES.filter(v => v.provider === 'Google' && v.gender === 'Female').map(v => (<option key={v.id} value={v.id}>{v.label} ({v.desc})</option>))}</optgroup>
                                        <optgroup label="LMNT (Premium)">{TTS_VOICES.filter(v => v.provider === 'LMNT').map(v => (<option key={v.id} value={v.id}>{v.label} ({v.desc})</option>))}</optgroup>
                                    </select>
                                </div>
                                
                                <button 
                                    onClick={() => setShowVoiceSelector(true)}
                                    className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg transition-colors shadow-sm" 
                                    title="Open GenAiPro Voice Search" aria-label="Open GenAiPro Voice Search"
                                >
                                    <Globe size={14} />
                                </button>
                                
                                <button onClick={() => handleAuditionVoice(project.voice)} disabled={!!auditioningVoice} className="bg-orange-50 dark:bg-orange-900/20 text-highlight p-2 rounded-lg hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors" title="Audition" aria-label="Audition">
                                    {auditioningVoice ? <Loader2 size={14} className="animate-spin"/> : <Play size={14} />}
                                </button>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <select 
                                    disabled={project.voiceProvider === 'GenAiPro'} // Disable style for GenAiPro as it uses stability settings
                                    value={['Storytelling', 'Documentary', 'Funny', 'Energetic', 'Whispering', 'Angry', 'News', 'Cheerful', 'Sad'].includes(project.narrationStyle || '') ? project.narrationStyle : 'Custom'} 
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if(val === 'Custom') setProject(prev => ({...prev, narrationStyle: ''}));
                                        else setProject(prev => ({...prev, narrationStyle: val}));
                                    }}
                                    className={`bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 font-bold text-slate-700 dark:text-slate-200 text-xs focus:border-highlight focus:outline-none focus:bg-white dark:focus:bg-slate-800 transition-all flex-1 ${project.voiceProvider === 'GenAiPro' ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <option value="Storytelling">Storytelling (Default)</option>
                                    <option value="Documentary">Documentary / Facts</option>
                                    <option value="Funny">Funny / Comedic</option>
                                    <option value="Energetic">Energetic / Hype</option>
                                    <option value="Whispering">Whispering / ASMR</option>
                                    <option value="Angry">Angry / Intense</option>
                                    <option value="News">Professional News</option>
                                    <option value="Cheerful">Cheerful / Happy</option>
                                    <option value="Sad">Sad / Somber</option>
                                    <option value="Custom">Custom...</option>
                                </select>
                                {project.voiceProvider === 'GenAiPro' && (
                                    <span className="text-[10px] text-blue-400 font-bold px-2">Using V3 Config</span>
                                )}
                            </div>
                        </div>

                        {/* Coherent Flow - Unchanged */}
                        <div className="p-4 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 rounded-xl shadow-sm space-y-3">
                             <label className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase flex items-center gap-1"><Split size={10}/> Coherent Flow V1</label>
                             <div className="flex items-center gap-2">
                                 <input type="number" min="1" max={coherentEnd} value={coherentStart} onChange={e => setCoherentStart(parseInt(e.target.value))} className="w-12 bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 rounded px-1 py-1.5 text-xs font-bold text-center text-emerald-800 dark:text-emerald-300"/>
                                 <span className="text-emerald-400 text-xs font-bold">TO</span>
                                 <input type="number" min={coherentStart} max={project.scenes.length} value={coherentEnd} onChange={e => setCoherentEnd(parseInt(e.target.value))} className="w-12 bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 rounded px-1 py-1.5 text-xs font-bold text-center text-emerald-800 dark:text-emerald-300"/>
                                 <button 
                                    onClick={handleGenerateCoherentAudio} 
                                    disabled={isCoherentGenerating} 
                                    className="flex-1 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold hover:bg-emerald-700 flex items-center justify-center gap-1 shadow-sm disabled:opacity-50 transition-all active:scale-95"
                                 >
                                     {isCoherentGenerating ? <Loader2 size={12} className="animate-spin"/> : <Wand2 size={12} className="mr-1"/>} 
                                     Generate
                                 </button>
                             </div>
                             <p className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium">Auto-splits using silence detection.</p>
                        </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm flex items-center gap-4">
                         <div className="flex-1">
                             <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1 mb-1"><Languages size={10}/> Target Language</label>
                             <select value={project.targetLanguage || ""} onChange={handleLanguageChange} disabled={isTranslating} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 font-bold text-slate-700 dark:text-slate-200 text-xs focus:border-highlight focus:outline-none">
                                   <option value="">Select Language...</option>
                                   {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                              </select>
                         </div>
                         <div className="flex gap-2">
                             <button onClick={handleTranslateAllScripts} disabled={isTranslating || !project.targetLanguage} className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-2 rounded-lg text-[10px] font-bold flex flex-col items-center justify-center gap-1 w-24 h-full transition-colors">
                                  {isTranslating ? <Loader2 size={12} className="animate-spin"/> : <Mic size={14}/>} 
                                  <span>Translate Script</span>
                             </button>
                             <button onClick={handleTranslateAllPrompts} disabled={isTranslating || !project.targetLanguage} className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-2 rounded-lg text-[10px] font-bold flex flex-col items-center justify-center gap-1 w-24 h-full transition-colors">
                                  {isTranslating ? <Loader2 size={12} className="animate-spin"/> : <Eye size={14}/>}
                                  <span>Translate Visuals</span>
                             </button>
                         </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><Sliders size={12}/> Audio Mixer</h3>
                        <button onClick={applyAudioSettings} disabled={!audioSettingsChanged} className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-all ${audioSettingsChanged ? 'bg-highlight text-white shadow-sm' : 'text-slate-300'}`}>{audioSettingsChanged ? 'Apply Changes' : 'Levels Saved'}</button>
                    </div>
                    <div className="grid grid-cols-4 gap-4 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm">
                         <div className="flex flex-col gap-2">
                             <label className="text-[9px] font-bold text-blue-500 uppercase flex items-center gap-1"><Mic2 size={10} /> Narrator</label>
                             <input type="range" min="0" max="1" step="0.1" value={localNarrMaster} onChange={(e) => { setLocalNarrMaster(parseFloat(e.target.value)); setAudioSettingsChanged(true); }} className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"/>
                         </div>
                         <div className="flex flex-col gap-2">
                             <label className="text-[9px] font-bold text-green-600 uppercase flex items-center gap-1"><Music size={10} /> SFX</label>
                             <input type="range" min="0" max="1" step="0.1" value={localSfxMaster} onChange={(e) => { setLocalSfxMaster(parseFloat(e.target.value)); setAudioSettingsChanged(true); }} className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-green-600"/>
                         </div>
                         <div className="flex flex-col gap-2">
                             <label className="text-[9px] font-bold text-purple-600 uppercase flex items-center gap-1"><Disc size={10} /> Music</label>
                             <input type="range" min="0" max="1" step="0.1" value={localMusicMaster} onChange={(e) => { setLocalMusicMaster(parseFloat(e.target.value)); setAudioSettingsChanged(true); }} className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-600"/>
                         </div>
                         <div className="flex flex-col gap-2 border-l pl-4 border-slate-100 dark:border-slate-800">
                             <label className="text-[9px] font-bold text-slate-900 dark:text-white uppercase flex items-center gap-1"><Speaker size={10} /> Master</label>
                             <input type="range" min="0" max="1" step="0.1" value={localGlobalMaster} onChange={(e) => { setLocalGlobalMaster(parseFloat(e.target.value)); setAudioSettingsChanged(true); }} className="w-full h-1.5 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-slate-900 dark:accent-white"/>
                         </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-orange-50/50 dark:bg-orange-900/10 border border-orange-100 dark:border-orange-900/30 rounded-xl p-4 flex flex-col justify-between gap-2">
                             <div className="flex items-center gap-2">
                                 <FileAudio size={16} className="text-highlight"/>
                                 <h4 className="text-xs font-bold text-orange-900 dark:text-orange-300 uppercase">Batch Audio</h4>
                             </div>
                             <label className="cursor-pointer bg-white dark:bg-slate-800 text-highlight px-3 py-2 rounded-lg text-[10px] font-bold border border-orange-200 dark:border-orange-900/50 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors shadow-sm text-center">
                                 Select Files (1.mp3)
                                 <input type="file" multiple accept=".mp3,.wav,audio/mpeg,audio/wav" className="hidden" onChange={handleAudioBatchInput} />
                             </label>
                        </div>
                        
                        <div className="bg-pink-50/50 dark:bg-pink-900/10 border border-pink-100 dark:border-pink-900/30 rounded-xl p-4 flex flex-col justify-between gap-2">
                             <div className="flex items-center gap-2">
                                 <ImageIcon size={16} className="text-pink-500"/>
                                 <h4 className="text-xs font-bold text-pink-900 dark:text-pink-300 uppercase">Batch Images</h4>
                             </div>
                             <label className="cursor-pointer bg-white dark:bg-slate-800 text-pink-600 px-3 py-2 rounded-lg text-[10px] font-bold border border-pink-200 dark:border-pink-900/50 hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-colors shadow-sm text-center">
                                 Select Files (1.png)
                                 <input type="file" multiple accept="image/*" className="hidden" onChange={handleBulkImageImport} />
                             </label>
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="flex flex-wrap items-center justify-between gap-4 pt-6 mt-2 border-t border-slate-200/50 dark:border-slate-800/50">
                <div className="flex items-center gap-3">
                    <button 
                        onClick={handleRegenerateAllAudio}
                        disabled={isRegeneratingAllAudio}
                        className="px-4 py-2 bg-highlight text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 shadow-sm flex items-center gap-2 text-xs font-bold transition-all"
                    >
                        {isRegeneratingAllAudio ? <Loader2 size={14} className="animate-spin"/> : <Volume2 size={14} />}
                        {isRegeneratingAllAudio ? regenProgress : (project.scenes.some(s => s.audioUrl) ? "Generate Missing Audio" : "Generate All Audio")}
                    </button>
                    
                    <button onClick={handleGenerateAllVisuals} className="px-4 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded-lg text-xs font-bold flex items-center gap-2 border border-slate-200 dark:border-slate-700 shadow-sm transition-all">
                        <ImageIcon size={14}/> Gen Missing Images
                    </button>
                </div>

                <div className="flex items-center gap-2">
                     <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-1 flex items-center gap-1 shadow-sm">
                        <label className="cursor-pointer flex items-center gap-2 hover:bg-purple-50 dark:hover:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-3 py-1.5 rounded-md text-[10px] font-bold transition-colors">
                              <Upload size={12}/> {project.musicUrl ? 'Change Music' : 'Add BG Music'}
                              <input type="file" accept="audio/mp3,audio/wav" className="hidden" onChange={handleMusicUpload} />
                        </label>
                        {project.globalSfxUrl && (
                              <button onClick={handleApplyAudioToAll} className="hover:bg-green-50 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400 px-3 py-1.5 rounded-md text-[10px] font-bold flex items-center gap-1" title="Apply Global SFX to All Cards" aria-label="Apply Global SFX to All Cards">
                                  <CopyCheck size={12} /> Sync SFX
                              </button>
                        )}
                         <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700 mx-1"></div>
                         <button onClick={handleStopAllSound} className="p-1.5 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-md hover:bg-red-500 hover:text-white transition-all" title="STOP SOUND" aria-label="STOP SOUND">
                             <Octagon size={14} fill="currentColor" />
                         </button>
                     </div>

                     <button 
                        onClick={() => setProject(prev => ({
                            ...prev, 
                            currentStep: 'preview',
                            exportStartScene: 1,
                            exportEndScene: prev.scenes.length
                        }))}
                        className="h-9 px-5 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-lg flex items-center justify-center gap-2 hover:bg-slate-800 dark:hover:bg-slate-200 shadow-sm hover:translate-x-1 transition-all text-xs font-bold ml-4"
                     >
                         Go to Preview / Export <ArrowRight size={14} />
                     </button>
                </div>
            </div>
        </div>
        )}
      </div>
      
      {/* ... (Rest of Storyboard rendered list) ... */}
      <div className="space-y-6">
        {project.scenes.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center gap-3 py-16 px-6 rounded-2xl border-2 border-dashed border-[#CFAF8A] bg-[#FEFEFD] text-[#7A5A3F]" role="status">
            <ImageIcon size={40} className="text-[#CFAF8A]" aria-hidden="true" />
            <p className="text-lg font-bold text-[#1B1009]">No scenes yet</p>
            <p className="text-sm max-w-md">Write or generate a script first, then come back here to draw each scene on paper.</p>
            <button onClick={() => setProject(prev => ({ ...prev, currentStep: 'script' }))} className="mt-2 px-5 py-2 rounded-full bg-[#D66A3A] hover:bg-[#b9552a] text-white text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B1009]" aria-label="Go to script editor">Go to Script</button>
          </div>
        )}
        {project.scenes.map((scene, index) => {
          const bgUrl = getActiveBackgroundUrl(scene);
          const isCoherent = scene.audioUrl && scene.mediaStart !== undefined && scene.mediaEnd !== undefined;
          
          return (
          <div key={scene.id} className={`relative group/card-wrapper ${scene.isDisabled ? 'opacity-50 grayscale' : ''}`}>
              <div 
                  id={`scene-${scene.id}`} 
                  ref={el => { if(el) sceneRefs.current.set(scene.id, el) }} 
                  className={`relative bg-white dark:bg-slate-900 rounded-xl border transition-all duration-200 ${dragOverSceneId === scene.id ? 'border-highlight ring-2 ring-orange-100 scale-[1.01]' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md'} shadow-sm`} 
                  onDragOver={(e) => { e.preventDefault(); setDragOverSceneId(scene.id); }} 
                  onDragLeave={() => setDragOverSceneId(null)} 
                  onDrop={(e: React.DragEvent<HTMLDivElement>) => { 
                      e.preventDefault(); 
                      setDragOverSceneId(null); 
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                          const file0 = e.dataTransfer.files[0] as File;
                          if (file0) {
                             if (file0.type.startsWith('image/')) handleReplaceImage(scene.id, file0);
                             else if (file0.type.startsWith('video/')) handleReplaceImage(scene.id, file0);
                             else if (file0.type.startsWith('audio/')) {
                                  if (e.dataTransfer.files.length > 1) {
                                      processAudioFiles(e.dataTransfer.files);
                                  } else {
                                      processAudioFiles(e.dataTransfer.files, scene.id);
                                  }
                             }
                          }
                      }
                  }}
              >
                {/* Scene Header */}
                <div className={`flex justify-between items-center px-4 py-3 border-b rounded-t-xl ${scene.type === 'video' ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'}`}>
                    <div className="flex items-center gap-3">
                         <div className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase flex items-center gap-2 tracking-wide ${scene.type === 'video' ? 'bg-highlight text-white' : 'bg-[#CFAF8A]/25 dark:bg-slate-800 text-[#7A5A3F] dark:text-slate-400'}`}>
                             {scene.type === 'video' ? <FilmIcon size={12}/> : <ImageIcon size={12}/>} 
                             {scene.isDisabled ? 'DISABLED' : (scene.type === 'video' ? 'VIDEO SCENE' : 'SCENE')} 
                             <span className="opacity-100 text-slate-900 dark:text-white font-extrabold text-sm ml-1">#{scene.number}</span>
                         </div>
                    </div>
                    
                    <div className="flex items-center gap-1 opacity-60 group-hover/card-wrapper:opacity-100 focus-within:opacity-100 transition-opacity flex-wrap justify-end">
                        <button onClick={(e) => handleDuplicateScene(e, scene.id)} className={`p-1.5 rounded-lg transition-all ${scene.type === 'video' ? 'hover:bg-slate-700 text-slate-400 hover:text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-highlight'}`} title="Duplicate Scene" aria-label="Duplicate Scene"><Copy size={14}/></button>
                        <button onClick={(e) => handleMoveScene(e, scene.id, 'up')} disabled={index === 0} className={`p-1.5 rounded-lg transition-all disabled:opacity-20 disabled:hover:bg-transparent ${scene.type === 'video' ? 'hover:bg-slate-700 text-slate-400 hover:text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-highlight'}`} title="Move Up" aria-label="Move Up"><ChevronUp size={14}/></button>
                        <button onClick={(e) => handleMoveScene(e, scene.id, 'down')} disabled={index === project.scenes.length - 1} className={`p-1.5 rounded-lg transition-all disabled:opacity-20 disabled:hover:bg-transparent ${scene.type === 'video' ? 'hover:bg-slate-700 text-slate-400 hover:text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-highlight'}`} title="Move Down" aria-label="Move Down"><ChevronDown size={14}/></button>
                        <button onClick={(e) => handleMoveToLast(e, scene.id)} disabled={index === project.scenes.length - 1} className={`p-1.5 rounded-lg transition-all disabled:opacity-20 disabled:hover:bg-transparent ${scene.type === 'video' ? 'hover:bg-slate-700 text-slate-400 hover:text-blue-400' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-violet-600'}`} title="Move Card to End" aria-label="Move Card to End"><ArrowDownCircle size={14}/></button>
                        <div className="w-[1px] h-4 bg-slate-200 dark:bg-slate-700 mx-1"></div>
                        <button onClick={(e) => toggleDisableScene(e, scene.id)} className={`p-1.5 rounded-lg transition-all ${scene.isDisabled ? 'text-white bg-amber-500 hover:bg-amber-600' : (scene.type === 'video' ? 'text-slate-400 hover:text-amber-400 hover:bg-slate-800' : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20')}`} title={scene.isDisabled ? "Enable Card" : "Disable Card"} aria-label={scene.isDisabled ? "Enable Card" : "Disable Card"}><Power size={14}/></button>
                        <button onClick={() => toggleSceneLock(scene.id)} className={`p-1.5 rounded-lg transition-all ${scene.isLocked ? 'text-white bg-pink-500 hover:bg-pink-600' : (scene.type === 'video' ? 'text-slate-400 hover:text-pink-400 hover:bg-slate-800' : 'text-slate-400 hover:text-pink-600 hover:bg-pink-50 dark:hover:bg-pink-900/20')}`} title={scene.isLocked ? "Unlock Card" : "Lock Card"} aria-label={scene.isLocked ? "Unlock Card" : "Lock Card"}>{scene.isLocked ? <Lock size={14}/> : <Unlock size={14}/>}</button>
                    </div>
                </div>

                <div className={`w-full border-b border-[#CFAF8A]/40 relative group overflow-hidden aspect-[3/2] ${scene.type === 'video' ? 'bg-black' : 'bg-[#FEFEFD] dark:bg-[#FEFEFD]'}`}>
                     {scene.type !== 'video' && bgUrl && (
                         <div className="absolute inset-0 z-0">
                             <img src={bgUrl} className="w-full h-full object-cover opacity-100" />
                         </div>
                     )}

                     {scene.type === 'video' ? (
                        <>
                            {scene.videoUrl ? (
                                <>
                                    <video src={scene.videoUrl} className="w-full h-full object-contain bg-black" controls />
                                    <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-30">
                                        <button onClick={() => handleQuickPreview(scene.number)} className="p-3 bg-white rounded-full text-slate-900 hover:text-highlight shadow-lg transition-transform hover:scale-110" title="Play Video in Preview Mode" aria-label="Play Video in Preview Mode"><Play size={24} fill="currentColor" /></button>
                                        <label className={`p-3 bg-white rounded-full text-slate-900 hover:text-highlight shadow-lg cursor-pointer transition-transform hover:scale-110 ${scene.isLocked ? 'opacity-50 pointer-events-none' : ''}`} title="Replace Video" aria-label="Replace Video"><Upload size={20} /><input type="file" accept="video/*" className="hidden" disabled={scene.isLocked} onChange={(e) => e.target.files?.[0] && handleReplaceImage(scene.id, e.target.files[0])} /></label>
                                    </div>
                                    <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4 z-30 opacity-0 group-hover:opacity-100 transition-opacity px-4 pointer-events-none">
                                        <div className="flex items-center gap-2 bg-highlight/90 backdrop-blur-sm p-2 rounded-lg shadow-lg border-2 border-white pointer-events-auto">
                                            <span className="text-[10px] font-bold text-black uppercase bg-white px-1.5 py-0.5 rounded">START (s)</span>
                                            <input type="number" step="0.01" min="0" value={scene.videoMediaStart ?? 0} onChange={(e) => updateScene(scene.id, { videoMediaStart: Math.max(0, parseFloat(e.target.value)) })} className="w-20 bg-black text-white font-mono text-sm font-bold text-center border-none focus:ring-0 rounded" />
                                        </div>
                                        <div className="flex items-center gap-2 bg-highlight/90 backdrop-blur-sm p-2 rounded-lg shadow-lg border-2 border-white pointer-events-auto">
                                            <span className="text-[10px] font-bold text-black uppercase bg-white px-1.5 py-0.5 rounded">END (s)</span>
                                            <input type="number" step="0.01" min="0" value={scene.videoMediaEnd ?? scene.videoDuration ?? 0} onChange={(e) => updateScene(scene.id, { videoMediaEnd: parseFloat(e.target.value) })} className="w-20 bg-black text-white font-mono text-sm font-bold text-center border-none focus:ring-0 rounded" />
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="w-full h-full flex flex-col p-4">
                                    <div className="flex-1 border border-slate-700 rounded-lg bg-slate-800/50 flex flex-col items-center justify-center text-center p-6 gap-4 relative overflow-hidden">
                                        {scene.videoGenerationConfig?.inputImageUrl && (
                                            <div className="absolute inset-0 z-0 opacity-20">
                                                <img src={scene.videoGenerationConfig.inputImageUrl} className="w-full h-full object-cover" />
                                            </div>
                                        )}
                                        
                                        {scene.isGenerating ? (
                                            <div className="flex flex-col items-center gap-3 relative z-10">
                                                <Loader2 size={48} className="text-highlight animate-spin" />
                                                <span className="text-white font-bold animate-pulse">Generating Video with Veo...</span>
                                                <span className="text-slate-400 text-xs">This may take a minute.</span>
                                                <button onClick={(e) => { e.stopPropagation(); updateScene(scene.id, { isGenerating: false }); }} className="text-[10px] text-red-400 hover:text-red-500 font-bold underline mt-2">Stuck? Reset</button>
                                            </div>
                                        ) : (
                                            <div className="relative z-10 w-full max-w-md flex flex-col items-center">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Wand2 size={24} className="text-highlight"/>
                                                    <h3 className="text-lg font-bold text-white">AI Video Generator</h3>
                                                </div>
                                                
                                                {scene.videoGenerationConfig?.inputImageUrl && (
                                                    <div className="mb-2 bg-orange-900/50 text-orange-200 text-[10px] font-bold px-2 py-1 rounded-full border border-orange-500/50">
                                                        Animating Source Image
                                                    </div>
                                                )}
                                                
                                                <div className="w-full space-y-3">
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <select value={scene.videoGenerationConfig?.model || 'veo-3.1-fast-generate-preview'} onChange={(e) => updateScene(scene.id, { videoGenerationConfig: { ...scene.videoGenerationConfig, model: e.target.value as VeoModel, prompt: scene.videoGenerationConfig?.prompt || scene.visualDescription || "", durationSeconds: scene.videoGenerationConfig?.durationSeconds || 8, inputImageUrl: scene.videoGenerationConfig?.inputImageUrl } })} className="bg-slate-900 border border-slate-600 text-white text-xs rounded p-2 focus:outline-none focus:border-highlight">
                                                            <option value="veo-3.1-fast-generate-preview">Veo 3.1 Fast</option>
                                                            <option value="veo-3.1-generate-preview">Veo 3.1 High Quality</option>
                                                        </select>
                                                        <select value={scene.videoGenerationConfig?.durationSeconds || 8} onChange={(e) => updateScene(scene.id, { videoGenerationConfig: { ...scene.videoGenerationConfig!, durationSeconds: parseInt(e.target.value) } })} className="bg-slate-900 border border-slate-600 text-white text-xs rounded p-2 focus:outline-none focus:border-highlight">
                                                            <option value={4}>4 Seconds</option>
                                                            <option value={6}>6 Seconds</option>
                                                            <option value={8}>8 Seconds</option>
                                                        </select>
                                                    </div>
                                                    <textarea value={scene.videoGenerationConfig?.prompt ?? (scene.visualDescription || "")} onChange={(e) => updateScene(scene.id, { videoGenerationConfig: { ...scene.videoGenerationConfig!, prompt: e.target.value } })} placeholder="Describe the video..." className="w-full bg-slate-900 border border-slate-600 text-white text-xs rounded p-2 h-20 resize-none focus:outline-none focus:border-highlight" />
                                                    <div className="flex gap-2">
                                                        <button onClick={() => handleGenerateVideo(scene)} disabled={scene.isLocked || !scene.videoGenerationConfig?.prompt} className="flex-1 bg-highlight hover:bg-orange-700 text-white py-2 rounded font-bold text-xs shadow-lg transition-all disabled:opacity-50">
                                                            {scene.videoGenerationConfig?.inputImageUrl ? "Animate Image" : "Generate Video"}
                                                        </button>
                                                        <label className="cursor-pointer bg-slate-700 text-white px-4 py-2 rounded text-xs font-bold hover:bg-slate-600 transition-all flex items-center gap-2">
                                                            <Upload size={14}/> Upload
                                                            <input type="file" accept="video/*" className="hidden" disabled={scene.isLocked} onChange={(e) => e.target.files?.[0] && handleReplaceImage(scene.id, e.target.files[0])} />
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                     ) : (
                         <>
                             {scene.imageUrl ? (
                                <>
                                    <img src={scene.imageUrl} alt={`Scene ${scene.number}`} className="w-full h-full object-contain cursor-zoom-in relative z-10" style={{ mixBlendMode: bgUrl ? (scene.layerBlendMode || 'multiply') : 'normal' }} onClick={() => setFullscreenImage(scene.imageUrl || null)} />
                                    <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-30">
                                        <button onClick={() => handleQuickPreview(scene.number)} className="p-3 bg-white/90 backdrop-blur rounded-full text-slate-900 hover:text-highlight shadow-md transition-transform hover:scale-110" title="Play Scene Preview" aria-label="Play Scene Preview"><Play size={20} fill="currentColor" /></button>
                                        <button onClick={() => setEditingScene(scene)} disabled={scene.isLocked} className="p-3 bg-white/90 backdrop-blur rounded-full text-slate-900 hover:text-highlight shadow-md transition-transform hover:scale-110 disabled:opacity-50 disabled:hover:scale-100" title="Magic Edit" aria-label="Magic Edit"><Wand2 size={20} /></button>
                                        <button onClick={(e) => handleAnimateImage(e, scene)} disabled={scene.isLocked || isPreparingAnimation} className="p-3 bg-highlight text-white rounded-full hover:bg-orange-700 shadow-md transition-transform hover:scale-110 disabled:opacity-50" title="Animate Image to Video (Veo)" aria-label="Animate Image to Video (Veo)">{isPreparingAnimation ? <Loader2 size={20} className="animate-spin"/> : <AnimateIcon size={20} />}</button>
                                        <label className={`p-3 bg-white/90 backdrop-blur rounded-full text-slate-900 hover:text-highlight shadow-md cursor-pointer transition-transform hover:scale-110 ${scene.isLocked ? 'opacity-50 pointer-events-none' : ''}`} title="Replace Image" aria-label="Replace Image"><Upload size={20} /><input type="file" accept="image/*" className="hidden" disabled={scene.isLocked} onChange={(e) => e.target.files?.[0] && handleReplaceImage(scene.id, e.target.files[0])} /></label>
                                        <button onClick={() => scene.imageUrl && handleSmartDownload(scene)} className="p-3 bg-white/90 backdrop-blur rounded-full text-slate-900 hover:text-highlight shadow-md transition-transform hover:scale-110" title="Download Image" aria-label="Download Image"><Download size={20} /></button>
                                    </div>
                                    <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-2 z-20 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                        <button onClick={() => handleGenerateImage(scene)} disabled={scene.isLocked} className="bg-highlight hover:bg-orange-700 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2 hover:scale-105 transition-all backdrop-blur-sm"><RefreshCw size={14}/> Re-generate</button>
                                    </div>
                                </>
                             ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2 relative z-10 p-4">
                                    {scene.isGenerating ? (
                                        <div className="flex flex-col items-center gap-2">
                                            <Loader2 className="animate-spin text-[#D66A3A]" size={32} aria-hidden="true" />
                                            <span className="text-xs font-bold text-[#7A5A3F]" role="status" aria-live="polite">Drawing scene {scene.number}...</span>
                                            <button onClick={(e) => { e.stopPropagation(); updateScene(scene.id, { isGenerating: false }); }} className="text-[10px] text-red-400 hover:text-red-500 font-bold underline mt-2">Stuck? Reset</button>
                                        </div>
                                    ) : (
                                        <>
                                            <ImageIcon size={32} />
                                            <span className="text-xs font-bold mb-4">Waiting for generation</span>
                                            <div className="flex flex-col gap-2 items-center">
                                                <button onClick={() => handleGenerateImage(scene)} disabled={scene.isLocked} className="bg-highlight hover:bg-orange-700 text-white px-6 py-2.5 rounded-full text-sm font-bold shadow-sm flex items-center gap-2 hover:scale-105 transition-all"><RefreshCw size={16}/> Generate Image</button>
                                                <label className={`cursor-pointer text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 hover:underline transition-all flex items-center gap-1 ${scene.isLocked ? 'opacity-50 pointer-events-none' : ''}`}><Upload size={12}/> or Upload<input type="file" accept="image/*" className="hidden" disabled={scene.isLocked} onChange={(e) => e.target.files?.[0] && handleReplaceImage(scene.id, e.target.files[0])} /></label>
                                            </div>
                                        </>
                                    )}
                                </div>
                             )}
                         </>
                     )}
                </div>

                <div className={`grid grid-cols-1 lg:grid-cols-2 gap-8 p-6 transition-colors ${isCoherent ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''}`}>
                    <div className="space-y-5">
                        <div className="flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                                <label className={`text-[10px] font-bold uppercase flex items-center gap-1 ${isCoherent ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                    <Mic size={10}/> Narration Script {isCoherent && '(COHERENT FLOW)'}
                                </label>
                                <div className="flex items-center gap-1">
                                    {scene.audioUrl ? (
                                        <>
                                            <button onClick={() => handlePlayAudio(scene.audioUrl!, scene.id, scene.mediaStart, scene.mediaEnd)} className={`p-1.5 rounded transition-colors flex items-center gap-1 ${playingAudioId === scene.id ? 'bg-highlight text-white' : 'bg-orange-50 dark:bg-orange-900/20 text-highlight hover:text-orange-700 dark:hover:text-orange-400'}`}>
                                                {playingAudioId === scene.id ? <><Square size={12} fill="currentColor"/> Stop</> : <><Play size={12} fill="currentColor"/> Play</>}
                                            </button>
                                            
                                            {playingAudioId === scene.id && (
                                                <button onClick={() => handleResetAudio(scene.id)} className="text-white bg-red-500 hover:bg-red-600 p-1.5 rounded font-bold text-[10px] flex items-center gap-1 animate-pulse">
                                                    <Octagon size={12} fill="currentColor"/> STOP
                                                </button>
                                            )}

                                            <button onClick={() => handleResetAudio(scene.id)} disabled={scene.isLocked} className="text-red-400 hover:text-red-600 bg-red-50 dark:bg-red-900/20 p-1.5 rounded disabled:opacity-50" title="Delete Audio" aria-label="Delete Audio"><Trash2 size={14}/></button>
                                        </>
                                    ) : (
                                        <label className={`cursor-pointer bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-1 shadow-sm transition-all active:scale-95 ${scene.isLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                                            <Upload size={12}/> Upload Audio
                                            <input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" className="hidden" disabled={scene.isLocked} onChange={(e) => e.target.files?.[0] && handleIndividualAudioUpload(scene.id, e.target.files[0])} />
                                        </label>
                                    )}
                                    <button onClick={() => handleGenerateAudio(scene)} disabled={generatingAudioId === scene.id || !scene.script.trim() || scene.isLocked || isCoherent} className={`text-[10px] font-bold px-3 py-1.5 rounded flex items-center gap-1 h-7 transition-all shadow-sm disabled:opacity-50 disabled:pointer-events-none ${isCoherent ? 'bg-slate-300 text-slate-500 grayscale cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-105 active:scale-95'}`}>
                                        {generatingAudioId === scene.id ? <Loader2 size={12} className="animate-spin"/> : "Gen TTS"}
                                    </button>
                                    <button onClick={() => handleTranslateScript(scene)} disabled={translatingState?.sceneId === scene.id || scene.isLocked} className="text-[10px] font-bold bg-highlight text-white hover:bg-orange-700 px-3 py-1.5 rounded flex items-center gap-1 h-7 transition-all hover:scale-105 active:scale-95 shadow-sm disabled:opacity-50 disabled:pointer-events-none">
                                        {translatingState?.sceneId === scene.id && translatingState.type === 'script' ? <Loader2 size={12} className="animate-spin"/> : <Languages size={12}/>} Translate Script
                                    </button>
                                </div>
                            </div>
                            <textarea disabled={scene.isLocked} value={scene.script} onChange={(e) => handleScriptChange(scene.id, e.target.value)} onKeyDown={(e) => handleScriptKeyDown(e, index)} className={`w-full h-24 p-3 border rounded-lg text-sm font-medium focus:border-highlight focus:bg-white dark:focus:bg-slate-800 focus:outline-none resize-none disabled:text-slate-400 transition-all ${isCoherent ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-slate-200'}`} placeholder="Enter narration text..." />
                            
                            {scene.originalScript && (
                                <div className="relative">
                                    <div className="text-[9px] font-bold text-slate-400 uppercase mb-1 ml-1">Original Script (Backup)</div>
                                    <textarea readOnly value={scene.originalScript} className="w-full h-20 p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-500 resize-none focus:outline-none cursor-not-allowed" />
                                    <button onClick={() => handleRestoreScript(scene)} disabled={scene.isLocked} className="absolute top-7 right-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm text-[10px] font-bold text-slate-600 dark:text-slate-300 px-2 py-1 rounded hover:bg-slate-50 hover:text-red-500 disabled:opacity-50">Restore Original</button>
                                </div>
                            )}
                        </div>
                        
                        {scene.type !== 'video' && (
                            <div className="flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><Wand2 size={10}/> Visual Prompt (AI Instructions)</label>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => handleTranslateVisualPrompt(scene)} disabled={translatingState?.sceneId === scene.id || scene.isLocked} className="text-[10px] font-bold bg-violet-600 text-white hover:bg-violet-700 px-3 py-1.5 rounded flex items-center gap-1 h-7 transition-all hover:scale-105 active:scale-95 shadow-sm disabled:opacity-50 disabled:pointer-events-none">
                                            {translatingState?.sceneId === scene.id && translatingState.type === 'visual' ? <Loader2 size={12} className="animate-spin"/> : <Languages size={12}/>} Translate
                                        </button>
                                    </div>
                                </div>
                                <textarea disabled={scene.isLocked} value={scene.visualDescription} onChange={(e) => updateScene(scene.id, { visualDescription: e.target.value })} className="w-full h-24 p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-highlight focus:bg-white dark:focus:bg-slate-800 focus:outline-none resize-none disabled:bg-slate-50 disabled:text-slate-400 dark:text-slate-200 transition-all" placeholder="Describe the image..." />
                                {scene.originalVisualDescription && (
                                    <div className="relative">
                                        <div className="text-[9px] font-bold text-slate-400 uppercase mb-1 ml-1">Original Prompt (Backup)</div>
                                        <textarea readOnly value={scene.originalVisualDescription} className="w-full h-20 p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-500 resize-none focus:outline-none cursor-not-allowed" />
                                        <button onClick={() => handleRestoreVisualPrompt(scene)} disabled={scene.isLocked} className="absolute top-7 right-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm text-[10px] font-bold text-slate-600 dark:text-slate-300 px-2 py-1 rounded hover:bg-slate-50 hover:text-red-500 disabled:opacity-50">Restore Original</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    
                    <div className="space-y-5 border-l border-slate-100 dark:border-slate-800 pl-8">
                         <div>
                             <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-2"><ImageIcon size={10}/> Scene Background</label>
                             <div className="flex items-center gap-2">
                                 {scene.backgroundUrl ? (
                                     <div className="relative w-16 h-9 rounded border border-slate-200 dark:border-slate-700 overflow-hidden group/bg">
                                         <img src={scene.backgroundUrl} className="w-full h-full object-cover" />
                                         <button onClick={() => updateScene(scene.id, { backgroundUrl: undefined })} disabled={scene.isLocked} className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover/bg:opacity-100 flex items-center justify-center transition-opacity"><X size={12}/></button>
                                     </div>
                                 ) : (
                                     <label className={`w-16 h-9 rounded border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-400 hover:text-highlight hover:border-orange-400 cursor-pointer transition-colors ${scene.isLocked ? 'pointer-events-none opacity-50' : ''}`}>
                                         <Upload size={12}/>
                                         <input type="file" accept="image/*" className="hidden" disabled={scene.isLocked} onChange={(e) => handleSceneBackgroundUpload(scene.id, e)} />
                                     </label>
                                 )}
                                 
                                 <div className="flex-1">
                                     <label className="flex items-center gap-2 cursor-pointer">
                                         <input type="checkbox" checked={scene.enableGlobalBackground ?? false} onChange={(e) => updateScene(scene.id, { enableGlobalBackground: e.target.checked })} disabled={!!scene.backgroundUrl || scene.isLocked} className="accent-highlight" />
                                         <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Activate blend mode</span>
                                     </label>
                                     <div className="text-[9px] text-slate-400 mt-1">
                                         {scene.backgroundUrl ? "Custom Override Active" : (scene.enableGlobalBackground ? "Blending Project Default" : "Standard (White/Default)")}
                                     </div>
                                 </div>
                             </div>
                             
                             {(scene.backgroundUrl || (scene.enableGlobalBackground)) && (
                                 <div className="mt-2">
                                      <label className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-1"><Blend size={10}/> Blend Mode</label>
                                      <select value={scene.layerBlendMode || 'multiply'} onChange={(e) => updateScene(scene.id, { layerBlendMode: e.target.value as any })} disabled={scene.isLocked} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold rounded px-2 py-1 text-slate-700 dark:text-slate-200 focus:outline-none">
                                          <option value="normal">Normal (Cover)</option>
                                          <option value="multiply">Multiply (Darken)</option>
                                          <option value="screen">Screen (Lighten)</option>
                                      </select>
                                 </div>
                             )}
                         </div>
                         
                         {scene.type !== 'video' && (
                             <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                 <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-2"><Activity size={10}/> Card Physics</label>
                                 
                                 <div className="mb-2">
                                     <div className="flex justify-between text-[9px] text-slate-500 dark:text-slate-400 mb-1 font-bold">
                                         <span>Drawing Speed</span>
                                         <span className={scene.customPace ? "text-highlight" : ""}>{scene.customPace ? `${scene.customPace}x` : 'Global'}</span>
                                     </div>
                                     <input type="range" min="0.1" max="5.0" step="0.1" value={scene.customPace !== undefined ? scene.customPace : project.drawingPace} onChange={(e) => updateScene(scene.id, { customPace: parseFloat(e.target.value) })} disabled={scene.isLocked} className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-600 dark:accent-slate-400" />
                                 </div>

                                 {project.showHand && (
                                     <div>
                                         <div className="flex justify-between text-[9px] text-slate-500 dark:text-slate-400 mb-1 font-bold">
                                             <span>Line Wobble</span>
                                             <span className={scene.customWobble !== undefined ? "text-highlight" : ""}>{scene.customWobble !== undefined ? `${scene.customWobble}%` : 'Global'}</span>
                                         </div>
                                         <input type="range" min="0" max="20" step="1" value={scene.customWobble !== undefined ? scene.customWobble : project.spreadLevel} onChange={(e) => updateScene(scene.id, { customWobble: parseInt(e.target.value) })} disabled={scene.isLocked} className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-600 dark:accent-slate-400" />
                                     </div>
                                 )}
                                 
                                 {(scene.customPace !== undefined || scene.customWobble !== undefined) && (
                                     <button onClick={() => updateScene(scene.id, { customPace: undefined, customWobble: undefined })} className="text-[9px] text-red-400 hover:text-red-600 mt-2 flex items-center gap-1 font-bold"><RotateCcw size={8}/> Reset to Global</button>
                                 )}
                             </div>
                         )}
                         
                         {project.showHand && (
                             <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                                 <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-2"><Hand size={10}/> Hand Override</label>
                                 <div className="flex items-center gap-2">
                                     <select value={scene.handId || ''} onChange={(e) => updateScene(scene.id, { handId: e.target.value || undefined })} disabled={scene.isLocked} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold rounded px-2 py-1 text-slate-700 dark:text-slate-200 focus:outline-none">
                                          <option value="">Default (Global)</option>
                                          {allHands.map(h => (
                                             <option key={h.id} value={h.id}>{h.name}</option>
                                         ))}
                                     </select>
                                 </div>
                                 <button onClick={handleApplyHandToAllScenes} className="text-[9px] text-highlight font-bold hover:underline mt-1 flex items-center gap-1"><CopyCheck size={10}/> Force Global Hand to All</button>
                             </div>
                         )}
                    </div>
                </div>
            </div>
          </div>
          );
        })}
      </div>
      
      {/* Modals and Overlays */}
      {editingScene && (
        <React.Suspense fallback={null}>
        <ImageEditModal 
          isOpen={!!editingScene} 
          onClose={() => setEditingScene(null)} 
          scene={editingScene} 
          aspectRatio={project.aspectRatio}
          onUpdateImage={(id, img) => updateScene(id, { imageUrl: img })} 
        />
        </React.Suspense>
      )}
      
      {/* Voice Selector Modal */}
      {showVoiceSelector && (
      <React.Suspense fallback={null}>
      <VoiceSelectorModal
          isOpen={showVoiceSelector}
          onClose={() => setShowVoiceSelector(false)}
          currentVoiceId={project.voice}
          currentConfig={project.genAiProConfig || {} as any}
          onSelectVoice={handleVoiceSelected}
      />
      </React.Suspense>
      )}

      {showFloatingSearch && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-slate-900/20 backdrop-blur-sm" onClick={() => setShowFloatingSearch(false)}>
              <div className="bg-white dark:bg-slate-900 p-2 rounded-xl shadow-2xl w-full max-w-lg transform scale-100 transition-all border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                  <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                      <input 
                          ref={floatingSearchInputRef}
                          type="text" 
                          value={floatingSearchQuery}
                          onChange={(e) => setFloatingSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                  handleScrollToScene(floatingSearchQuery);
                              }
                          }}
                          placeholder="Jump to Scene # or Search Script..." 
                          className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 rounded-lg text-lg font-bold text-slate-800 dark:text-slate-100 focus:outline-none"
                      />
                  </div>
              </div>
          </div>
      )}

      {fullscreenImage && (
          <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex items-center justify-center p-8" onClick={() => setFullscreenImage(null)}>
              <img src={fullscreenImage} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl border-4 border-white" onClick={e => e.stopPropagation()} />
              <button onClick={() => setFullscreenImage(null)} className="absolute top-4 right-4 text-white hover:text-gray-300 bg-white/20 p-2 rounded-full backdrop-blur-md transition-colors"><X size={32}/></button>
          </div>
      )}

      {/* Jack the Ripper Modal - Persistent Rendering */}
      <div style={{ display: showJackTheRipper ? 'flex' : 'none', position: 'fixed', inset: 0, zIndex: 100 }}>
          <JackTheRipper
              project={project}
              setProject={setProject}
              onClose={() => setShowJackTheRipper(false)}
              initialState={jackState}
              onPersistState={setJackState}
          />
      </div>
    </div>
  );
};

function base64ToBlob(base64: string): Blob {
  const arr = base64.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : '';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

export default Storyboard;
