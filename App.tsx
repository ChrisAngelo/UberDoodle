import React, { useState, useRef, useEffect } from 'react';
import { getSettings } from './services/settings';
import { ProjectState } from './types';
import ScriptEditor from './components/ScriptEditor';
const Storyboard = React.lazy(() => import('./components/Storyboard'));
const PreviewPlayer = React.lazy(() => import('./components/PreviewPlayer'));
const ThumbnailCreator = React.lazy(() => import('./components/ThumbnailCreator'));
const JackTheRipper = React.lazy(() => import('./components/JackTheRipper'));
const SettingsModal = React.lazy(() => import('./components/SettingsModal'));

type BoundaryProps = { children: React.ReactNode; label?: string; resetKey?: unknown };
type BoundaryState = { error: Error | null };

/** Catches render errors so a crash in one panel never blanks the whole studio. */
export class ErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  // Explicit member declarations: the repo has no @types/react, so inherited members aren't typed.
  declare props: Readonly<BoundaryProps>;
  declare setState: (state: BoundaryState) => void;
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('[UberDoodle] UI crash', error, info.componentStack); }
  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="m-6 max-w-xl mx-auto p-6 rounded-2xl border-2 border-[#CFAF8A] bg-[#FEFEFD] text-[#1B1009] shadow-[4px_4px_0_#7A5A3F]">
        <h2 className="text-lg font-extrabold mb-2">{this.props.label || 'Something went wrong'}</h2>
        <p className="text-sm text-[#7A5A3F] mb-4 break-words">{this.state.error.message || String(this.state.error)}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => this.setState({ error: null })} className="px-4 py-2 rounded-full bg-[#D66A3A] text-white text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B1009]">Try again</button>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-full border border-[#CFAF8A] text-[#7A5A3F] text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B1009]">Reload studio</button>
        </div>
      </div>
    );
  }
}

