
import React, { useState, useEffect, useRef } from 'react';
import { ProjectState, TitleGenerationResult, DescriptionGenerationResult, BackgroundOption, HandOption, LANGUAGES, NARRATION_STYLES, TargetDuration, TotalLength, ArtStyle, BrushStyle } from '../types';
import { generateScript, parseScriptToScenes, analyzeImageStyle, generateViralHooks, generateOptimizedTitles, generateOptimizedDescription, translateText } from '../services/geminiService';
import { Loader2, Wand2, ArrowRight, Eye, Upload, Sparkles, Type, ChevronDown, Copy, AlignLeft, Check, BarChart3, X, Trash2, Hand, ImageIcon, Crosshair, Move, Globe, Power, Plus, RefreshCw, Languages, FileText, Monitor, Smartphone, Volume2, Palette, Clock, Timer } from 'lucide-react';
import VoiceSelectorModal from './VoiceSelectorModal';

interface Props {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
}

const COLOR_PAIRS = [
    { name: "None (Black & White)", value: "None", description: "Standard Sketch Style", colors: ['#000000', '#ffffff'] },
    { name: "Ember Red + Arctic Cyan", value: "Red & Cyan", description: "High emotional concept.", colors: ['#EA580C', '#06B6D4'] },
    { name: "Volt Lime + Midnight", value: "Lime & Purple", description: "Electric highlight on deep tones.", colors: ['#84CC16', '#0F172A'] },
    { name: "Solar Gold + Deep Navy", value: "Gold & Navy", description: "Luxury + authority.", colors: ['#FACC15', '#1E3A8A'] },
    { name: "Plasma Pink + Cyber Mint", value: "Pink & Mint", description: "Future-state, high energy.", colors: ['#EC4899', '#14B8A6'] },
    { name: "Inferno Orange + Abyss Blue", value: "Orange & Teal", description: "Sci-fi dramatic notice element.", colors: ['#F97316', '#172554'] },
];

