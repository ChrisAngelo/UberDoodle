import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ProjectState } from '../types';
import { transcribeAudioAdvanced, matchTranscriptToScenes, TranscriptionResult } from '../services/geminiService';
import { bufferToWav } from '../services/audioExport';
import JSZip from 'jszip';
import { Loader2, Upload, Scissors, FileAudio, Play, Pause, AlertTriangle, Check, X, Volume2, Zap, ZoomIn, ZoomOut, SkipBack, SkipForward, Trash2, Flag, List, Keyboard, Layers, MousePointer2, GripVertical, CheckCircle2, FileText, ChevronLeft, Undo2, Redo2, MousePointer, MoveHorizontal, Download, Disc, Music, Sliders, Settings2, Search, PlayCircle, Maximize2, CheckSquare, Sword, EyeOff, Info, HelpCircle } from 'lucide-react';
import { JackPersistedState } from '../App';

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

interface Marker { id: string; position_ms: number; name: string; color: string; }
interface Region { id: string; name: string; start_ms: number; end_ms: number; sceneNumber?: number; color: string; isLocked: boolean; isApplied?: boolean; }
interface HistoryState { markers: Marker[]; regions: Region[]; }

const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16','#a855f7','#6366f1','#10b981','#f59e0b','#dc2626'];

interface Props { 
    project: ProjectState; 
    setProject: React.Dispatch<React.SetStateAction<ProjectState>>; 
    onClose: () => void;
    initialState?: JackPersistedState;
    onPersistState?: React.Dispatch<React.SetStateAction<JackPersistedState>>;
}