const PanelLoading: React.FC<{ label?: string }> = ({ label = 'Loading' }) => (
  <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-20 text-[#7A5A3F]">
    <span className="w-5 h-5 rounded-full border-2 border-[#CFAF8A] border-t-[#D66A3A] animate-spin" aria-hidden="true" />
    <span className="text-sm font-semibold">{label}...</span>
  </div>
);
import { PenTool, Image, Film, Menu, Save, Upload, Undo, Redo, LayoutTemplate, FilePlus, Sparkles, MonitorPlay, Sun, Moon, Trash2, RefreshCw, Power, Scissors, Sword, Settings as SettingsIcon } from 'lucide-react';

// --- ATTRIBUTION & VERSION CONTROL ---
// OWNER: Christian Angelo Nilsén 19801031-0137
// CODE STARTED: 2025-01-10
// VERSION DATE: 2025-02-24
// -------------------------------------

const DEFAULT_HANDS_ID = 'no-hand';

const INITIAL_PROJECT_STATE: ProjectState = {
    topic: '',
    niche: 'Survival',
    targetDuration: 12,
    script: '',
    scriptLanguage: 'English (US)',
    scenes: [],
    currentStep: 'script',
    isProcessing: false,
    artStyle: 'Nano Banana 2.5',
    brushStyle: 'Solid Marker',
    revealStyle: 'Standard Pencil',
    spreadLevel: 5,
    drawingPace: 1.0,
    textFirst: false,
    outlinesFirst: false,
    voice: 'Kore',
    voiceProvider: 'Google',
    narrationStyle: 'Storytelling',
    showHand: true,
    selectedHandId: DEFAULT_HANDS_ID,
    customHands: [],
    customBackgrounds: [],
    selectedBackgroundId: null,
    aspectRatio: '16:9',
    exportResolution: '1080p',
    analyzedStylePrompt: undefined,
    masterVolume: 1.0,
    narrationMasterVolume: 1.0,
    sfxMasterVolume: 1.0,
    musicVolume: 0.5,
    exportStartScene: 1,
    exportEndScene: undefined,
    showCaptions: false,
    isOfflineRender: false,
    useGPU: false,
    exportOptions: {
        includeVideo: true,
        includeNarration: false,
        includeSfx: false,
        includeMusic: false,
        includeCaptions: false
    },
    thumbnails: []
};

export interface JackPersistedState {
    audioFile: File | null;
    audioUrl: string | null;
    audioBuffer: AudioBuffer | null;
    audioDuration: number;
    markers: any[];
    regions: any[];
    transcript: any | null;
    zoom: number;
    scrollLeft: number;
}

const App: React.FC = () => {
  const [history, setHistory] = useState<ProjectState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showSettings, setShowSettings] = useState(false);
  const isHistoryAction = useRef(false);

  const [project, _setProject] = useState<ProjectState>(INITIAL_PROJECT_STATE);
  const [showJackGlobal, setShowJackGlobal] = useState(false);
  const [jackEverOpened, setJackEverOpened] = useState(false);
  useEffect(() => { if (showJackGlobal) setJackEverOpened(true); }, [showJackGlobal]);
  
  const [jackState, setJackState] = useState<JackPersistedState>({
      audioFile: null,
      audioUrl: null,
      audioBuffer: null,
      audioDuration: 0,
      markers: [],
      regions: [],
      transcript: null,
      zoom: 1,
      scrollLeft: 0
  });
  
  const [isDarkMode, setIsDarkMode] = useState(() => {
      if (typeof window !== 'undefined') {
          return localStorage.getItem('doodleMinds_theme') === 'dark' || 
                 (!localStorage.getItem('doodleMinds_theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      }
      return false;
  });

  const [manualThemeOverride, setManualThemeOverride] = useState(() => {
      if (typeof window !== 'undefined') {
          return localStorage.getItem('doodleMinds_manual_theme') === 'true';
      }
      return false;
  });

  useEffect(() => {
      const root = window.document.documentElement;
      if (isDarkMode) {
          root.classList.add('dark');
          localStorage.setItem('doodleMinds_theme', 'dark');
      } else {
          root.classList.remove('dark');
          localStorage.setItem('doodleMinds_theme', 'light');
      }
  }, [isDarkMode]);

  useEffect(() => {
      if (manualThemeOverride) return;
      const style = project.artStyle;
      const isInverted = style.includes("(Inverted)");
      if (isInverted && !isDarkMode) setIsDarkMode(true);
      else if (!isInverted && isDarkMode) setIsDarkMode(false);
  }, [project.artStyle, manualThemeOverride]);

  useEffect(() => {
      const style = project.artStyle;
      const isInverted = style.includes("(Inverted)");
      if (isInverted) {
          const needsUpdate = project.scenes.some(s => !s.isLocked && (s.layerBlendMode !== 'screen' || !s.enableGlobalBackground));
          if (needsUpdate) {
              _setProject(prev => ({
                  ...prev,
                  scenes: prev.scenes.map(s => s.isLocked ? s : { ...s, enableGlobalBackground: true, layerBlendMode: 'screen' })
              }));
          }
      } else {
          const needsUpdate = project.scenes.some(s => !s.isLocked && s.layerBlendMode !== 'multiply');
          if (needsUpdate) {
              _setProject(prev => ({
                  ...prev,
                  scenes: prev.scenes.map(s => s.isLocked ? s : { ...s, layerBlendMode: 'multiply' })
              }));
          }
      }
  }, [project.artStyle, project.scenes.length]);

  const handleManualThemeToggle = () => {
      setIsDarkMode(prev => !prev);
      setManualThemeOverride(true);
      localStorage.setItem('doodleMinds_manual_theme', 'true');
  };

  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);

  useEffect(() => {
      const forceSaved = localStorage.getItem('DOODLEMINDS_FORCE_SAVE');
      const standardSave = localStorage.getItem('doodleMinds_project');
      const savedData = forceSaved || standardSave;
      if (savedData) {
          try {
              const recoveredProject = JSON.parse(savedData);
              if (!recoveredProject.scenes) recoveredProject.scenes = [];
              if (!recoveredProject.customHands) recoveredProject.customHands = [];
              if (!recoveredProject.customBackgrounds) recoveredProject.customBackgrounds = [];
              projectRef.current = recoveredProject;
              _setProject(recoveredProject);
              setHistory([recoveredProject]);
              setHistoryIndex(0);
              if (forceSaved) localStorage.removeItem('DOODLEMINDS_FORCE_SAVE');
          } catch (e) {
              console.error("Failed to recover project", e);
          }
      } else {
           if (history.length === 0) {
              setHistory([project]);
              setHistoryIndex(0);
           }
      }
  }, []);

  const setProject = (value: React.SetStateAction<ProjectState>) => {
      const next = typeof value === 'function' ? (value as Function)(projectRef.current) : value;
      projectRef.current = next;
      if (!isHistoryAction.current) {
        const newHistory = history.slice(0, historyIndex + 1);
        if (newHistory.length >= 10) newHistory.shift();
        newHistory.push(next);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
      }
      _setProject(next);
      isHistoryAction.current = false;
  };

  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          // Don't hijack keys while focus is on an interactive control (keeps Tab/Space keyboard navigation working)
          const t = e.target as HTMLElement | null;
          if (t && t !== document.body && (t.isContentEditable || t.closest('button, a, [role="button"], [contenteditable="true"], label'))) return;
          if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              setIsSidebarOpen(prev => !prev);
          }
          // Global Search Shortcut 'S'
          if (e.key.toLowerCase() === 's' && !showJackGlobal) {
              const searchInput = document.querySelector('input[placeholder="# or Text"]') as HTMLInputElement;
              if (searchInput) {
                  e.preventDefault();
                  searchInput.focus();
              }
          }
          if (e.key === ' ' && !showJackGlobal) {
              e.preventDefault();
              if (project.currentStep !== 'preview') setProject(prev => ({ ...prev, currentStep: 'preview' }));
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [project.currentStep, showJackGlobal]);

  const handleUndo = () => {
    if (historyIndex > 0) {
      isHistoryAction.current = true;
      setHistoryIndex(historyIndex - 1);
      _setProject(history[historyIndex - 1]);
      projectRef.current = history[historyIndex - 1];
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      isHistoryAction.current = true;
      setHistoryIndex(historyIndex + 1);
      _setProject(history[historyIndex + 1]);
      projectRef.current = history[historyIndex + 1];
    }
  };

  const handleSave = async () => {
    const currentProject = projectRef.current;
    let data = "";
    try { data = JSON.stringify(currentProject, null, 2); } catch (e) { return; }
    const filename = currentProject.topic ? currentProject.topic.replace(/[^a-z0-9\s-_]/gi, '').trim().replace(/\s+/g, '-') : `doodleminds-project-${Date.now()}`;
    try {
        // @ts-ignore
        if (window.showSaveFilePicker) {
            // @ts-ignore
            const handle = await window.showSaveFilePicker({
                suggestedName: `${filename}.json`,
                types: [{ description: 'DoodleMinds Project File', accept: { 'application/json': ['.json'] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(data);
            await writable.close();
            return;
        }
    } catch (err: any) { if (err.name === 'AbortError') return; }
    try {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${filename}.json`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    } catch (e) {}
    setTimeout(() => { try { localStorage.setItem('doodleMinds_project', data); } catch (e) {} }, 0);
  };

  const handleLoad = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (json.topic !== undefined) {
           const merged = { ...project, ...json };
           if (!merged.thumbnails) merged.thumbnails = [];
           if (!merged.customBackgrounds) merged.customBackgrounds = [];
           setProject(merged);
           try { localStorage.setItem('doodleMinds_project', JSON.stringify(merged)); } catch(e){}
           alert("Project loaded successfully!");
        }
      } catch (err) { alert("Invalid project file."); }
    };
    reader.readAsText(file);
  };

  const handleResetProject = () => {
      if(window.confirm("WARNING: This will delete your current project and clear the workspace. Are you sure?")) {
          localStorage.removeItem('doodleMinds_project');
          localStorage.removeItem('DOODLEMINDS_FORCE_SAVE');
          _setProject(INITIAL_PROJECT_STATE);
          projectRef.current = INITIAL_PROJECT_STATE;
          setHistory([INITIAL_PROJECT_STATE]);
          setHistoryIndex(0);
          isHistoryAction.current = false;
          setJackState({ audioFile: null, audioUrl: null, audioBuffer: null, audioDuration: 0, markers: [], regions: [], transcript: null, zoom: 1, scrollLeft: 0 });
      }
  };

  const renderStep = () => {
    switch (project.currentStep) {
      case 'script': return <ScriptEditor project={project} setProject={setProject} />;
      case 'storyboard': return <Storyboard project={project} setProject={setProject} jackState={jackState} setJackState={setJackState} />;
      case 'preview': return <PreviewPlayer project={project} setProject={setProject} />;
      case 'thumbnails': return <ThumbnailCreator project={project} setProject={setProject} />;
      default: return <ScriptEditor project={project} setProject={setProject} />;
    }
  };

  const navItems = [
    { id: 'script', label: 'Script & Settings', icon: PenTool }, 
    { id: 'storyboard', label: 'Timeline', icon: Image },
    { id: 'preview', label: 'Render & Export', icon: MonitorPlay },
    { id: 'thumbnails', label: 'Viral Thumbnail Creator', icon: LayoutTemplate },
  ];

  return (
    <div className={`flex h-screen font-sans transition-colors duration-300 ${isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-[#F8F9FB] text-slate-800'}`}>
      <aside className={`${isSidebarOpen ? 'w-64' : 'w-20'} transition-all duration-300 flex flex-col border-r z-30 shadow-sm ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
        <div className={`p-6 flex items-center justify-between border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
          {isSidebarOpen && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-tr from-orange-500 to-orange-700 rounded-lg shadow-lg flex items-center justify-center"><Sparkles className="text-white w-5 h-5" /></div>
              <span className={`font-extrabold text-lg tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>DoodleMinds</span>
            </div>
          )}
          <button onClick={() => setIsSidebarOpen(o => !o)} aria-label={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} aria-expanded={isSidebarOpen} className={`transition-colors ${isDarkMode ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-900'}`}><Menu size={20} /></button>
        </div>

        <div className={`flex flex-col gap-4 px-4 py-4 ${!isSidebarOpen ? 'items-center' : ''}`}>
            <div className={`flex gap-2 ${!isSidebarOpen ? 'flex-col' : ''}`}>
                <button onClick={handleUndo} disabled={historyIndex <= 0} className={`p-2 rounded-lg disabled:opacity-30 transition-colors border ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200'}`} title="Undo" aria-label="Undo"><Undo size={18} /></button>
                <button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className={`p-2 rounded-lg disabled:opacity-30 transition-colors border ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200'}`} title="Redo" aria-label="Redo"><Redo size={18} /></button>
            </div>
            <div className={`flex gap-2 ${!isSidebarOpen ? 'flex-col' : ''}`}>
                <button onClick={handleResetProject} className={`p-2 rounded-lg hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors border ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-slate-50 text-slate-400 border-slate-200'}`} title="Clear Workspace" aria-label="Clear Workspace"><Trash2 size={18} /></button>
                <button onClick={() => window.location.reload()} className={`p-2 rounded-lg hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-red-900/30 transition-colors border ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-slate-50 text-slate-400 border-slate-200'}`} title="Refresh UI" aria-label="Refresh UI"><RefreshCw size={18} /></button>
            </div>
            <div className={`flex gap-2 ${!isSidebarOpen ? 'flex-col' : ''}`}>
                <button onClick={handleSave} className={`p-2 text-highlight rounded-lg transition-colors border ${isDarkMode ? 'bg-slate-800 border-slate-700 hover:bg-slate-700' : 'bg-slate-50 hover:bg-orange-100 border-slate-200'}`} title="Save Project" aria-label="Save Project"><Save size={18} /></button>
                <label className={`p-2 text-highlight rounded-lg transition-colors border cursor-pointer ${isDarkMode ? 'bg-slate-800 border-slate-700 hover:bg-slate-700' : 'bg-slate-50 hover:bg-orange-100 border-slate-200'}`} title="Load Project" aria-label="Load Project"><Upload size={18} /><input type="file" onChange={handleLoad} accept=".json" className="hidden" /></label>
            </div>
        </div>

        <nav className="flex-1 px-3 space-y-2 mt-2 flex flex-col">
          {navItems.map((item) => (
            <button key={item.id} aria-label={item.label} aria-current={project.currentStep === item.id ? 'page' : undefined} onClick={() => setProject(prev => ({ ...prev, currentStep: item.id as any }))} className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all text-sm font-semibold ${project.currentStep === item.id ? 'bg-orange-50 text-orange-700 shadow-sm border border-orange-100 dark:bg-slate-800 dark:text-highlight dark:border-slate-700' : (isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900')} ${!isSidebarOpen ? 'justify-center' : ''}`}>
              <item.icon size={20} className={project.currentStep === item.id ? 'text-highlight' : (isDarkMode ? 'text-slate-500' : 'text-slate-400')} />
              {isSidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
          {/* Global Jack Shortcut */}
          <button onClick={() => setShowJackGlobal(true)} aria-label="Open Jack The Ripper audio splitter" className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all text-sm font-semibold text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 ${!isSidebarOpen ? 'justify-center' : ''}`}>
              <Sword size={20} className="text-red-500" />
              {isSidebarOpen && <span>Jack The Ripper</span>}
          </button>
        </nav>

        {isSidebarOpen && (
            <div className={`p-4 border-t flex items-center justify-center ${isDarkMode ? 'border-slate-800 text-slate-500' : 'border-slate-100 text-slate-400'}`}>
                <span className="text-[10px] font-medium uppercase tracking-widest">Studio v3.2</span>
            </div>
        )}
      </aside>

      <main className={`flex-1 min-w-0 overflow-hidden flex flex-col relative ${isDarkMode ? 'bg-slate-950' : 'bg-[#F8F9FC]'}`}>
        <div className={`h-16 w-full border-b flex items-center px-4 md:px-8 gap-3 justify-between min-w-0 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.05)] z-20 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <h2 className={`text-base md:text-xl font-bold tracking-tight flex items-center gap-2 truncate min-w-0 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                {project.currentStep === 'script' && <><PenTool size={20} className="text-highlight"/> Script & Settings</>}
                {project.currentStep === 'storyboard' && <><Image size={20} className="text-highlight"/> Visual Timeline</>}
                {project.currentStep === 'preview' && <><Film size={20} className="text-highlight"/> Rendering Engine</>}
                {project.currentStep === 'thumbnails' && <><LayoutTemplate size={20} className="text-highlight"/> Viral Thumbnail Creator</>}
            </h2>
            <div className="flex items-center gap-4">
                <button onClick={() => setShowSettings(true)} className={`p-2 rounded-full transition-colors border shadow-sm ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`} title="Settings & API keys" aria-label="Settings and API keys"><SettingsIcon size={16} /></button>
                <button onClick={handleManualThemeToggle} className={`p-2 rounded-full transition-colors border shadow-sm ${isDarkMode ? 'bg-slate-800 border-slate-700 text-yellow-400 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`} title={isDarkMode ? "Light Mode" : "Dark Mode"} aria-label={isDarkMode ? "Light Mode" : "Dark Mode"}>{isDarkMode ? <Sun size={16} /> : <Moon size={16} />}</button>
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border shadow-sm ${isDarkMode ? 'bg-green-900/20 text-green-400 border-green-900/50' : 'bg-green-50 text-green-700 border-green-200'}`}><div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>{getSettings().textProvider === "gemini" ? "Gemini" : getSettings().textProvider === "lmstudio" ? "LM Studio" : "Unsloth"} Live</div>
                {showSettings && <React.Suspense fallback={null}><SettingsModal onClose={() => setShowSettings(false)} /></React.Suspense>}
            </div>
        </div>
        <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent p-3 md:p-6">
           <ErrorBoundary label="This panel crashed" resetKey={project.currentStep}>
             <React.Suspense fallback={<PanelLoading label="Loading workspace" />}>
               {renderStep()}
             </React.Suspense>
           </ErrorBoundary>
        </div>
      </main>
      
      {/* Jack the Ripper Global Modal */}
      {/* Mounted on first open, then kept alive (hidden) so its internal state survives closing */}
      {jackEverOpened && (
      <div style={{ display: showJackGlobal ? 'flex' : 'none', position: 'fixed', inset: 0, zIndex: 500 }}>
          <ErrorBoundary label="Jack The Ripper crashed">
            <React.Suspense fallback={<PanelLoading label="Loading Jack The Ripper" />}>
              <JackTheRipper project={project} setProject={setProject} onClose={() => setShowJackGlobal(false)} initialState={jackState} onPersistState={setJackState} />
            </React.Suspense>
          </ErrorBoundary>
      </div>
      )}
    </div>
  );
};

export default App;