const ScriptEditor: React.FC<Props> = ({ project, setProject }) => {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [translatingScript, setTranslatingScript] = useState(false);
  const [translateLanguage, setTranslateLanguage] = useState("");
  const [calibratingHand, setCalibratingHand] = useState<HandOption | null>(null);
  const [calibrationScale, setCalibrationScale] = useState(1.0);
  const [generatingTitles, setGeneratingTitles] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [selectedTitle, setSelectedTitle] = useState("");
  const [extensionScript, setExtensionScript] = useState("");
  const [localTopic, setLocalTopic] = useState(project.topic);
  const [topicDirty, setTopicDirty] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  
  // Custom Dropdown State
  const [isColorDropdownOpen, setIsColorDropdownOpen] = useState(false);
  const colorDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      setLocalTopic(project.topic);
      setTopicDirty(false);
  }, [project.topic]);

  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (colorDropdownRef.current && !colorDropdownRef.current.contains(event.target as Node)) {
              setIsColorDropdownOpen(false);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTopicChange = (val: string) => {
      setLocalTopic(val);
      setTopicDirty(true);
  };

  const applyTopic = () => {
      setProject(prev => ({ ...prev, topic: localTopic }));
      setTopicDirty(false);
  };

  const handleGenerate = async () => {
    if (!project.topic) return;
    if (!project.totalDurationMinutes) {
        alert("Please select a 'Total Length' before generating the script!");
        return;
    }
    setLoading(true);
    try {
      const generatedScript = await generateScript(project.topic, project.niche, project.targetDuration || 12, project.totalDurationMinutes, project.scriptLanguage);
      setProject(prev => ({ ...prev, script: generatedScript }));
    } catch (e) {
      alert("Failed to generate script. Please check API key.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateHooks = async () => {
      setSpinning(true);
      try {
          const hooks = await generateViralHooks(project.niche, project.scriptLanguage);
          setProject(prev => ({ ...prev, suggestedHooks: hooks }));
      } catch (e) {
          console.error("Spin failed", e);
      } finally {
          setSpinning(false);
      }
  };

  const handleTranslateCurrentScript = async () => {
      if (!project.script) return;
      if (!translateLanguage) return alert("Select a language.");
      setTranslatingScript(true);
      try {
          const translated = await translateText(project.script, translateLanguage);
          setProject(prev => ({ ...prev, script: translated }));
      } catch (e) { alert("Translation failed."); } 
      finally { setTranslatingScript(false); }
  };

  const handleExtendScript = () => {
      if (!extensionScript) return;
      setProject(prev => ({
          ...prev,
          script: prev.script + "\n\n" + extensionScript
      }));
      setExtensionScript("");
  };

  const handleGenerateTitles = async (isRespin = false) => {
      if (!project.topic) return;
      setGeneratingTitles(true);
      try {
          const result = await generateOptimizedTitles(project.topic, project.topic, project.script || "", project.niche, isRespin, project.scriptLanguage);
          if (result) {
            setProject(prev => ({ ...prev, titleData: result }));
            setSelectedTitle(result.primary_title);
          }
      } catch (e) { alert("Failed to generate titles"); } 
      finally { setGeneratingTitles(false); }
  };

  const handleGenerateDescription = async (isRespin = false) => {
      if (!project.topic) return;
      setGeneratingDescription(true);
      try {
          const result = await generateOptimizedDescription(selectedTitle || project.topic, project.topic, project.topic, project.script || "", isRespin, project.scriptLanguage);
          if (result) setProject(prev => ({ ...prev, descriptionData: result }));
      } catch(e) { alert("Failed to generate description"); } 
      finally { setGeneratingDescription(false); }
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);

  const handleBackgroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          const files = Array.from(e.target.files);
          files.forEach((file: File) => {
              if (!file.type.startsWith('image/')) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                  const result = ev.target?.result as string;
                  const newBg: BackgroundOption = {
                      id: `bg-${Date.now()}-${Math.random()}`,
                      name: file.name.replace(/\.[^/.]+$/, "").substring(0, 15),
                      src: result
                  };
                  setProject(prev => ({
                      ...prev,
                      customBackgrounds: [...(prev.customBackgrounds || []), newBg],
                      selectedBackgroundId: !prev.selectedBackgroundId ? newBg.id : prev.selectedBackgroundId
                  }));
              };
              reader.readAsDataURL(file);
          });
      }
      e.target.value = '';
  };

  const handleDeleteBackground = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if(confirm("Delete this background?")) {
          setProject(prev => ({
              ...prev,
              customBackgrounds: prev.customBackgrounds.filter(b => b.id !== id),
              selectedBackgroundId: prev.selectedBackgroundId === id ? null : prev.selectedBackgroundId
          }));
      }
  };

  const toggleBackgroundDisable = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setProject(prev => ({
          ...prev,
          customBackgrounds: prev.customBackgrounds.map(b => b.id === id ? { ...b, isDisabled: !b.isDisabled } : b)
      }));
  };

  const handleHandUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        files.forEach((file: File) => {
            if (!file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const result = ev.target?.result as string;
                const newHand: HandOption = {
                    id: `custom-${Date.now()}-${Math.random()}`,
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
                if (file === files[files.length-1]) {
                    setCalibrationScale(0.3);
                    setCalibratingHand(newHand);
                }
            };
            reader.readAsDataURL(file);
        });
    }
    e.target.value = '';
  };

  const handleDeleteHand = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if(confirm("Delete this hand?")) {
          setProject(prev => ({
              ...prev,
              customHands: prev.customHands.filter(h => h.id !== id),
              selectedHandId: prev.selectedHandId === id ? 'no-hand' : prev.selectedHandId
          }));
      }
  };

  const toggleHandDisable = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setProject(prev => ({
          ...prev,
          customHands: prev.customHands.map(h => h.id === id ? { ...h, isDisabled: !h.isDisabled } : h)
      }));
  };

  const saveCalibration = (handId: string, x: number, y: number) => {
      const updatedHands = project.customHands.map(h => 
          h.id === handId ? { ...h, tipOffset: { x, y }, scale: calibrationScale } : h
      );
      setProject(prev => ({ ...prev, customHands: updatedHands }));
      setCalibratingHand(prev => prev ? ({...prev, tipOffset: { x, y }, scale: calibrationScale}) : null);
  };

  const handleGlobalSfxUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
          const result = ev.target?.result as string;
          setProject(prev => ({ ...prev, globalSfxUrl: result }));
      };
      reader.readAsDataURL(file);
      e.target.value = ''; // Reset input
  };

  const handleSmartUpdate = async () => {
      if (!project.script) return;
      setLoading(true);
      try {
          const scenes = await parseScriptToScenes(project.script);
          setProject(prev => ({ ...prev, scenes, currentStep: 'storyboard' }));
      } catch(e) { alert("Failed to parse."); }
      finally { setLoading(false); }
  };

  const handleStyleAnalyze = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setAnalyzing(true);
      const reader = new FileReader();
      reader.onload = async (ev) => {
          try {
              const prompt = await analyzeImageStyle(ev.target?.result as string);
              setProject(prev => ({ ...prev, analyzedStylePrompt: prompt, artStyle: 'Custom' }));
          } catch(e) { alert("Analysis failed"); }
          finally { setAnalyzing(false); }
      };
      reader.readAsDataURL(file);
  };

  const handleDeleteDisabledAssets = () => {
      const disabledHands = project.customHands.filter(h => h.isDisabled).length;
      const disabledBgs = project.customBackgrounds.filter(b => b.isDisabled).length;
      const disabledScenes = project.scenes.filter(s => s.isDisabled).length;
      
      const total = disabledHands + disabledBgs + disabledScenes;
      
      if(window.confirm(`Permanently delete ALL disabled items?\n\n- ${disabledScenes} Scenes\n- ${disabledHands} Hands\n- ${disabledBgs} Backgrounds`)) {
          setProject(prev => ({
              ...prev,
              customHands: prev.customHands.filter(h => !h.isDisabled),
              customBackgrounds: prev.customBackgrounds.filter(b => !b.isDisabled),
              scenes: prev.scenes.filter(s => !s.isDisabled),
              selectedHandId: prev.customHands.find(h => h.id === prev.selectedHandId && h.isDisabled) ? 'no-hand' : prev.selectedHandId,
              selectedBackgroundId: prev.customBackgrounds.find(b => b.id === prev.selectedBackgroundId && b.isDisabled) ? null : prev.selectedBackgroundId
          }));
      }
  };

  const isTopicSet = !!project.topic && project.topic.trim().length > 0;
  const disabledItemCount = project.customHands.filter(h => h.isDisabled).length + 
                            project.customBackgrounds.filter(b => b.isDisabled).length + 
                            project.scenes.filter(s => s.isDisabled).length;
  
  const activeColorPair = COLOR_PAIRS.find(c => c.value === (project.colorSplash || 'None')) || COLOR_PAIRS[0];

  return (
    <div className="max-w-[1400px] mx-auto p-6 space-y-8 pb-32">
      
      {/* HEADER AREA */}
      <div className="mb-8">
          <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white font-doodle mb-2">Step 1: The Setup</h1>
          <p className="text-slate-500 dark:text-slate-400 font-bold">Define your survival scenario, pick your artist, and let Gemini write the script.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* LEFT COLUMN (MAIN INPUTS) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* TOPIC & HOOK */}
          <div className="bg-white dark:bg-slate-900 p-6 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)]">
             <label className="block text-sm font-bold text-slate-900 dark:text-white mb-2 flex justify-between items-center">
                Video Topic / Hook
                <div className="flex gap-2">
                    <select 
                        value={project.scriptLanguage} 
                        onChange={(e) => setProject(p => ({...p, scriptLanguage: e.target.value}))}
                        className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-xs font-bold"
                    >
                        {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <button onClick={handleGenerateHooks} className="text-xs bg-highlight text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 hover:scale-105 transition-transform">
                        {spinning ? <Loader2 size={12} className="animate-spin"/> : <Sparkles size={12} />} Generate Viral Hooks
                    </button>
                </div>
             </label>
             <div className="flex gap-2 relative">
                <input type="text" value={localTopic} onChange={(e) => handleTopicChange(e.target.value)} placeholder="e.g., How to Survive a Winter Blackout..." className="w-full p-4 text-lg font-bold bg-paper dark:bg-slate-950 border-2 border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:border-black dark:text-white"/>
                <button onClick={applyTopic} disabled={!topicDirty} className={`px-4 rounded-lg font-bold text-sm ${topicDirty ? 'bg-highlight text-white' : 'bg-slate-200 text-slate-400'}`}>{topicDirty ? 'SET' : 'SAVED'}</button>
             </div>
             {project.suggestedHooks && (
                 <div className="mt-4 grid gap-2">
                     {project.suggestedHooks.map((hook, idx) => (
                         <button key={idx} onClick={() => handleTopicChange(hook)} className="text-left p-3 text-sm font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-highlight hover:text-white transition-all">{hook}</button>
                     ))}
                 </div>
             )}
          </div>

          {/* STYLE ANALYZER */}
          <div className="bg-white dark:bg-slate-900 p-6 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)] relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-secondary text-white text-[10px] font-bold px-2 py-1">NEW</div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wider flex items-center gap-2">
                  <Eye size={16} className="text-highlight"/> Style & Mood Analyzer
              </label>
              <div className="flex gap-4">
                  <label className="w-32 h-32 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg cursor-pointer hover:border-highlight hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                      {analyzing ? <Loader2 className="animate-spin text-slate-400"/> : <Upload className="text-slate-400"/>}
                      <span className="text-[10px] font-bold text-slate-400 mt-2">Drag Image Here</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleStyleAnalyze}/>
                  </label>
                  <div className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-600 dark:text-slate-400 overflow-y-auto max-h-32">
                      {project.analyzedStylePrompt || "Analyzed style prompt will appear here. Or type your own detailed style description."}
                  </div>
              </div>
          </div>

          {/* HAND LIBRARY */}
          <div className="bg-white dark:bg-slate-900 p-6 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)]">
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-2"><Hand size={16} /> Artist Hand Library</span>
              </label>
              
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 mb-3">
                  <div 
                      onClick={() => setProject(prev => ({...prev, selectedHandId: 'no-hand'}))} 
                      className={`group relative aspect-square rounded-xl border-2 overflow-hidden cursor-pointer transition-all flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-800 ${project.selectedHandId === 'no-hand' ? 'border-highlight ring-1 ring-highlight' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
                  >
                      <X size={24} className="text-slate-400 mb-1"/>
                      <span className="text-[10px] font-bold text-slate-500 uppercase">NO HAND</span>
                  </div>
                  {project.customHands.map(hand => (
                      <div key={hand.id} onClick={() => !hand.isDisabled && setProject(prev => ({...prev, selectedHandId: hand.id}))} className={`group relative aspect-square rounded-xl border-2 overflow-hidden cursor-pointer transition-all ${hand.id === project.selectedHandId ? 'border-highlight ring-1 ring-highlight' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-highlight'} ${hand.isDisabled ? 'opacity-50 grayscale' : ''}`}>
                          <img src={hand.src} className="w-full h-full object-contain p-1" />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                              {!hand.isDisabled && <button onClick={(e) => { e.stopPropagation(); setCalibrationScale(hand.scale || 1.0); setCalibratingHand(hand); }} className="p-1 bg-white text-highlight rounded hover:bg-highlight hover:text-white" title="Calibrate"><Crosshair size={14}/></button>}
                              <div className="flex gap-1">
                                  <button onClick={(e) => toggleHandDisable(hand.id, e)} className={`p-1 rounded text-white ${hand.isDisabled ? 'bg-amber-500 hover:bg-amber-600' : 'bg-slate-500 hover:bg-slate-600'}`} title={hand.isDisabled ? "Enable" : "Disable"}><Power size={14}/></button>
                                  <button onClick={(e) => handleDeleteHand(hand.id, e)} className="p-1 bg-red-500 text-white rounded hover:bg-red-600" title="Delete"><Trash2 size={14}/></button>
                              </div>
                          </div>
                      </div>
                  ))}
                  
                  <label className="flex flex-col items-center justify-center aspect-square rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-highlight hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors text-slate-400 hover:text-highlight">
                      <Plus size={24} />
                      <span className="text-[9px] font-bold uppercase mt-1">ADD HAND</span>
                      <input type="file" accept="image/png" multiple className="hidden" onChange={handleHandUpload} />
                  </label>
              </div>
              <p className="text-[10px] text-slate-400">Upload clear PNGs of hands with pens. Click "Calibrate" (Crosshair) to set the pen tip position.</p>
          </div>

          {/* MAIN SCRIPT EDITOR */}
          <div className="bg-white border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)] overflow-hidden flex flex-col">
            <div className="bg-slate-900 p-3 border-b-2 border-black dark:border-slate-700 flex justify-between items-center">
                <label className="text-white font-bold flex items-center gap-2"><Type size={16}/> Script Editor</label>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-slate-800 rounded px-2 py-1 border border-slate-700">
                        <select 
                            value={translateLanguage} 
                            onChange={(e) => setTranslateLanguage(e.target.value)}
                            className="bg-slate-800 text-white text-[10px] font-bold outline-none cursor-pointer w-24"
                        >
                            <option value="" className="bg-slate-800 text-white">Translate Script To...</option>
                            {LANGUAGES.map(l => <option key={l} value={l} className="bg-slate-800 text-white">{l}</option>)}
                        </select>
                        <button onClick={handleTranslateCurrentScript} disabled={translatingScript || !translateLanguage} className="text-highlight hover:text-orange-400">
                            {translatingScript ? <Loader2 size={12} className="animate-spin"/> : <Globe size={12}/>}
                        </button>
                    </div>
                    <button 
                        onClick={() => setShowVoiceModal(true)} 
                        className="bg-highlight hover:bg-orange-600 text-white text-[10px] font-bold px-3 py-1 rounded flex items-center gap-1 transition-colors border border-orange-700"
                    >
                        <Volume2 size={12}/> {project.voiceLabel || project.voice}
                    </button>
                </div>
            </div>
            <textarea
              value={project.script}
              onChange={(e) => setProject(prev => ({ ...prev, script: e.target.value }))}
              className="w-full h-[400px] p-6 bg-slate-800 text-paper font-mono text-base leading-relaxed resize-none focus:outline-none"
              placeholder="Your AI generated script will appear here... You can also paste your own!"
            />
          </div>

          {/* EXTEND STORYBOARD */}
          <div className="bg-white dark:bg-slate-900 p-6 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)]">
              <div className="flex justify-between items-center mb-3">
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <Plus size={16}/> Extend Storyboard
                  </label>
                  <span className="text-[10px] bg-slate-800 text-white px-2 py-1 rounded font-bold uppercase">Append Mode</span>
              </div>
              <textarea 
                  value={extensionScript} 
                  onChange={(e) => setExtensionScript(e.target.value)} 
                  className="w-full h-24 p-3 bg-slate-50 dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:outline-none focus:border-black dark:focus:border-highlight resize-none mb-3 dark:text-white"
                  placeholder="Paste additional script text here to append new scenes..."
              />
              {extensionScript && (
                  <button onClick={handleExtendScript} className="w-full py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-lg hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors">
                      Add to Script
                  </button>
              )}
          </div>

          {/* TITLE INTELLIGENCE */}
          <div className="bg-white dark:bg-slate-900 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)] overflow-hidden">
              <div className="bg-slate-400/20 p-3 flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
                  <h3 className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2"><Type size={16}/> Title Intelligence (8 Formulas)</h3>
                  <button onClick={() => handleGenerateTitles(true)} disabled={generatingTitles || !project.topic} className="text-xs bg-white dark:bg-slate-800 px-3 py-1 rounded-full font-bold border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1">
                      {generatingTitles ? <Loader2 size={12} className="animate-spin"/> : <RefreshCw size={12}/>} Re-Spin Titles
                  </button>
              </div>
              <div className="p-6 bg-slate-50 dark:bg-slate-900/50 min-h-[150px] flex items-center justify-center">
                  {!project.titleData ? (
                      <button onClick={() => handleGenerateTitles(false)} disabled={generatingTitles || !project.topic} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-700 flex items-center gap-2">
                          <BarChart3 size={16}/> {generatingTitles ? "Analyzing..." : "Generate Enterprise Titles"}
                      </button>
                  ) : (
                      <div className="w-full space-y-4">
                          <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border-2 border-green-500/30 shadow-sm">
                              <div className="flex justify-between items-start mb-2">
                                  <span className="text-[10px] font-bold text-green-600 uppercase tracking-wider">Champion Title</span>
                                  <span className="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 rounded-full">SCORE: 99/100</span>
                              </div>
                              <h4 className="text-xl font-extrabold text-slate-900 dark:text-white mb-1">{project.titleData.primary_title}</h4>
                              <p className="text-xs text-slate-500 italic">AI Champion Pick • Algorithmically Optimized</p>
                          </div>
                          
                          <div className="space-y-2">
                              <span className="text-[10px] font-bold text-slate-400 uppercase">Strategic Alternatives (Click to Promote)</span>
                              {project.titleData.alternative_titles.map((t, i) => (
                                  <div key={i} onClick={() => setSelectedTitle(t.title)} className={`p-3 bg-white dark:bg-slate-800 border rounded-lg hover:border-highlight cursor-pointer transition-all ${selectedTitle === t.title ? 'border-highlight ring-1 ring-highlight' : 'border-slate-200 dark:border-slate-700'}`}>
                                      <div className="flex justify-between">
                                          <span className="font-bold text-sm text-slate-800 dark:text-slate-200">{t.title}</span>
                                          <span className="font-mono text-xs text-slate-400 font-bold">{t.score}</span>
                                      </div>
                                      <div className="flex gap-2 mt-1">
                                          <span className="text-[9px] bg-slate-100 dark:bg-slate-700 text-slate-500 px-1.5 py-0.5 rounded">{t.formula_used}</span>
                                          <span className="text-[9px] text-slate-400 truncate flex-1">{t.reasoning}</span>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  )}
              </div>
          </div>

          {/* DESCRIPTION ARCHITECT */}
          <div className="bg-white dark:bg-slate-900 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)] overflow-hidden">
              <div className="bg-slate-400/20 p-3 flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
                  <h3 className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2"><AlignLeft size={16}/> Description Architect (10 Sections)</h3>
                  <button onClick={() => handleGenerateDescription(true)} disabled={generatingDescription || !project.topic} className="text-xs bg-white dark:bg-slate-800 px-3 py-1 rounded-full font-bold border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1">
                      {generatingDescription ? <Loader2 size={12} className="animate-spin"/> : <RefreshCw size={12}/>} Re-Spin
                  </button>
              </div>
              <div className="p-6 bg-slate-50 dark:bg-slate-900/50 min-h-[150px] flex items-center justify-center">
                  {!project.descriptionData ? (
                      <button onClick={() => handleGenerateDescription(false)} disabled={generatingDescription || !project.topic} className="px-6 py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-700 flex items-center gap-2">
                          <FileText size={16}/> {generatingDescription ? "Architecting..." : "Generate Optimized Description"}
                      </button>
                  ) : (
                      <div className="w-full relative">
                          <div className="absolute top-0 right-0 flex gap-2">
                              <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-1 rounded">SEO SCORE: {project.descriptionData.seo_score}/100</span>
                              <button onClick={() => copyToClipboard(project.descriptionData!.full_description)} className="text-[10px] font-bold bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600">COPY FULL</button>
                          </div>
                          <div className="h-64 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-white dark:bg-slate-800 text-xs font-mono whitespace-pre-wrap dark:text-slate-300">
                              {project.descriptionData.full_description}
                          </div>
                      </div>
                  )}
              </div>
          </div>

        </div>

        {/* RIGHT COLUMN (SIDEBAR CONTROLS) */}
        <div className="space-y-6">
          
          {/* NICHE BUCKET */}
          <div className="bg-white dark:bg-slate-900 p-6 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)]">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-3">NICHE BUCKET</label>
              <div className="space-y-2">
                  {['Survival', 'What If', 'Psychology', 'Education', 'Business', 'Storytelling', 'Finance', 'Elderly Advice'].map(n => (
                      <button 
                          key={n}
                          onClick={() => setProject(p => ({...p, niche: n as any}))}
                          className={`w-full text-left px-4 py-3 rounded-lg text-sm font-bold transition-all ${project.niche === n ? 'bg-highlight text-white shadow-md transform scale-105' : 'bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 dark:text-slate-300'}`}
                      >
                          {n}
                      </button>
                  ))}
              </div>
          </div>

          {/* VISUAL ART STYLE */}
          <div className="bg-white dark:bg-slate-900 p-6 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)]">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-3 flex items-center gap-2"><Palette size={14}/> Visual Art Style</label>
              <select 
                  value={project.artStyle} 
                  onChange={(e) => setProject(p => ({...p, artStyle: e.target.value as ArtStyle}))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-lg px-3 py-3 text-sm font-bold focus:border-highlight outline-none mb-4 dark:text-white"
              >
                  <option value="Nano Banana 2.5">Nano Banana 2.5 (Default)</option>
                  <option value="Nano Banana 2.5 (Inverted)">Nano Banana 2.5 (Dark Mode)</option>
                  <option value="Standard Sketch">Standard Sketch</option>
                  <option value="Standard Sketch (Inverted)">Standard Sketch (Dark)</option>
                  <option value="Charcoal Pencil">Charcoal Pencil</option>
                  <option value="Charcoal Pencil (Inverted)">Charcoal Pencil (Dark)</option>
                  <option value="Apocalypse">Apocalypse (Ink)</option>
                  <option value="Apocalypse (Inverted)">Apocalypse (Dark)</option>
                  <option value="Springfield Flat">Springfield Flat</option>
                  <option value="Tin-Tin">Tin-Tin Line Art</option>
                  <option value="Fallout">Fallout Retro</option>
                  <option value="Stickman">Stickman (Whiteboard)</option>
                  <option value="Stickman (Inverted)">Stickman (Blackboard)</option>
              </select>

              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-3 flex items-center gap-2"><Sparkles size={14}/> Color Accents</label>
              <div className="relative" ref={colorDropdownRef}>
                  <div 
                      className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-lg pl-3 pr-8 py-3 cursor-pointer flex items-center justify-between"
                      onClick={() => setIsColorDropdownOpen(!isColorDropdownOpen)}
                  >
                       <span className="text-slate-900 dark:text-white text-xs font-bold truncate flex items-center gap-2">
                           {activeColorPair.name}
                       </span>
                       <ChevronDown className={`text-slate-400 transition-transform ${isColorDropdownOpen ? 'rotate-180' : ''}`} size={16} />
                  </div>
                  
                  {isColorDropdownOpen && (
                      <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
                          {COLOR_PAIRS.map((pair, idx) => (
                              <div 
                                  key={idx} 
                                  className={`p-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800 last:border-0 flex flex-col gap-1 transition-colors ${project.colorSplash === pair.value ? 'bg-orange-50 dark:bg-orange-900/20' : ''}`}
                                  onClick={() => { setProject(p => ({...p, colorSplash: pair.value})); setIsColorDropdownOpen(false); }}
                              >
                                  <div className="flex items-center justify-between">
                                      <span className={`text-xs font-bold ${project.colorSplash === pair.value ? 'text-highlight' : 'text-slate-800 dark:text-slate-200'}`}>
                                          {pair.name}
                                      </span>
                                      {project.colorSplash === pair.value && <Check size={14} className="text-highlight"/>}
                                  </div>
                                  <div className="flex items-center gap-2">
                                       <div className="flex">
                                           {pair.colors.map((c, i) => (
                                               <div key={i} className={`w-3 h-3 rounded-full border border-slate-200 dark:border-slate-600 ${i===0 ? 'z-10' : '-ml-1.5'}`} style={{backgroundColor: c}}></div>
                                           ))}
                                       </div>
                                       <span className="text-[9px] text-slate-400 truncate">{pair.description}</span>
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          </div>

          {/* GLOBAL BACKGROUNDS */}
          <div className="bg-white dark:bg-slate-900 p-6 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)]">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-3 flex items-center gap-2"><ImageIcon size={14}/> Global Background Assets</label>
              
              <div className="grid grid-cols-2 gap-2 mb-4 max-h-[160px] overflow-y-auto">
                  {project.customBackgrounds.length === 0 && (
                      <div className="col-span-2 text-center py-4 text-xs text-slate-400 italic">No backgrounds uploaded.</div>
                  )}
                  {project.customBackgrounds?.map(bg => (
                      <div 
                        key={bg.id} 
                        onClick={() => !bg.isDisabled && setProject(prev => ({...prev, selectedBackgroundId: prev.selectedBackgroundId === bg.id ? null : bg.id}))}
                        className={`relative aspect-video rounded-lg overflow-hidden border-2 cursor-pointer transition-all group ${bg.isDisabled ? 'opacity-50 grayscale border-slate-300 dark:border-slate-700' : (project.selectedBackgroundId === bg.id ? 'border-highlight ring-2 ring-highlight/50' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300')}`}
                      >
                          <img src={bg.src} alt={bg.name} className="w-full h-full object-cover" />
                          <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={(e) => toggleBackgroundDisable(bg.id, e)} className={`p-1 rounded text-white ${bg.isDisabled ? 'bg-amber-500 hover:bg-amber-600' : 'bg-slate-500 hover:bg-slate-600'}`} title={bg.isDisabled ? "Enable" : "Disable"}><Power size={10}/></button>
                              <button onClick={(e) => handleDeleteBackground(bg.id, e)} className="p-1 rounded bg-red-500 hover:bg-red-600 text-white" title="Delete"><Trash2 size={10}/></button>
                          </div>
                          {project.selectedBackgroundId === bg.id && (
                              <div className="absolute bottom-0 left-0 right-0 bg-highlight text-white text-[9px] font-bold px-1 py-0.5 text-center">Selected Default</div>
                          )}
                      </div>
                  ))}
              </div>

              <label className="w-full py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center gap-2 border-2 border-slate-200 dark:border-slate-700 transition-all cursor-pointer">
                  <Upload size={16} /> Upload Background (16:9)
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleBackgroundUpload} />
              </label>
          </div>

          {/* VIDEO FORMAT */}
          <div className="bg-white dark:bg-slate-900 p-6 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)]">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-3 flex items-center gap-2"><Monitor size={14}/> Video Format</label>
              <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setProject(p => ({...p, aspectRatio: '16:9'}))} className={`p-4 rounded-lg border-2 flex flex-col items-center justify-center gap-2 transition-all ${project.aspectRatio === '16:9' ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-black dark:border-white' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'}`}>
                      <Monitor size={24}/>
                      <span className="text-xs font-bold">16:9 Landscape</span>
                  </button>
                  <button onClick={() => setProject(p => ({...p, aspectRatio: '9:16'}))} className={`p-4 rounded-lg border-2 flex flex-col items-center justify-center gap-2 transition-all ${project.aspectRatio === '9:16' ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-black dark:border-white' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'}`}>
                      <Smartphone size={24}/>
                      <span className="text-xs font-bold">9:16 Portrait</span>
                  </button>
              </div>
          </div>

          {/* SCENE PACE & LENGTH */}
          <div className="bg-white dark:bg-slate-900 p-6 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)] space-y-6">
              <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2 flex items-center gap-2"><Clock size={14}/> Scene Pace</label>
                  <div className="grid grid-cols-3 gap-2 mb-1">
                      <button onClick={() => setProject(p => ({...p, targetDuration: 'Fast'}))} className={`col-span-3 py-2 rounded font-bold text-xs ${project.targetDuration === 'Fast' ? 'bg-teal-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>FAST (TikTok)</button>
                      {[6, 12, 24].map(d => (
                          <button key={d} onClick={() => setProject(p => ({...p, targetDuration: d as TargetDuration}))} className={`py-2 rounded font-bold text-xs ${project.targetDuration === d ? 'bg-teal-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>{d}s</button>
                      ))}
                  </div>
                  <p className="text-[10px] text-slate-400 text-center font-bold">
                      {project.targetDuration === 'Fast' ? "High Retention (Short Scenes)" : project.targetDuration === 6 ? "Snappy Pacing" : project.targetDuration === 12 ? "Standard Storytelling" : "Slow / Deep Dive"}
                  </p>
              </div>

              <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2 flex items-center gap-2"><Timer size={14}/> Total Length <span className="text-red-500">*</span></label>
                  <div className="grid grid-cols-3 gap-2 mb-1">
                      {[5, 8, 12, 15, 20, 30].map(m => (
                          <button 
                              key={m} 
                              onClick={() => setProject(p => ({...p, totalDurationMinutes: m as TotalLength}))} 
                              className={`py-2 rounded font-bold text-xs transition-colors ${project.totalDurationMinutes === m ? 'bg-teal-600 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                          >
                              {m} min
                          </button>
                      ))}
                  </div>
                  <p className="text-[10px] text-slate-400 text-center font-bold">
                      {(project.totalDurationMinutes || 0) >= 8 ? "Long Form (Mid-Roll Ads)" : "Short Form"}
                  </p>
              </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)]">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-3 flex items-center gap-2"><Volume2 size={14}/> Default Drawing SFX</label>
              <label className="bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer hover:border-highlight transition-colors">
                  {project.globalSfxUrl ? (
                      <>
                          <Volume2 size={24} className="text-highlight mb-2"/>
                          <span className="text-xs font-bold text-highlight">SFX Uploaded</span>
                          <span className="text-[9px] text-slate-400">Click to replace</span>
                      </>
                  ) : (
                      <>
                          <Upload size={20} className="text-slate-400 mb-2"/>
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Upload Sound (MP3/WAV)</span>
                      </>
                  )}
                  <input type="file" accept="audio/*" className="hidden" onChange={handleGlobalSfxUpload} />
              </label>
              <p className="text-[10px] text-slate-400 mt-2 leading-tight">Upload sets Global Default. Click "Apply to All" to override existing scenes.</p>
          </div>

          {disabledItemCount > 0 && (
              <button 
                  onClick={handleDeleteDisabledAssets} 
                  className="w-full py-3 text-sm font-extrabold rounded-xl border border-red-200 bg-red-100 text-red-900 hover:bg-red-200 flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                  <Trash2 size={18}/> Delete {disabledItemCount} Disabled Cards
              </button>
          )}

          <button onClick={handleGenerate} disabled={loading || !isTopicSet} className="w-full py-4 bg-slate-600 hover:bg-slate-700 text-white text-lg font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.5)] active:translate-y-1 active:shadow-none transition-all">
            {loading ? <Loader2 className="animate-spin" /> : <Wand2 size={24} />} Generate Script
          </button>

          {project.script && (
            <div className="space-y-3 relative">
                {disabledItemCount > 0 && (
                    <div className="absolute -top-3 -left-1 bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded-full z-10 shadow-md transform -rotate-6 border border-white">
                        - {disabledItemCount} Disabled
                    </div>
                )}
                <button onClick={handleSmartUpdate} disabled={loading} className="w-full py-4 text-lg font-bold rounded-xl flex items-center justify-center gap-2 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.5)] active:translate-y-1 active:shadow-none transition-all bg-green-500 text-white hover:bg-green-600">
                  {loading && <Loader2 className="animate-spin" />}
                  {!loading && <ArrowRight size={24} />}
                  Update Storyboard
                </button>
            </div>
          )}
        </div>
      </div>
      
      {/* Hand Calibration Modal */}
      {calibratingHand && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/90 backdrop-blur-md" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white dark:bg-slate-900 w-full max-w-6xl rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[85vh]">
                <div className="bg-slate-900 text-white px-6 py-4 border-b border-slate-700 flex justify-between items-center relative z-[210]">
                    <h3 className="text-xl font-extrabold flex items-center gap-2 font-doodle"><Crosshair className="text-highlight"/> Hand Calibration</h3>
                    <button onClick={() => setCalibratingHand(null)} className="text-slate-400 hover:text-white p-1"><X size={24}/></button>
                </div>
                
                <div className="flex-1 w-full flex items-center justify-center overflow-visible p-12 relative bg-paper dark:bg-slate-950">
                     <div className="relative bg-white shadow-2xl w-auto h-auto max-w-full max-h-full aspect-video border-4 border-dashed border-slate-300 flex-shrink-0 z-10">
                         <div className="absolute left-1/2 top-1/2 w-0 h-0 flex items-center justify-center visible">
                              <div style={{ transform: `scale(${calibrationScale})` }} className="relative origin-center flex items-center justify-center">
                                   <div className="relative cursor-crosshair select-none" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const offsetX = e.clientX - rect.left; const offsetY = e.clientY - rect.top; const normX = Math.max(0, Math.min(1, offsetX / rect.width)); const normY = Math.max(0, Math.min(1, offsetY / rect.height)); saveCalibration(calibratingHand.id, normX, normY); }}>
                                       <img src={calibratingHand.src} className="block max-w-none select-none pointer-events-none drop-shadow-2xl" draggable={false} alt="hand" />
                                       <div className="absolute w-0 h-0 pointer-events-none transition-all duration-75" style={{ left: `${(calibratingHand.tipOffset?.x ?? 0.5) * 100}%`, top: `${(calibratingHand.tipOffset?.y ?? 0.5) * 100}%` }}>
                                           <div style={{ transform: `translate(-50%, -50%) scale(${1/calibrationScale})` }}><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" className="drop-shadow-lg"><circle cx="12" cy="12" r="8"/><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg></div>
                                       </div>
                                   </div>
                              </div>
                         </div>
                     </div>
                </div>
                
                <div className="bg-white dark:bg-slate-900 p-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-8 relative z-[70]">
                    <div className="flex items-center gap-4 flex-1">
                        <Move className="text-slate-400" size={20} />
                        <span className="text-xs font-bold uppercase text-slate-900 dark:text-white w-32">Hand Scale</span>
                        <input type="range" min="0.1" max="3.0" step="0.1" value={calibrationScale} onChange={(e) => { const val = parseFloat(e.target.value); setCalibrationScale(val); setProject(prev => ({ ...prev, customHands: prev.customHands.map(h => h.id === calibratingHand.id ? { ...h, scale: val } : h) })); }} className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-highlight" />
                        <span className="text-sm font-mono font-bold w-12 text-right">{calibrationScale.toFixed(2)}x</span>
                    </div>
                </div>
            </div>
        </div>
      )}

      {showVoiceModal && (
          <VoiceSelectorModal
              isOpen={showVoiceModal}
              onClose={() => setShowVoiceModal(false)}
              currentVoiceId={project.voice}
              currentConfig={project.genAiProConfig!}
              onSelectVoice={(v, c) => {
                  setProject(prev => ({ ...prev, voice: v.id, voiceLabel: v.label, voiceProvider: v.provider, genAiProConfig: c }));
                  setShowVoiceModal(false);
              }}
          />
      )}
    </div>
  );
};

export default ScriptEditor;
