
import React, { useState, useEffect, useCallback } from 'react';
import { VoiceOption, VoiceProvider, GenAiProConfig, TTS_VOICES } from '../types';
import { fetchLabsVoices, LabVoice, VoiceFilterParams } from '../services/genAiProService';
import { generateSpeech } from '../services/geminiService';
import { Search, Globe, X, Play, Loader2, Filter, Info, Volume2, CheckCircle2, Mic2, Server, Check } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    currentVoiceId: string;
    currentConfig: GenAiProConfig;
    onSelectVoice: (voice: VoiceOption, config: GenAiProConfig) => void;
}

const DEFAULT_CONFIG: GenAiProConfig = {
    model_id: 'eleven_multilingual_v2',
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.0,
    use_speaker_boost: true
};

const VoiceSelectorModal: React.FC<Props> = ({ isOpen, onClose, currentVoiceId, currentConfig, onSelectVoice }) => {
    const [activeTab, setActiveTab] = useState<VoiceProvider>('Google');
    const [voices, setVoices] = useState<LabVoice[]>([]);
    const [loading, setLoading] = useState(false);
    const [playingSample, setPlayingSample] = useState<string | null>(null);
    const [totalVoices, setTotalVoices] = useState(0);
    
    // Filters
    const [filters, setFilters] = useState<VoiceFilterParams>({
        search: '',
        gender: '',
        age: '',
        language: '',
        category: '', 
        page: 0
    });
    
    // Advanced Config
    const [config, setConfig] = useState<GenAiProConfig>(currentConfig || DEFAULT_CONFIG);
    const [showAdvanced, setShowAdvanced] = useState(true); // Default show as per screenshot

    const loadLabsVoices = useCallback(async () => {
        if (activeTab !== 'ElevenLabs' && activeTab !== 'GenAiPro' && activeTab !== 'LMNT') return;
        
        setLoading(true);
        try {
            // Map tab to source
            let source: 'all' | 'elevenlabs' | 'genaipro' | 'lmnt' = 'all';
            if (activeTab === 'ElevenLabs') source = 'elevenlabs';
            else if (activeTab === 'GenAiPro') source = 'genaipro';
            else if (activeTab === 'LMNT') source = 'lmnt';
            
            const fetched = await fetchLabsVoices(filters, source);
            
            // Client-side search if API doesn't support partial match well or for speed
            let finalVoices = fetched;
            if (filters.search) {
                const lower = filters.search.toLowerCase();
                finalVoices = finalVoices.filter(v => v.name.toLowerCase().includes(lower));
            }

            setVoices(finalVoices);
            setTotalVoices(finalVoices.length); 
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [filters, activeTab]);

    useEffect(() => {
        if (isOpen) {
            loadLabsVoices();
        }
    }, [isOpen, activeTab]); 

    // Debounced search
    useEffect(() => {
        if (!isOpen) return;
        const timer = setTimeout(() => {
             loadLabsVoices();
        }, 500);
        return () => clearTimeout(timer);
    }, [filters.search]);

    // Handle Preview
    const handlePreview = async (voiceId: string, provider: VoiceProvider, previewUrl?: string) => {
        if (playingSample === voiceId) {
            setPlayingSample(null);
            return;
        }
        setPlayingSample(voiceId);
        
        try {
            let url = previewUrl;
            
            // Generate on fly if no preview URL
            if (!url) {
                const text = "Hello, this is a preview of my voice.";
                // Pass config only if needed
                const genConfig = (provider === 'ElevenLabs' || provider === 'GenAiPro') ? config : undefined;
                url = await generateSpeech(text, voiceId, undefined, undefined, genConfig);
            }
            
            if (url) {
                const audio = new Audio(url);
                audio.onended = () => setPlayingSample(null);
                audio.onerror = () => { setPlayingSample(null); alert("Preview failed."); };
                await audio.play();
            } else {
                setPlayingSample(null);
            }
        } catch (e) {
            console.error("Preview failed", e);
            setPlayingSample(null);
        }
    };

    const handleSelect = (id: string, label: string, provider: VoiceProvider, gender: string, desc: string, tags?: any) => {
        const v: VoiceOption = { id, label, provider, gender: gender as any, desc, tags };
        onSelectVoice(v, config);
        // Do NOT close automatically, wait for Done button
    };

    if (!isOpen) return null;

    const renderVoiceCard = (id: string, name: string, gender: string, desc: string, provider: VoiceProvider, previewUrl?: string) => {
        const isSelected = currentVoiceId === id;
        
        // Filter logic for static lists (Google/LMNT)
        if (filters.search && (provider === 'Google' || provider === 'LMNT')) {
            const lower = filters.search.toLowerCase();
            if (!name.toLowerCase().includes(lower) && !desc.toLowerCase().includes(lower)) return null;
        }

        return (
            <div 
                key={id} 
                onClick={() => handleSelect(id, name, provider, gender, desc)}
                className={`relative group p-4 rounded-xl border-2 cursor-pointer transition-all hover:shadow-md ${isSelected ? 'border-highlight bg-orange-50 dark:bg-orange-900/10' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'}`}
            >
                <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm truncate pr-8">{name}</h3>
                    {isSelected && <CheckCircle2 size={16} className="text-highlight" />}
                </div>
                
                <div className="flex flex-wrap gap-1 mb-2">
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 text-[10px] font-bold uppercase">{gender}</span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 text-[10px] font-bold uppercase">{provider}</span>
                </div>
                
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{desc}</p>
                
                <div className="absolute bottom-3 right-3">
                    <button 
                        onClick={(e) => { e.stopPropagation(); handlePreview(id, provider, previewUrl); }}
                        className={`p-2 rounded-full transition-colors shadow-sm ${playingSample === id ? 'bg-highlight text-white animate-pulse' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:text-highlight'}`}
                    >
                        {playingSample === id ? <Volume2 size={14}/> : <Play size={14} />}
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 text-slate-900 dark:text-slate-100 font-sans">
            <div className="bg-white dark:bg-slate-900 w-full max-w-6xl h-[85vh] rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Globe className="text-highlight" /> Project Narrator
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Select AI Voice Model</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-lg text-xs font-bold transition-colors text-slate-800 dark:text-white">
                            Done
                        </button>
                    </div>
                </div>

                {/* Main Content Grid */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Sidebar Filters */}
                    <div className="w-64 bg-slate-50 dark:bg-slate-950 p-4 border-r border-slate-200 dark:border-slate-700 overflow-y-auto space-y-6">
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-slate-400 uppercase">Provider</label>
                            <div className="flex flex-col gap-2">
                                <button onClick={() => setActiveTab('Google')} className={`flex items-center gap-2 px-3 py-3 text-xs font-bold rounded-lg transition-all text-left ${activeTab === 'Google' ? 'bg-white dark:bg-slate-800 shadow text-highlight ring-1 ring-slate-200 dark:ring-slate-700' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900'}`}>
                                    <Mic2 size={14}/> Google TTS
                                </button>
                                <button onClick={() => setActiveTab('LMNT')} className={`flex items-center gap-2 px-3 py-3 text-xs font-bold rounded-lg transition-all text-left ${activeTab === 'LMNT' ? 'bg-white dark:bg-slate-800 shadow text-purple-500 ring-1 ring-slate-200 dark:ring-slate-700' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900'}`}>
                                    <Server size={14}/> LMNT
                                </button>
                                <button onClick={() => setActiveTab('ElevenLabs')} className={`flex items-center gap-2 px-3 py-3 text-xs font-bold rounded-lg transition-all text-left ${activeTab === 'ElevenLabs' ? 'bg-white dark:bg-slate-800 shadow text-blue-500 ring-1 ring-slate-200 dark:ring-slate-700' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900'}`}>
                                    <Globe size={14}/> ElevenLabs (Direct)
                                </button>
                                <button onClick={() => setActiveTab('GenAiPro')} className={`flex items-center gap-2 px-3 py-3 text-xs font-bold rounded-lg transition-all text-left ${activeTab === 'GenAiPro' ? 'bg-white dark:bg-slate-800 shadow text-emerald-500 ring-1 ring-slate-200 dark:ring-slate-700' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900'}`}>
                                    <Globe size={14}/> GenAiPro (Proxy)
                                </button>
                            </div>
                        </div>

                        {/* Search Filter Input */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-slate-400 uppercase">Voice Filters</label>
                            <input 
                                type="text" 
                                placeholder="Search voices..." 
                                value={filters.search}
                                onChange={(e) => setFilters({...filters, search: e.target.value})}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-highlight focus:outline-none dark:text-white"
                            />
                        </div>
                        
                        {(activeTab === 'ElevenLabs' || activeTab === 'GenAiPro') && (
                            <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                 <div className="flex justify-between items-center mb-2">
                                     <label className="text-xs font-bold text-slate-400 uppercase">Config</label>
                                     <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-[10px] text-highlight hover:underline">{showAdvanced ? 'Hide' : 'Show'}</button>
                                 </div>
                                 
                                 {showAdvanced && (
                                     <div className="space-y-4 bg-slate-100 dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                                         <div>
                                             <label className="text-[10px] font-bold text-slate-500 block mb-1">Model Version</label>
                                             <select value={config.model_id} onChange={(e) => setConfig({...config, model_id: e.target.value as any})} className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-xs dark:text-white">
                                                 <option value="eleven_multilingual_v2">Multilingual V2 (Best)</option>
                                                 <option value="eleven_v3">Eleven V3 (Experimental)</option>
                                                 <option value="eleven_turbo_v2_5">Turbo V2.5 (Fast)</option>
                                                 <option value="eleven_flash_v2_5">Flash V2.5 (Fastest)</option>
                                             </select>
                                         </div>
                                         
                                         <div>
                                             <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                                                 <span>Stability</span>
                                                 <span>{config.stability}</span>
                                             </div>
                                             <input type="range" min="0" max="1" step="0.05" value={config.stability} onChange={(e) => setConfig({...config, stability: parseFloat(e.target.value)})} className="w-full h-1 bg-slate-300 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-highlight" />
                                         </div>

                                         <div>
                                             <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                                                 <span>Similarity</span>
                                                 <span>{config.similarity_boost}</span>
                                             </div>
                                             <input type="range" min="0" max="1" step="0.05" value={config.similarity_boost} onChange={(e) => setConfig({...config, similarity_boost: parseFloat(e.target.value)})} className="w-full h-1 bg-slate-300 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-highlight" />
                                         </div>
                                         
                                         <label className="flex items-center gap-2 cursor-pointer">
                                             <input type="checkbox" checked={config.use_speaker_boost} onChange={(e) => setConfig({...config, use_speaker_boost: e.target.checked})} className="accent-highlight rounded" />
                                             <span className="text-[10px] text-slate-500 font-bold">Speaker Boost</span>
                                         </label>
                                     </div>
                                 )}
                            </div>
                        )}
                    </div>

                    {/* Voice Grid */}
                    <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-900">
                        {activeTab === 'Google' && (
                            <div>
                                <h3 className="text-sm font-bold text-slate-400 mb-4 flex items-center gap-2"><Mic2 size={16}/> Google Voices</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {TTS_VOICES.filter(v => v.provider === 'Google').map(v => renderVoiceCard(v.id, v.label, v.gender, v.desc, v.provider))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'LMNT' && (
                            <div>
                                <h3 className="text-sm font-bold text-slate-400 mb-4 flex items-center gap-2"><Server size={16}/> LMNT Voices</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {TTS_VOICES.filter(v => v.provider === 'LMNT').map(v => renderVoiceCard(v.id, v.label, v.gender, v.desc, v.provider))}
                                </div>
                            </div>
                        )}

                        {(activeTab === 'ElevenLabs' || activeTab === 'GenAiPro') && (
                            <>
                                <div className="flex justify-between items-center mb-4">
                                    <span className="text-sm font-bold text-slate-400">{totalVoices} Voices Found</span>
                                </div>

                                {loading ? (
                                    <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                                        <Loader2 size={32} className="animate-spin mb-2" />
                                        <span>Loading voices...</span>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {voices.map(voice => 
                                            renderVoiceCard(
                                                voice.voice_id, 
                                                voice.name, 
                                                voice.labels.gender || 'Unknown', 
                                                voice.labels.description || voice.category, 
                                                activeTab, 
                                                voice.preview_url
                                            )
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VoiceSelectorModal;