const JackTheRipper: React.FC<Props> = ({ project, setProject, onClose, initialState, onPersistState }) => {
    const [audioFile, setAudioFile] = useState<File|null>(initialState?.audioFile || null);
    const [audioUrl, setAudioUrl] = useState<string|null>(initialState?.audioUrl || null);
    const [audioBuffer, setAudioBuffer] = useState<AudioBuffer|null>(initialState?.audioBuffer || null);
    const [audioDuration, setAudioDuration] = useState(initialState?.audioDuration || 0);
    const [markers, setMarkers] = useState<Marker[]>(initialState?.markers || [{id: 'm-start', position_ms: 0, name: 'Marker 1', color: '#22c55e'}]);
    const [regions, setRegions] = useState<Region[]>(initialState?.regions || []);
    const [transcript, setTranscript] = useState<TranscriptionResult|null>(initialState?.transcript || null);
    const [zoom, setZoom] = useState(initialState?.zoom || 1);
    const [autoScroll, setAutoScroll] = useState(initialState?.scrollLeft !== undefined ? true : true);
    const [selectedMarkerIds, setSelectedMarkerIds] = useState<string[]>([]);
    const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
    const [selectedSceneRange, setSelectedSceneRange] = useState<{start: number, end: number} | null>(null);
    const [toolMode, setToolMode] = useState<'selector' | 'scissor' | 'zoom'>('selector');
    const [showMarkers, setShowMarkers] = useState(true);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [ctrlPressed, setCtrlPressed] = useState(false);
    const [scrubDir, setScrubDir] = useState(0); // 0, 1 (L), -1 (J)
    const [showDoneText, setShowDoneText] = useState(false);
    
    const prePlaybackTimeRef = useRef<number | null>(null);
    const analysisAbortRef = useRef<AbortController | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const startTimeRef = useRef<number>(0); 
    const offsetTimeRef = useRef<number>(0); 
    const scrubIntervalRef = useRef<any>(null);
    const rafRef = useRef<number>(0);
    
    const timelineRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const activeSceneRange = useMemo(() => {
        if (!audioFile) return { start: 1, end: project.scenes.length };
        const name = audioFile.name.toUpperCase();
        if (name.includes("_ALL")) return { start: 1, end: project.scenes.length };
        const rangeMatch = name.match(/_(\d+)_(\d+)/);
        if (rangeMatch) return { start: parseInt(rangeMatch[1]), end: parseInt(rangeMatch[2]) };
        const singleMatch = name.match(/_(\d+)\.(WAV|MP3)/);
        if (singleMatch) return { start: 1, end: parseInt(singleMatch[1]) };
        return { start: 1, end: project.scenes.length };
    }, [audioFile, project.scenes.length]);

    const filteredScenes = useMemo(() => {
        return project.scenes.filter(s => !s.isDisabled && s.number >= activeSceneRange.start && s.number <= activeSceneRange.end);
    }, [project.scenes, activeSceneRange]);

    const cursorClass = useMemo(() => {
        if (toolMode === 'zoom') return ctrlPressed ? 'cursor-zoom-out' : 'cursor-zoom-in';
        if (toolMode === 'scissor') return 'cursor-crosshair';
        return 'cursor-default';
    }, [toolMode, ctrlPressed]);

    const [isHoveringSidebar, setIsHoveringSidebar] = useState(false);
    const [history, setHistory] = useState<HistoryState[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackTime, setPlaybackTime] = useState(0);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState<string|null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStartMs, setDragStartMs] = useState<number | null>(null);
    const [dragCurrentMs, setDragCurrentMs] = useState<number | null>(null);
    const [dragTarget, setDragTarget] = useState<{type:string,id:string}|null>(null);

    const pushHistory = useCallback((m: Marker[], r: Region[]) => {
        setHistory(prev => {
            const next = prev.slice(0, historyIndex + 1);
            next.push({ markers: JSON.parse(JSON.stringify(m)), regions: JSON.parse(JSON.stringify(r)) });
            if (next.length > 20) next.shift();
            return next;
        });
        setHistoryIndex(prev => Math.min(prev + 1, 19));
    }, [historyIndex]);

    const handleUndo = useCallback(() => {
        if (historyIndex > 0) {
            const state = history[historyIndex - 1];
            setMarkers(state.markers); setRegions(state.regions);
            setHistoryIndex(historyIndex - 1);
        }
    }, [history, historyIndex]);

    const handleRedo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            const state = history[historyIndex + 1];
            setMarkers(state.markers); setRegions(state.regions);
            setHistoryIndex(historyIndex + 1);
        }
    }, [history, historyIndex]);

    useEffect(() => {
        if (onPersistState) {
            onPersistState({ audioFile, audioUrl, audioBuffer, audioDuration, markers, regions, transcript, zoom, scrollLeft: timelineRef.current?.scrollLeft || 0 });
        }
    }, [audioFile, audioUrl, audioBuffer, audioDuration, markers, regions, transcript, zoom]);

    const stopAudioEngine = useCallback(() => {
        if (sourceNodeRef.current) {
            try { sourceNodeRef.current.stop(); } catch(e) {}
            sourceNodeRef.current = null;
        }
        setIsPlaying(false);
        setScrubDir(0);
        if (scrubIntervalRef.current) {
            clearInterval(scrubIntervalRef.current);
            scrubIntervalRef.current = null;
        }
    }, []);

    const startAudioEngine = useCallback((offsetMs: number) => {
        if (!audioBuffer) return;
        stopAudioEngine();
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') ctx.resume();

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        
        const startSec = Math.max(0, Math.min(offsetMs / 1000, audioDuration));
        source.start(0, startSec);
        
        sourceNodeRef.current = source;
        startTimeRef.current = ctx.currentTime;
        offsetTimeRef.current = offsetMs;
        setIsPlaying(true);

        source.onended = () => {
            // Check if it reached the end or was stopped manually
            if (sourceNodeRef.current === source) {
                const elapsed = (ctx.currentTime - startTimeRef.current) * 1000;
                if (offsetTimeRef.current + elapsed >= audioDuration * 999.5) {
                    setIsPlaying(false);
                    sourceNodeRef.current = null;
                }
            }
        };
    }, [audioBuffer, audioDuration, stopAudioEngine]);

    const updatePlayheadSmooth = useCallback(() => {
        if (isPlaying && audioContextRef.current) {
            const elapsed = (audioContextRef.current.currentTime - startTimeRef.current) * 1000;
            const currentMs = Math.min(audioDuration * 1000, offsetTimeRef.current + elapsed);
            setPlaybackTime(currentMs);

            if (selectedRegionIds.length === 1) {
                const region = regions.find(r => r.id === selectedRegionIds[0]);
                if (region && currentMs >= region.end_ms) {
                    stopAudioEngine();
                    if (prePlaybackTimeRef.current !== null) {
                        seekTo(prePlaybackTimeRef.current);
                        prePlaybackTimeRef.current = null;
                    }
                }
            }
            if (currentMs >= audioDuration * 1000) stopAudioEngine();
            rafRef.current = requestAnimationFrame(updatePlayheadSmooth);
        }
    }, [isPlaying, audioDuration, selectedRegionIds, regions, stopAudioEngine]);

    useEffect(() => {
        if (isPlaying) rafRef.current = requestAnimationFrame(updatePlayheadSmooth);
        else if (rafRef.current) cancelAnimationFrame(rafRef.current);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [isPlaying, updatePlayheadSmooth]);

    const togglePlayback = () => {
        if (isPlaying) stopAudioEngine();
        else startAudioEngine(playbackTime);
    };

    const seekTo = (ms: number, smooth: boolean = false) => { 
        const targetMs = Math.max(0, Math.min(ms, audioDuration * 1000));
        setPlaybackTime(targetMs); 
        if (isPlaying) startAudioEngine(targetMs);
        if (autoScroll && timelineRef.current) {
            const px = (targetMs / 1000) * 100 * zoom;
            timelineRef.current.scrollTo({ left: px - timelineRef.current.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' });
        }
    };

    useEffect(() => {
        if (scrubDir !== 0 && audioBuffer) {
            stopAudioEngine();
            const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = ctx;

            const interval = setInterval(() => {
                const step = scrubDir * 50; 
                setPlaybackTime(prev => {
                    const next = Math.max(0, Math.min(prev + step, audioDuration * 1000));
                    // Throttled blip for performance
                    const blip = ctx.createBufferSource();
                    blip.buffer = audioBuffer;
                    const gain = ctx.createGain();
                    gain.gain.value = 0.05;
                    blip.connect(gain);
                    gain.connect(ctx.destination);
                    blip.start(0, next / 1000, 0.05);
                    return next;
                });
            }, 40);
            scrubIntervalRef.current = interval;
            return () => clearInterval(interval);
        }
    }, [scrubDir, audioBuffer, audioDuration, stopAudioEngine]);

    const handleSearch = (query: string) => {
        if (!query) return;
        const num = parseInt(query.replace("#", ""));
        if (!isNaN(num)) {
            const region = regions.find(r => r.sceneNumber === num);
            if (region) {
                seekTo(region.start_ms, true);
                setSelectedRegionIds([region.id]);
                setSearchQuery("");
                return;
            }
        }
        const match = filteredScenes.find(s => s.script.toLowerCase().includes(query.toLowerCase()));
        if (match) {
            const region = regions.find(r => r.sceneNumber === match.number);
            if (region) { seekTo(region.start_ms, true); setSelectedRegionIds([region.id]); }
            setSearchQuery("");
        }
    };

    const handleSceneListClick = (e: React.MouseEvent, sceneNum: number) => {
        const region = regions.find(r => r.sceneNumber === sceneNum);
        if (region) {
            if (e.ctrlKey) setSelectedRegionIds(prev => prev.includes(region.id) ? prev.filter(x => x !== region.id) : [...prev, region.id]);
            else { setSelectedRegionIds([region.id]); seekTo(region.start_ms, true); }
        } else {
            if (e.shiftKey && selectedSceneRange) {
                const start = Math.min(selectedSceneRange.start, sceneNum);
                const end = Math.max(selectedSceneRange.end, sceneNum);
                setSelectedSceneRange({ start, end });
            } else setSelectedSceneRange({ start: sceneNum, end: sceneNum });
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Control') setCtrlPressed(true);
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            
            if (e.key.toLowerCase() === 'a') { e.preventDefault(); setAutoScroll(p => !p); return; }
            if (e.code === 'Space') { 
                e.preventDefault();
                if (scrubDir !== 0) { stopAudioEngine(); return; }
                if (selectedRegionIds.length === 1 && !isPlaying) {
                    const region = regions.find(r => r.id === selectedRegionIds[0]);
                    if (region) { prePlaybackTimeRef.current = playbackTime; seekTo(region.start_ms); startAudioEngine(region.start_ms); }
                } else togglePlayback(); 
                return; 
            }
            if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? handleRedo() : handleUndo(); return; }
            if (e.key.toLowerCase() === 's') { e.preventDefault(); searchInputRef.current?.focus(); return; }
            if (e.key.toLowerCase() === 'k') { e.preventDefault(); stopAudioEngine(); return; }
            if (e.key.toLowerCase() === 'j') { e.preventDefault(); setScrubDir(-1); return; }
            if (e.key.toLowerCase() === 'l') { e.preventDefault(); setScrubDir(1); return; }

            if (selectedRegionIds.length === 1) {
                const id = selectedRegionIds[0];
                const nudgeAmount = 50; 
                if (e.shiftKey) {
                    if (e.key === 'ArrowLeft') { e.preventDefault(); moveRegionEntirely(id, -nudgeAmount); return; }
                    if (e.key === 'ArrowRight') { e.preventDefault(); moveRegionEntirely(id, nudgeAmount); return; }
                } else if (!e.ctrlKey) {
                    if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeRegion(id, 'start_ms', -nudgeAmount); return; }
                    if (e.key === 'ArrowRight') { e.preventDefault(); nudgeRegion(id, 'start_ms', nudgeAmount); return; }
                    if (e.key === 'ArrowDown') { e.preventDefault(); nudgeRegion(id, 'end_ms', -nudgeAmount); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); nudgeRegion(id, 'end_ms', nudgeAmount); return; }
                }
                if (e.ctrlKey && e.key === 'ArrowRight') { e.preventDefault(); const idx = regions.findIndex(r => r.id === id); if (idx < regions.length - 1) setSelectedRegionIds([regions[idx+1].id]); }
                if (e.ctrlKey && e.key === 'ArrowLeft') { e.preventDefault(); const idx = regions.findIndex(r => r.id === id); if (idx > 0) setSelectedRegionIds([regions[idx-1].id]); }
            }

            if (e.key === '1') setToolMode('selector');
            if (e.key === '2') setToolMode('scissor');
            if (e.key === '3') setToolMode('zoom');
            if (e.key.toLowerCase() === 'm') createMarkerAtPlayhead();
            if (e.key.toLowerCase() === 'delete' || e.key.toLowerCase() === 'backspace') { e.preventDefault(); deleteSelected(); }
        };
        const handleKeyUp = (e: KeyboardEvent) => { if (e.key === 'Control') setCtrlPressed(false); };
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        window.addEventListener('keyup', handleKeyUp, { capture: true });
        return () => { window.removeEventListener('keydown', handleKeyDown, { capture: true }); window.removeEventListener('keyup', handleKeyUp, { capture: true }); };
    }, [playbackTime, markers, regions, historyIndex, isPlaying, scrubDir, selectedRegionIds, startAudioEngine, stopAudioEngine]);

    const handleWheel = (e: React.WheelEvent) => {
        if (isHoveringSidebar) return;
        e.preventDefault();
        const timeline = timelineRef.current;
        if (!timeline) return;
        const rect = timeline.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const pointerLogicalPos = (timeline.scrollLeft + mouseX) / (100 * zoom);
        const zoomStep = 1.15;
        const newZoom = e.deltaY > 0 ? Math.min(500, zoom * zoomStep) : Math.max(0.01, zoom / zoomStep);
        setZoom(newZoom);
        requestAnimationFrame(() => { timeline.scrollLeft = pointerLogicalPos * (100 * newZoom) - mouseX; });
    };

    const drawWaveform = useCallback(() => {
        const canvas = canvasRef.current; const container = timelineRef.current;
        if (!canvas || !container || !audioBuffer) return;
        const width = container.clientWidth; const height = container.clientHeight;
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        const data = audioBuffer.getChannelData(0);
        const totalDurationPx = audioDuration * 100 * zoom; 
        const scrollLeft = container.scrollLeft;
        const startTime = (scrollLeft / totalDurationPx) * audioDuration;
        const endTime = ((scrollLeft + width) / totalDurationPx) * audioDuration;
        const startSample = Math.floor(startTime * audioBuffer.sampleRate);
        const endSample = Math.ceil(endTime * audioBuffer.sampleRate);
        const totalVisibleSamples = endSample - startSample;
        ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#ef4444';
        const step = Math.max(1, Math.ceil(totalVisibleSamples / width));
        const amp = height / 2;
        for (let i = 0; i < width; i++) {
            let min = 1.0, max = -1.0;
            const sampleIdx = startSample + (i * step);
            if (sampleIdx >= data.length) break;
            for (let j = 0; j < step; j++) {
                if (sampleIdx + j >= data.length) break;
                const datum = data[sampleIdx + j];
                if (datum < min) min = datum; if (datum > max) max = datum;
            }
            const y = (1 + min) * amp, h = Math.max(1, (max - min) * amp);
            ctx.fillRect(i, y, 1, h);
        }
    }, [audioBuffer, audioDuration, zoom]);

    useEffect(() => {
        const container = timelineRef.current; if (!container) return;
        const handleScroll = () => requestAnimationFrame(drawWaveform);
        container.addEventListener('scroll', handleScroll);
        const ro = new ResizeObserver(() => requestAnimationFrame(drawWaveform));
        ro.observe(container); drawWaveform();
        return () => { container.removeEventListener('scroll', handleScroll); ro.disconnect(); };
    }, [drawWaveform]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if(!file) return;
        setAudioFile(file); setMarkers([{id: 'm-start', position_ms: 0, name: 'Marker 1', color: '#22c55e'}]); 
        setRegions([]); setTranscript(null); setSelectedMarkerIds([]); setSelectedRegionIds([]); setSelectedSceneRange(null);
        const url = URL.createObjectURL(file); setAudioUrl(url);
        try {
            const ab = await file.arrayBuffer(); const ctx = new AudioContext();
            const buf = await ctx.decodeAudioData(ab); ctx.close().catch(() => {}); setAudioBuffer(buf); setAudioDuration(buf.duration);
        } catch { setError('Failed to load audio'); }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!timelineRef.current) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
        const ms = (x / (100 * zoom)) * 1000;
        const playheadX = (playbackTime / 1000) * 100 * zoom;
        if (Math.abs(x - playheadX) < 15) { setDragTarget({type: 'playhead', id: 'playhead'}); setIsDragging(true); return; }
        setIsDragging(true); setDragStartMs(ms); setDragCurrentMs(ms);
        if (toolMode === 'scissor') {
            const nm = [...markers, {id: `m-${Date.now()}`, position_ms: ms, name: `Marker ${markers.length+1}`, color: COLORS[markers.length%COLORS.length]}].sort((a,b)=>a.position_ms-b.position_ms);
            setMarkers(nm); pushHistory(nm, regions);
        } else if (toolMode === 'zoom' && ctrlPressed) { setZoom(prev => Math.max(0.01, prev / 1.5)); } else if (toolMode !== 'zoom') seekTo(ms);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || !timelineRef.current) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
        const ms = (x / (100 * zoom)) * 1000;
        setDragCurrentMs(ms);
        if (dragTarget?.type === 'playhead') seekTo(ms);
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (!isDragging || !timelineRef.current) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
        const ms = (x / (100 * zoom)) * 1000;
        if (dragTarget?.type === 'playhead') seekTo(ms);
        else if (dragStartMs !== null) {
            const diff = Math.abs(ms - dragStartMs);
            if (diff < 50 && toolMode !== 'scissor' && toolMode !== 'zoom') seekTo(dragStartMs);
            else if (toolMode === 'zoom' && !ctrlPressed && diff > 100) {
                const start = Math.min(dragStartMs, ms), end = Math.max(dragStartMs, ms);
                const newZoom = timelineRef.current.clientWidth / ((end - start) / 1000 * 100);
                setZoom(newZoom);
                setTimeout(() => { if (timelineRef.current) timelineRef.current.scrollLeft = (start / 1000 * 100 * newZoom); }, 50);
            }
        }
        setIsDragging(false); setDragStartMs(null); setDragCurrentMs(null); setDragTarget(null);
    };

    const createMarkerAtPlayhead = () => {
        if(!audioFile) return;
        const nm = [...markers, {id: `m-${Date.now()}`, position_ms: playbackTime, name: `Marker ${markers.length+1}`, color: COLORS[markers.length%COLORS.length]}].sort((a,b)=>a.position_ms-b.position_ms);
        setMarkers(nm); pushHistory(nm, regions);
    };

    const deleteSelected = () => {
        let nm = [...markers], nr = [...regions];
        if (selectedMarkerIds.length > 0) { nm = nm.filter(m => !selectedMarkerIds.includes(m.id)); setSelectedMarkerIds([]); }
        if (selectedRegionIds.length > 0) { nr = nr.filter(r => !selectedRegionIds.includes(r.id)); setSelectedRegionIds([]); nr = nr.map((r, i) => ({...r, name: `Scene ${activeSceneRange.start + i}`, sceneNumber: activeSceneRange.start + i})); }
        if (nm.length === 0) nm = [{id: 'm-start', position_ms: 0, name: 'Marker 1', color: '#22c55e'}];
        setMarkers(nm); setRegions(nr); pushHistory(nm, nr);
    };

    const clearAll = (type: 'markers' | 'regions') => {
        if (!confirm(`Permanently delete all ${type}?`)) return;
        if (type === 'markers') { const nm = [{id: 'm-start', position_ms: 0, name: 'Marker 1', color: '#22c55e'}]; setMarkers(nm); pushHistory(nm, regions); }
        else { setRegions([]); pushHistory(markers, []); }
    };

    const handleDragStartItem = (e: React.MouseEvent, type: string, id: string) => {
        e.stopPropagation(); setDragTarget({type,id});
        if (type === 'marker') { if (e.ctrlKey) setSelectedMarkerIds(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]); else setSelectedMarkerIds([id]); }
        else { if (e.ctrlKey) setSelectedRegionIds(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]); else setSelectedRegionIds([id]); }
    };

    const handleGlobalDrag = useCallback((e: MouseEvent) => {
        if(!dragTarget||!timelineRef.current) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
        const ms = Math.round((x / (100 * zoom)) * 1000);
        if (dragTarget.type === 'playhead') { seekTo(ms); return; }
        if (dragTarget.type === 'marker') { setMarkers(p => p.map(m => selectedMarkerIds.includes(m.id) ? {...m, position_ms: Math.max(0, Math.min(ms, audioDuration*1000))} : m).sort((a,b)=>a.position_ms-b.position_ms)); }
        else {
            setRegions(p => p.map(r => {
                if (!selectedRegionIds.includes(r.id) && r.id !== dragTarget.id) return r;
                if (dragTarget.type === 'region-start') return {...r, start_ms: Math.max(0, Math.min(ms, r.end_ms-1))};
                if (dragTarget.type === 'region-end') return {...r, end_ms: Math.min(audioDuration*1000, Math.max(ms, r.start_ms+1))};
                if (dragTarget.type === 'region-move') { const d = r.end_ms - r.start_ms; const ns = Math.max(0, Math.min(ms - d/2, audioDuration*1000 - d)); return {...r, start_ms: ns, end_ms: ns+d}; }
                return r;
            }));
        }
    }, [dragTarget, audioDuration, zoom, selectedMarkerIds, selectedRegionIds]);

    const handleGlobalMouseUp = useCallback(() => { if(dragTarget) pushHistory(markers, regions); setDragTarget(null); }, [dragTarget, markers, regions]);
    useEffect(() => { if(dragTarget) { window.addEventListener('mousemove', handleGlobalDrag); window.addEventListener('mouseup', handleGlobalMouseUp); return () => { window.removeEventListener('mousemove', handleGlobalDrag); window.removeEventListener('mouseup', handleGlobalMouseUp); }; } }, [dragTarget, handleGlobalDrag, handleGlobalMouseUp]);

    const nudgeRegion = (id: string, field: 'start_ms' | 'end_ms', delta: number) => { const nr = regions.map(r => r.id === id ? {...r, [field]: Math.max(0, Math.min(audioDuration*1000, r[field] + delta))} : r); setRegions(nr); pushHistory(markers, nr); };
    const moveRegionEntirely = (id: string, delta: number) => { const nr = regions.map(r => { if (r.id !== id) return r; const d = r.end_ms - r.start_ms; const nextStart = Math.max(0, Math.min(audioDuration*1000 - d, r.start_ms + delta)); return { ...r, start_ms: nextStart, end_ms: nextStart + d }; }); setRegions(nr); pushHistory(markers, nr); };

    const convertMarkersToRegions = () => {
        if (markers.length < 1) return;
        const sorted = [...markers].sort((a,b) => a.position_ms - b.position_ms);
        const newRegions: Region[] = [];
        for (let i = 0; i < sorted.length; i++) {
            const start = sorted[i].position_ms;
            if (i === sorted.length - 1) break;
            const end = sorted[i+1].position_ms;
            if (end > start) newRegions.push({ id: `r-${Date.now()}-${i}`, name: `Scene ${activeSceneRange.start + i}`, start_ms: start, end_ms: end, sceneNumber: activeSceneRange.start + i, color: sorted[i].color, isLocked: false });
        }
        setRegions(newRegions); pushHistory(markers, newRegions);
    };

    const runAnalysis = async () => {
        if(!audioFile||!audioBuffer) return;
        setIsAnalyzing(true); setError(null);
        analysisAbortRef.current = new AbortController();
        try {
            const b64 = await blobToBase64(audioFile);
            const tr = await transcribeAudioAdvanced(b64, audioFile.type||'audio/mp3');
            setTranscript(tr);
            const matches = await matchTranscriptToScenes(tr, filteredScenes.map(s=>({number:s.number,script:s.script})));
            const nr: Region[] = matches.map((m,i)=>({id:`r-${Date.now()}-${i}`,name:`Scene ${m.sceneNumber}`,start_ms:m.start_ms,end_ms:m.end_ms,sceneNumber:m.sceneNumber,color:COLORS[i%COLORS.length],isLocked:false}));
            const nm: Marker[] = []; nr.forEach((r,i)=>nm.push({id:`ms-${i}`,position_ms:r.start_ms,name:`Marker ${nm.length+1}`,color:r.color}));
            if (nm.length === 0) nm.push({id: 'm-start', position_ms: 0, name: 'Marker 1', color: '#22c55e'});
            setMarkers(nm); setRegions(nr); pushHistory(nm, nr);
        } catch(err:any) { if (err.name !== 'AbortError') setError(err.message||'Analysis failed'); } finally { setIsAnalyzing(false); analysisAbortRef.current = null; }
    };

    const cancelAnalysis = () => { if (analysisAbortRef.current) analysisAbortRef.current.abort(); setIsAnalyzing(false); };

    const fmtTC = (ms:number) => {
        const ts = Math.floor(ms/1000);
        const h = Math.floor(ts/3600);
        const m = Math.floor((ts%3600)/60);
        const s = ts%60;
        const f = Math.floor((ms%1000)/(1000/30));
        return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}:${f.toString().padStart(2,'0')}`;
    };

    const hasApplied = useMemo(() => regions.some(r => r.isApplied), [regions]);

    return (
        <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 select-none shadow-2xl overflow-hidden relative" onWheel={handleWheel}>
            {showDoneText && (
                <div className="absolute inset-0 z-[500] flex items-center justify-center pointer-events-none">
                    <div className="text-[180px] font-black text-green-500 drop-shadow-[0_0_50px_rgba(34,197,94,0.6)] animate-out fade-out zoom-out duration-1000 fill-mode-forwards select-none">DONE!</div>
                </div>
            )}
            {isAnalyzing && (
                <div className="absolute inset-0 z-[400] flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
                    <Loader2 size={100} className="text-highlight animate-spin mb-6" />
                    <h2 className="text-4xl font-black text-white uppercase tracking-widest mb-8 animate-pulse">Analyzing Narration...</h2>
                    <button onClick={cancelAnalysis} className="px-10 py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl shadow-2xl transition-all active:scale-95 flex items-center gap-3">
                        <X size={24}/> CANCEL AUTO-SPLIT
                    </button>
                </div>
            )}
            <div className="bg-gradient-to-r from-red-900 via-red-800 to-orange-900 px-6 py-4 flex items-center justify-between border-b border-red-700/50 shrink-0">
                <div className="flex items-center gap-4"><Sword size={32}/><h1 className="text-2xl font-black uppercase tracking-tighter">Jack the Ripper</h1></div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-xl border border-white/10">
                        <Search size={14} className="text-slate-500"/><input ref={searchInputRef} type="text" placeholder="Jump # (S)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if(e.key === 'Enter') handleSearch(searchQuery); }} className="bg-transparent text-xs font-bold w-24 outline-none placeholder:text-slate-600"/>
                    </div>
                    <div className="flex bg-black/30 p-1 rounded-lg border border-white/10">
                        <button onClick={()=>setToolMode('selector')} className={`p-2 rounded ${toolMode==='selector'?'bg-white/20 text-white':'text-white/40'}`} title="Selector (1)" aria-label="Selector (1)"><MousePointer size={18}/></button>
                        <button onClick={()=>setToolMode('scissor')} className={`p-2 rounded ${toolMode==='scissor'?'bg-white/20 text-white':'text-white/40'}`} title="Scissor (2)" aria-label="Scissor (2)"><Scissors size={18}/></button>
                        <button onClick={()=>setToolMode('zoom')} className={`p-2 rounded ${toolMode==='zoom'?'bg-white/20 text-white':'text-white/40'}`} title="Zoom (3) / Hold Ctrl to zoom out" aria-label="Zoom (3) / Hold Ctrl to zoom out" onDoubleClick={() => setZoom(timelineRef.current!.clientWidth/(audioDuration*100))}>{ctrlPressed ? <ZoomOut size={18}/> : <Search size={18}/>}</button>
                    </div>
                    <div className="w-px h-6 bg-white/20 mx-1"/>
                    <button onClick={handleUndo} disabled={historyIndex <= 0} className="p-2 hover:bg-white/10 rounded disabled:opacity-30"><Undo2 size={20}/></button>
                    <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className="p-2 hover:bg-white/10 rounded disabled:opacity-30"><Redo2 size={20}/></button>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded ml-4"><X size={24}/></button>
                </div>
            </div>
            <div className="flex-1 flex overflow-hidden">
                <div className="w-80 bg-slate-900 border-r border-slate-700 flex flex-col shrink-0" onMouseEnter={()=>setIsHoveringSidebar(true)} onMouseLeave={()=>setIsHoveringSidebar(false)}>
                    <div className="p-4 border-b border-slate-700 space-y-2">
                        <label className="block cursor-pointer text-slate-800"><div className="border-2 border-dashed border-slate-600 rounded-xl p-4 text-center hover:border-red-500 transition-colors bg-slate-800"><Upload size={24} className="mx-auto mb-1 text-slate-400"/><p className="text-[10px] font-bold uppercase text-slate-400">{audioFile ? 'Replace Audio' : 'Load Audio'}</p></div><input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden"/></label>
                        <button onClick={runAnalysis} disabled={isAnalyzing || !audioFile} className="w-full py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-orange-600 to-red-600 text-white flex items-center justify-center gap-2 shadow-md active:scale-95 uppercase tracking-tighter">{isAnalyzing?<Loader2 className="animate-spin" size={16}/>:<Zap size={16}/>} AUTO-SPLIT</button>
                        <button onClick={convertMarkersToRegions} disabled={!audioFile || markers.length === 0} className="w-full py-2 bg-blue-600 text-white rounded text-xs font-bold uppercase flex items-center justify-center gap-2 active:scale-95 shadow-md"><Layers size={14}/> CONVERT TO REGIONS</button>
                        <button onClick={createMarkerAtPlayhead} disabled={!audioFile} className="w-full py-2 bg-green-600 text-white rounded text-xs font-bold uppercase flex items-center justify-center gap-2 hover:bg-green-700 active:scale-95 shadow-md"><Flag size={14}/> SET MARKER (M)</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin bg-slate-900">
                        <section>
                            <div className="flex justify-between items-center mb-2"><h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Regions ({regions.length})</h3><button onClick={()=>clearAll('regions')} className="text-[9px] text-red-400 hover:underline font-bold">CLEAR ALL</button></div>
                            <div className="space-y-2">
                                {regions.map(r => {
                                    const sceneText = project.scenes.find(s => s.number === r.sceneNumber)?.script || "";
                                    const isSelected = selectedRegionIds.includes(r.id);
                                    return (
                                        <div key={r.id} onClick={(e)=>{ if (e.ctrlKey) setSelectedRegionIds(prev => prev.includes(r.id) ? prev.filter(x=>x!==r.id) : [...prev, r.id]); else setSelectedRegionIds([r.id]); }} className={`p-2 rounded border cursor-pointer transition-all ${isSelected?'border-white shadow-xl scale-[1.03] ring-1 ring-white/50':'bg-slate-800 border-slate-700 hover:border-slate-600'}`} style={{ backgroundColor: isSelected ? r.color : `${r.color}33`, opacity: isSelected ? 1 : 0.7 }}>
                                            <div className="relative z-10 flex items-center justify-between mb-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.4)]" style={{backgroundColor:r.color}}/>
                                                    <span className={`text-[10px] font-black text-white`}>{r.name}</span>
                                                    {r.isApplied && <Check size={10} className="text-green-400"/>}
                                                </div>
                                                <button onClick={(e)=>{e.stopPropagation(); seekTo(r.start_ms, true); startAudioEngine(r.start_ms);}} className={`p-1 rounded ${isSelected?'bg-white/20 text-white':'bg-white/5 text-slate-400 hover:text-white'}`}><PlayCircle size={12}/></button>
                                            </div>
                                            <p className={`text-[9px] line-clamp-1 mb-2 italic font-medium text-white`}>"{sceneText}"</p>
                                            <div className={`grid grid-cols-2 gap-2 text-[9px] font-mono relative z-10 text-white`}>
                                                <div className="flex gap-1 items-center"><span>S</span><button onClick={(e)=>{e.stopPropagation(); nudgeRegion(r.id,'start_ms',-100);}} className="bg-white/10 hover:bg-white/20 px-1.5 rounded transition-colors">-</button><button onClick={(e)=>{e.stopPropagation(); nudgeRegion(r.id,'start_ms',100);}} className="bg-white/10 hover:bg-white/20 px-1.5 rounded transition-colors">+</button></div>
                                                <div className="flex gap-1 items-center"><span>E</span><button onClick={(e)=>{e.stopPropagation(); nudgeRegion(r.id,'end_ms',-100);}} className="bg-white/10 hover:bg-white/20 px-1.5 rounded transition-colors">-</button><button onClick={(e)=>{e.stopPropagation(); nudgeRegion(r.id,'end_ms',100);}} className="bg-white/10 hover:bg-white/20 px-1.5 rounded transition-colors">+</button></div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                        <section>
                            <div className="flex justify-between items-center mb-2"><h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Markers ({markers.length})</h3><div className="flex items-center gap-2"><button onClick={()=>setShowMarkers(!showMarkers)} className="text-[9px] text-blue-400 hover:underline font-bold uppercase">{showMarkers ? 'Hide' : 'Show'}</button><button onClick={()=>clearAll('markers')} className="text-[9px] text-red-400 hover:underline font-bold uppercase">CLEAR ALL</button></div></div>
                            <div className="grid grid-cols-3 gap-1">
                                {markers.map(m => (
                                    <button key={m.id} onClick={(e)=>{ if (e.ctrlKey) setSelectedMarkerIds(prev => prev.includes(m.id) ? prev.filter(x=>x!==m.id) : [...prev, m.id]); else { setSelectedMarkerIds([m.id]); seekTo(m.position_ms, true); } }} className={`p-1 text-[9px] bg-slate-800 border rounded truncate hover:border-white transition-colors ${selectedMarkerIds.includes(m.id)?'border-white ring-1 ring-white':'border-slate-700'}`} style={{color:m.color, visibility: showMarkers ? 'visible' : 'hidden'}}>{fmtTC(m.position_ms)}</button>
                                ))}
                            </div>
                        </section>
                    </div>
                    <div className="p-4 border-t border-slate-800 bg-slate-900"><button onClick={()=>setShowShortcuts(true)} className="flex items-center gap-2 text-[10px] font-bold text-slate-500 hover:text-white transition-colors"><HelpCircle size={14}/> KEYBOARD GUIDE</button></div>
                </div>
                <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden relative">
                    <div className="bg-slate-900 border-b border-slate-700 px-6 py-3 flex items-center gap-4 shrink-0">
                        <div className="flex items-center gap-1">
                            <button onClick={()=>setScrubDir(-1)} className={`p-2 transition-colors ${scrubDir===-1?'text-red-500':'text-slate-400 hover:text-white'}`} title="Reverse (J)" aria-label="Reverse (J)"><SkipBack size={20}/></button>
                            <button onClick={togglePlayback} className="p-3 bg-red-600 hover:bg-red-500 rounded-full text-white shadow-lg active:scale-90">{isPlaying ? <Pause size={24}/> : <Play size={24} className="ml-1"/>}</button>
                            <button onClick={()=>setScrubDir(1)} className={`p-2 transition-colors ${scrubDir===1?'text-red-500':'text-slate-400 hover:text-white'}`} title="Forward (L)" aria-label="Forward (L)"><SkipForward size={20}/></button>
                        </div>
                        <div className="bg-black/50 px-4 py-2 rounded-lg font-mono text-2xl text-green-400 shadow-inner min-w-[180px] text-center tracking-tight">{fmtTC(playbackTime)}</div>
                        <div className="flex-1 flex items-center gap-4 justify-center"><button onClick={() => setAutoScroll(!autoScroll)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${autoScroll ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-50'}`}><Disc size={14} className="inline mr-1"/> AUTO SCROLL {autoScroll?'ON':'OFF'} (A)</button></div>
                        <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-2 py-1.5 border border-slate-700">
                            <button onClick={() => setZoom(prev => Math.max(0.01, prev / 1.5))} className="hover:text-white transition-colors"><ZoomOut size={18}/></button><span className="text-xs min-w-[35px] text-center font-bold">{zoom.toFixed(2)}x</span><button onClick={() => setZoom(prev => Math.min(500, prev * 1.5))} className="hover:text-white transition-colors"><ZoomIn size={18}/></button><button onClick={()=>setZoom(timelineRef.current!.clientWidth/(audioDuration*100))} className="ml-2 p-1 hover:bg-slate-700 rounded text-highlight" title="Show Full Wave" aria-label="Show Full Wave"><Maximize2 size={16}/></button>
                        </div>
                    </div>
                    <div className="relative flex-1 overflow-hidden bg-slate-950">
                        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0" style={{ width: '100%', height: '100%' }}/>
                        <div ref={timelineRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} className={`absolute inset-0 overflow-x-auto overflow-y-hidden z-10 ${cursorClass}`}>
                            <div className="h-full relative" style={{width: `${Math.max(100, audioDuration * 100 * zoom)}px`}}>
                                <div className="absolute top-0 left-0 right-0 h-6 bg-slate-900/50 border-b border-slate-700 pointer-events-none z-10">
                                    {Array.from({length:Math.ceil(audioDuration)+1}).map((_,i)=> (
                                        <div key={i} className="absolute h-full" style={{left:`${i * 100 * zoom}px`}}> 
                                            <div className="h-2 w-px bg-slate-600"/> 
                                            <span className="absolute top-2 left-1 text-[8px] font-bold text-slate-500">{i}s</span>
                                            {zoom > 2 && Array.from({length:9}).map((__, j) => (
                                                <div key={j} className="absolute h-1 w-px bg-slate-800" style={{left: `${(j + 1) * 10 * zoom}px`, top: '4px'}} />
                                            ))}
                                        </div> 
                                    ))}
                                </div>
                                {isDragging && toolMode === 'zoom' && !ctrlPressed && dragStartMs !== null && dragCurrentMs !== null && (
                                    <div className="absolute top-6 bottom-8 bg-slate-400/30 border-x border-slate-100 z-0 pointer-events-none" style={{left: `${(Math.min(dragStartMs, dragCurrentMs)/1000)*100*zoom}px`, width: `${Math.abs(dragCurrentMs - dragStartMs)/1000*100*zoom}px` || '1px'}}/>
                                )}
                                {regions.map(r => (
                                    <div key={r.id} className={`absolute top-6 bottom-8 border-2 transition-opacity ${selectedRegionIds.includes(r.id)?'opacity-100 z-20 shadow-[0_0_15px_rgba(255,255,255,0.2)]':'opacity-60'}`} style={{left: `${(r.start_ms/1000)*100*zoom}px`, width: `${((r.end_ms-r.start_ms)/1000)*100*zoom}px`, borderColor: r.color, backgroundColor: `${r.color}4D`}}>
                                        <div className="absolute top-0 left-0 right-0 h-5 text-[9px] font-bold text-white px-1 truncate cursor-move flex items-center justify-between" style={{backgroundColor: r.color}} onMouseDown={e=>handleDragStartItem(e,'region-move',r.id)}><span>{r.name}</span>{r.isApplied && <Check size={8}/>}</div>
                                        <div className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-white/20 z-20 group" onMouseDown={e=>handleDragStartItem(e,'region-start',r.id)}><div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-1/2 w-1 bg-white rounded-full opacity-0 group-hover:opacity-100"/></div>
                                        <div className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-white/20 z-20 group" onMouseDown={e=>handleDragStartItem(e,'region-end',r.id)}><div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-1/2 w-1 bg-white rounded-full opacity-0 group-hover:opacity-100"/></div>
                                    </div>
                                ))}
                                {showMarkers && markers.map(m => (
                                    <div key={m.id} className="absolute top-6 bottom-8 w-0.5 z-30 group cursor-pointer" style={{left: `${(m.position_ms/1000)*100*zoom}px`, backgroundColor: m.color}} onMouseDown={e=>handleDragStartItem(e,'marker',m.id)} onDoubleClick={(e)=>{ e.stopPropagation(); const nm = markers.filter(x => x.id !== m.id); if (nm.length === 0) return; setMarkers(nm); pushHistory(nm, regions); }}><div className="absolute -top-5 left-1/2 -translate-x-1/2 transition-transform group-hover:scale-125" style={{color: m.color}}><Flag size={16} fill={m.color} className={selectedMarkerIds.includes(m.id)?'drop-shadow-[0_0_8px_white] scale-110':''}/></div></div>
                                ))}
                                <div className="absolute top-0 bottom-0 w-0.5 bg-white z-50 pointer-events-none shadow-[0_0_10px_rgba(255,255,255,0.5)]" style={{left:`${(playbackTime/1000)*100*zoom}px`}}> 
                                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full border-2 border-red-500 shadow-lg cursor-grab active:cursor-grabbing pointer-events-auto"/> 
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-slate-900 border-t border-slate-700 px-6 py-4 flex items-center justify-end shrink-0 gap-3">
                        <button onClick={deleteSelected} disabled={selectedMarkerIds.length===0 && selectedRegionIds.length === 0} className="px-3 py-2 bg-slate-800 hover:bg-red-600 rounded text-xs font-bold flex items-center gap-2 disabled:opacity-30 uppercase tracking-tighter"><Trash2 size={14}/> DELETE SELECTED</button>
                        <button onClick={async () => {
                            if (!audioBuffer) return; const zip = new JSZip(); const root = zip.folder(`${project.topic.substring(0, 10).replace(/\s/g, '_')}_Clips`);
                            for (const r of regions) { const start = Math.floor(r.start_ms/1000*audioBuffer.sampleRate), end = Math.ceil(r.end_ms/1000*audioBuffer.sampleRate); if (end <= start) continue; const slice = new AudioContext().createBuffer(audioBuffer.numberOfChannels, end-start, audioBuffer.sampleRate); for(let i=0; i<audioBuffer.numberOfChannels; i++) slice.copyToChannel(audioBuffer.getChannelData(i).slice(start, end), i); root?.file(`Scene_${r.sceneNumber}.wav`, bufferToWav(slice)); }
                            const blob = await zip.generateAsync({type:'blob'}); const a = document.createElement('a'); const zipUrl = URL.createObjectURL(blob); a.href=zipUrl; a.download='Clips.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(zipUrl), 1000);
                        }} className="px-6 py-3 bg-slate-800 text-white font-bold rounded-xl shadow-lg flex items-center gap-2 hover:bg-slate-700 transition-all active:scale-95 uppercase tracking-tighter"><Download size={20}/> BOUNCE TO COMPUTER</button>
                        <button onClick={()=>{ setProject(p=>({...p, scenes: p.scenes.map(s => { const r = regions.find(x => x.sceneNumber === s.number); return r ? {...s, mediaStart: r.start_ms/1000, mediaEnd: r.end_ms/1000, audioUrl: audioUrl || s.audioUrl} : s; })})); setRegions(regions.map(r => ({...r, isApplied: true}))); setShowDoneText(true); setTimeout(() => setShowDoneText(false), 2500); }} className={`px-6 py-3 font-black rounded-xl shadow-2xl flex items-center gap-2 transition-all active:scale-95 uppercase tracking-tighter ${hasApplied ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-yellow-500 text-slate-900 hover:bg-yellow-400'}`}><CheckSquare size={20}/> {hasApplied ? 'UPDATE PROJECT CLIPS' : 'ADD REGIONS TO PROJECT'}</button>
                    </div>
                </div>
                <div className="w-80 bg-slate-900 border-l border-slate-700 flex flex-col shrink-0 overflow-hidden" onMouseEnter={()=>setIsHoveringSidebar(true)} onMouseLeave={()=>setIsHoveringSidebar(false)}>
                    <div className="p-4 bg-slate-950 flex items-center justify-between border-b border-slate-800"><h3 className="text-sm font-bold flex items-center gap-2"><List size={16}/> Story Scenes</h3><button onClick={()=>setSelectedSceneRange(null)} className="text-[10px] text-slate-500 hover:text-white uppercase font-bold">Clear Selection</button></div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin bg-slate-900">
                        {filteredScenes.map(s => {
                            const isRangeSelected = selectedSceneRange && s.number >= selectedSceneRange.start && s.number <= selectedSceneRange.end;
                            const region = regions.find(r => r.sceneNumber === s.number);
                            const isSpecificSelected = region ? selectedRegionIds.includes(region.id) : false;
                            return (
                                <div key={s.id} onClick={(e) => handleSceneListClick(e, s.number)} className={`p-3 rounded-lg border cursor-pointer transition-all relative overflow-hidden group ${isSpecificSelected ? 'border-white shadow-lg scale-[1.02] z-10 ring-1 ring-white/30' : (region ? 'border-slate-700' : 'bg-slate-800 border-slate-700 hover:border-slate-600')}`} style={{ opacity: isSpecificSelected ? 1 : (region || isRangeSelected ? 0.95 : 0.6), backgroundColor: isRangeSelected ? 'rgba(234, 179, 8, 0.4)' : (region ? `${region.color}66` : undefined) }}>
                                    <div className="relative z-10 flex items-center justify-between mb-1"><div className="flex items-center gap-2">{region && <div className="w-2.5 h-2.5 rounded-full shadow-[0_0_5px_rgba(255,255,255,0.4)]" style={{backgroundColor:region.color}}/>}<span className={`text-[11px] font-black text-white`}>#{s.number}</span></div>{region?.isApplied && <CheckSquare size={12} className="text-green-400"/>}</div>
                                    <p className={`relative z-10 text-[10px] line-clamp-2 transition-colors font-bold text-white`}>{s.script}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
            {showShortcuts && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-slate-700 p-8 rounded-2xl max-w-lg w-full shadow-2xl relative">
                        <button onClick={()=>setShowShortcuts(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white"><X size={24}/></button>
                        <h2 className="text-2xl font-black mb-6 flex items-center gap-2 uppercase tracking-tighter"><Keyboard className="text-white"/> Keyboard Shortcuts</h2>
                        <div className="space-y-3 text-sm font-medium">
                            <div className="flex justify-between border-b border-slate-800 pb-1"><span>Play / Pause / Region Loop</span><span className="text-white px-2 py-0.5 bg-slate-800 rounded">SPACE</span></div>
                            <div className="flex justify-between border-b border-slate-800 pb-1"><span>Search / Jump #</span><span className="text-white px-2 py-0.5 bg-slate-800 rounded">S</span></div>
                            <div className="flex justify-between border-b border-slate-800 pb-1"><span>Scrub Reverse / Forward (Toggle)</span><span className="text-white px-2 py-0.5 bg-slate-800 rounded">J / L</span></div>
                            <div className="flex justify-between border-b border-slate-800 pb-1"><span>Stop Audio & Scrub</span><span className="text-white px-2 py-0.5 bg-slate-800 rounded">K / SPACE</span></div>
                            <div className="flex justify-between border-b border-slate-800 pb-1"><span>Autoscroll Toggle</span><span className="text-white px-2 py-0.5 bg-slate-800 rounded">A</span></div>
                            <div className="flex justify-between border-b border-slate-800 pb-1"><span>Move Entire Region</span><span className="text-white px-2 py-0.5 bg-slate-800 rounded">Shift + Arrows</span></div>
                            <div className="flex justify-between border-b border-slate-800 pb-1"><span>Nudge Start/End Points</span><span className="text-white px-2 py-0.5 bg-slate-800 rounded">Arrow keys (No Shift)</span></div>
                            <div className="flex justify-between border-b border-slate-800 pb-1"><span>Tool Selector (1:Select, 2:Cut, 3:Zoom)</span><span className="text-white px-2 py-0.5 bg-slate-800 rounded">1 / 2 / 3</span></div>
                            <div className="flex justify-between border-b border-slate-800 pb-1"><span>Set Marker</span><span className="text-white px-2 py-0.5 bg-slate-800 rounded">M</span></div>
                            <div className="flex justify-between border-b border-slate-800 pb-1"><span>Delete Selected</span><span className="text-white px-2 py-0.5 bg-slate-800 rounded">DEL / BACKSPACE</span></div>
                        </div>
                    </div>
                </div>
            )}
            {error && <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-3 rounded-xl flex items-center gap-3 shadow-2xl z-[600] animate-in slide-in-from-bottom-8"><AlertTriangle size={20}/><span>{error}</span><button onClick={()=>setError(null)} className="p-1 hover:bg-white/10 rounded"><X size={16}/></button></div>}
        </div>
    );
};

export default JackTheRipper;