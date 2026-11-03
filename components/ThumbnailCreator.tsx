
import React, { useState, useRef, useEffect } from 'react';
import { ProjectState, ThumbnailStyle, Thumbnail, Scene } from '../types';
import { generateHighCTRThumbnail, analyzeImageStyle } from '../services/geminiService';
import { Wand2, Loader2, Download, Trash2, Image as ImageIcon, RefreshCw, Sparkles, LayoutTemplate, X, Upload, ChevronDown, Palette, Check } from 'lucide-react';
import ImageEditModal from './ImageEditModal';

interface Props {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
}

const COLOR_PAIRS = [
    { name: "Default (Model Choice)", value: "", description: "Let the AI decide based on style.", colors: ['#94a3b8', '#cbd5e1'] },
    { name: "Ember Red + Arctic Cyan", value: "Deep Ember Red (#EA580C) and Arctic Cyan (#06B6D4)", description: "High emotional concept. Pure, dark, digital.", colors: ['#EA580C', '#06B6D4'] },
    { name: "Volt Lime + Midnight", value: "Volt Lime (#84CC16) and Midnight Blue (#0F172A)", description: "Electric highlight on deep traumatic-tones.", colors: ['#84CC16', '#0F172A'] },
    { name: "Solar Gold + Deep Navy", value: "Solar Gold (#FACC15) and Deep Navy (#1E3A8A)", description: "Luxury + authority. Classic cinematic contrast.", colors: ['#FACC15', '#1E3A8A'] },
    { name: "Plasma Pink + Cyber Mint", value: "Plasma Pink (#EC4899) and Cyber Mint (#14B8A6)", description: "Future-state, high energy.", colors: ['#EC4899', '#14B8A6'] },
    { name: "Inferno Orange + Abyss Blue", value: "Inferno Orange (#F97316) and Abyss Blue (#172554)", description: "Sci-fi dramatic notice element.", colors: ['#F97316', '#172554'] },
    { name: "Meteor Rust + Shore Wave", value: "Meteor Rust (#9A3412) and Shore Wave (#0EA5E9)", description: "Organic resilient contrast.", colors: ['#9A3412', '#0EA5E9'] },
    { name: "Bloodfire Crimson + Ice Shard", value: "Bloodfire Crimson (#DC2626) and Ice Shard (#38BDF8)", description: "Chaos + clarity. Great for psychology.", colors: ['#DC2626', '#38BDF8'] },
    { name: "Pumpkin Neon + Deep Petrol", value: "Pumpkin Neon (#FF7D00) and Deep Petrol (#003D3D)", description: "Refined, editorial evolution.", colors: ['#FF7D00', '#003D3D'] },
    { name: "Scarlet Punch + Glacier", value: "Scarlet Punch (#FF2400) and Glacier White (#F5F5FF)", description: "Bold emotional accent with fashion-cold.", colors: ['#FF2400', '#F5F5FF'] },
    { name: "Burnt Saffron + Mineral Blue", value: "Burnt Saffron (#F4C430) and Mineral Blue (#004C54)", description: "Earth + ocean, extremely cinematic.", colors: ['#F4C430', '#004C54'] },
    { name: "Midnight Petrol + Nectarine", value: "Midnight Petrol (#004040) and Nectarine (#FF884D)", description: "Modern, classy, refined editorial.", colors: ['#004040', '#FF884D'] },
];

const ThumbnailCreator: React.FC<Props> = ({ project, setProject }) => {
  const [style, setStyle] = useState<ThumbnailStyle>('MrBeast');
  const [customPrompt, setCustomPrompt] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [selectedColorPair, setSelectedColorPair] = useState(COLOR_PAIRS[0].value);
  const [isGenerating, setIsGenerating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [fullscreenThumb, setFullscreenThumb] = useState<string | null>(null);
  const [referenceImagePreview, setReferenceImagePreview] = useState<string | null>(null);
  const [isColorDropdownOpen, setIsColorDropdownOpen] = useState(false);
  
  // Magic Edit State
  const [editingThumbnail, setEditingThumbnail] = useState<Thumbnail | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
              setIsColorDropdownOpen(false);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleGenerate = async () => {
      if (!project.script) return;
      setIsGenerating(true);
      try {
          const context = project.script.substring(0, 1000); // First 1000 chars usually contain hook + intro
          // Look up description for prompt context
          const colorPairDesc = COLOR_PAIRS.find(c => c.value === selectedColorPair)?.value;
          
          console.log("Generating thumbnail with:", { context: context.length, niche: project.niche, style, colorPairDesc });

          const imageUrl = await generateHighCTRThumbnail(context, project.niche, style, customPrompt, stylePrompt, colorPairDesc);
          
          if (!imageUrl) throw new Error("Empty image URL returned");

          const newThumbnail: Thumbnail = {
              id: `thumb-${Date.now()}`,
              imageUrl,
              promptUsed: customPrompt || style,
              style
          };
          
          setProject(prev => ({
              ...prev,
              thumbnails: [...(prev.thumbnails || []), newThumbnail]
          }));
      } catch (e: any) {
          console.error("Thumbnail Generation Failed:", e);
          alert(`Failed to generate thumbnail: ${e.message || "Unknown error"}`);
      } finally {
          setIsGenerating(false);
      }
  };

  const handleStyleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setAnalyzing(true);
      const reader = new FileReader();
      reader.onload = async (ev) => {
          const result = ev.target?.result as string;
          setReferenceImagePreview(result);
          // AUTO SELECT CUSTOM IMAGE
          setStyle('Custom'); 
          try {
              const analysis = await analyzeImageStyle(result);
              setStylePrompt(analysis);
          } catch (err) {
              alert("Failed to analyze image style.");
          } finally {
              setAnalyzing(false);
          }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
  };

  const handleStylePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setStylePrompt(val);
      if (val.length > 0) setStyle('Custom');
  };

  const downloadImage = (url: string, id: string) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `viral-thumbnail-${id}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };

  const deleteThumbnail = (id: string) => {
      if(window.confirm("Delete this thumbnail?")) {
          setProject(prev => ({
              ...prev,
              thumbnails: prev.thumbnails.filter(t => t.id !== id)
          }));
      }
  };
  
  const handleUpdateThumbnailImage = (id: string, newImage: string) => {
      setProject(prev => ({
          ...prev,
          thumbnails: prev.thumbnails.map(t => t.id === id ? { ...t, imageUrl: newImage } : t)
      }));
      setEditingThumbnail(null);
  };

  // Button mapping - renamed Custom to Custom Image
  const PRESET_BUTTONS = ['MrBeast', 'Minimalist', 'Shocking', 'Versus', 'Story', 'Charcoal Pencil', 'Custom', 'Psychology'];

  const activeColorPair = COLOR_PAIRS.find(c => c.value === selectedColorPair) || COLOR_PAIRS[0];
  
  const allowColorSplash = ['Charcoal Pencil (Color Splash)', 'Apocalypse (Color Splash)', 'Standard Sketch'].some(s => style.includes(s));

  return (
    <div className="max-w-6xl mx-auto p-6 pb-32">
      <div className="bg-white dark:bg-slate-900 border-2 border-black dark:border-slate-700 rounded-xl shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)] p-6 mb-8">
          <div className="flex items-center gap-3 mb-4 border-b-2 border-slate-100 dark:border-slate-800 pb-4">
              <LayoutTemplate size={32} className="text-highlight"/>
              <div>
                  <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white font-doodle">Viral Thumbnails</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-bold">Generate High-CTR Covers based on your script.</p>
              </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Controls */}
              <div className="space-y-6">
                  <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Style Preset</label>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                          {PRESET_BUTTONS.map((s) => (
                              <button
                                key={s}
                                onClick={() => setStyle(s as ThumbnailStyle)}
                                className={`py-3 px-2 rounded-lg border-2 text-xs font-bold transition-all ${
                                    style === s 
                                        ? (s === 'Custom' ? 'bg-orange-700 text-white border-orange-800' : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-black dark:border-highlight')
                                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                  {s === 'Custom' ? 'Custom Image' : s}
                              </button>
                          ))}
                      </div>
                      
                      {/* Detailed Sketch Styles Dropdown */}
                      <div className="relative">
                           <select 
                                value={['Sketch A', 'Charcoal Pencil (Color Splash)', 'Apocalypse (Color Splash)', 'Standard Sketch', 'Springfield Flat'].includes(style) ? style : ''}
                                onChange={(e) => {
                                    if(e.target.value) setStyle(e.target.value as ThumbnailStyle);
                                }}
                                className={`w-full bg-slate-50 dark:bg-slate-800 border-2 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-lg px-3 py-3 appearance-none focus:border-highlight focus:outline-none ${['Sketch A', 'Charcoal Pencil (Color Splash)', 'Apocalypse (Color Splash)', 'Standard Sketch', 'Springfield Flat'].includes(style) ? 'border-highlight dark:border-highlight' : 'border-slate-200 dark:border-slate-700'}`}
                           >
                               <option value="" disabled>Detailed Sketch Styles...</option>
                               <option value="Sketch A">Sketch A (Noir Graphic Novel)</option>
                               <option value="Charcoal Pencil (Color Splash)">Charcoal Pencil (Color Splash)</option>
                               <option value="Apocalypse (Color Splash)">Apocalypse (Color Splash)</option>
                               <option value="Standard Sketch">Standard Sketch</option>
                               <option value="Springfield Flat">Springfield Flat (Simpsons-Like)</option>
                           </select>
                           <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                      </div>
                  </div>
                  
                  {/* Cinematic Color Pairs (Custom Dropdown) */}
                  {allowColorSplash && (
                      <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors relative" ref={dropdownRef}>
                          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2 flex items-center gap-2">
                              <Palette size={12} className="text-highlight"/> Cinematic Color Pair
                          </label>
                          
                          <div 
                              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg pl-3 pr-8 py-2 cursor-pointer flex items-center justify-between"
                              onClick={() => setIsColorDropdownOpen(!isColorDropdownOpen)}
                          >
                               <span className="text-slate-900 dark:text-white text-xs font-bold truncate flex items-center gap-2">
                                   {activeColorPair.name}
                               </span>
                               <ChevronDown className={`text-slate-400 transition-transform ${isColorDropdownOpen ? 'rotate-180' : ''}`} size={16} />
                          </div>
                          
                          {/* Visual Color Indicators for Selected */}
                          <div className="flex gap-1 mt-2 mb-1">
                               {activeColorPair.colors.map((c, i) => (
                                   <div key={i} className={`w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 shadow-sm ${i===0 ? 'z-10' : '-ml-2'}`} style={{backgroundColor: c}}></div>
                               ))}
                               <span className="text-[10px] text-slate-500 dark:text-slate-400 italic ml-2 leading-4 truncate">
                                  {activeColorPair.description}
                               </span>
                          </div>

                          {/* Dropdown Menu */}
                          {isColorDropdownOpen && (
                              <div className="absolute top-[calc(100%-10px)] left-0 right-0 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto mt-2">
                                  {COLOR_PAIRS.map((pair, idx) => (
                                      <div 
                                          key={idx} 
                                          className={`p-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800 last:border-0 flex flex-col gap-1 transition-colors ${selectedColorPair === pair.value ? 'bg-orange-50 dark:bg-orange-900/20' : ''}`}
                                          onClick={() => { setSelectedColorPair(pair.value); setIsColorDropdownOpen(false); }}
                                      >
                                          <div className="flex items-center justify-between">
                                              <span className={`text-xs font-bold ${selectedColorPair === pair.value ? 'text-highlight' : 'text-slate-800 dark:text-slate-200'}`}>
                                                  {pair.name}
                                              </span>
                                              {selectedColorPair === pair.value && <Check size={14} className="text-highlight"/>}
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
                  )}
                  
                  {/* Style Reference Upload */}
                  <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2 flex justify-between items-center">
                          <span>Visual Style Reference</span>
                          <label className="cursor-pointer text-highlight flex items-center gap-1 hover:underline text-[10px] font-bold">
                              {analyzing ? <Loader2 size={12} className="animate-spin"/> : <Upload size={12}/>}
                              {analyzing ? 'Analyzing...' : 'Upload Image'}
                              <input type="file" accept="image/*" className="hidden" onChange={handleStyleUpload} disabled={analyzing}/>
                          </label>
                      </label>
                      
                      {/* Image Preview */}
                      {referenceImagePreview && (
                          <div className="mb-2 relative w-full aspect-video bg-slate-200 dark:bg-slate-700 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 group">
                               <img src={referenceImagePreview} alt="Reference" className="w-full h-full object-cover" />
                               <button 
                                  onClick={() => { setReferenceImagePreview(null); setStylePrompt(''); }}
                                  className="absolute top-1 right-1 bg-black/50 hover:bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-all"
                                  title="Remove Image"
                               >
                                  <X size={12} />
                               </button>
                          </div>
                      )}

                      <textarea 
                        value={stylePrompt}
                        onChange={handleStylePromptChange}
                        placeholder="Paste a style prompt here, or upload an image to analyze its style automatically..."
                        className="w-full h-24 p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded text-xs focus:border-highlight focus:outline-none resize-none placeholder:text-slate-400 dark:text-slate-200"
                      />
                  </div>

                  <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Custom Hook / Text Override</label>
                      <textarea 
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder="E.g. Make the text say 'SECRET REVEALED' in red..."
                        className="w-full h-20 p-3 bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium focus:border-highlight focus:outline-none resize-none dark:text-slate-200"
                      />
                  </div>

                  <button 
                    onClick={handleGenerate} 
                    disabled={isGenerating || !project.script}
                    className="w-full py-4 bg-highlight text-white text-lg font-bold rounded-xl hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg transition-all active:translate-y-1 active:shadow-none"
                  >
                      {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles size={24} />}
                      Generate Viral Cover
                  </button>
                  {!project.script && <p className="text-xs text-red-500 font-bold text-center">Script required to generate.</p>}
              </div>

              {/* Gallery */}
              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-2">
                  {(!project.thumbnails || project.thumbnails.length === 0) && (
                      <div className="col-span-full h-64 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800">
                          <ImageIcon size={48} className="mb-2 opacity-50"/>
                          <span className="font-bold">No thumbnails yet</span>
                      </div>
                  )}
                  
                  {project.thumbnails?.map(thumb => (
                      <div key={thumb.id} className="group relative bg-white dark:bg-slate-800 rounded-xl border-2 border-slate-200 dark:border-slate-700 overflow-hidden hover:border-black dark:hover:border-white transition-all shadow-sm hover:shadow-md cursor-zoom-in" onClick={() => setFullscreenThumb(thumb.imageUrl)}>
                          <img src={thumb.imageUrl} alt="Thumbnail" className="w-full aspect-video object-cover" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                              <button onClick={(e) => { e.stopPropagation(); downloadImage(thumb.imageUrl, thumb.id); }} className="p-3 bg-white rounded-full text-slate-900 hover:text-highlight shadow-lg transition-transform hover:scale-110" title="Download"><Download size={20} /></button>
                              <button onClick={(e) => { e.stopPropagation(); setEditingThumbnail(thumb); }} className="p-3 bg-white rounded-full text-purple-500 hover:text-purple-700 shadow-lg transition-transform hover:scale-110" title="Magic Edit (Inpaint)"><Wand2 size={20} /></button>
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] font-bold px-2 py-1 truncate pointer-events-none">
                              {thumb.style} (Click to View)
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      </div>
      
      {/* Fullscreen Modal - Fixed to cover entire screen */}
      {fullscreenThumb && (
          <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center" onClick={() => setFullscreenThumb(null)}>
              <img src={fullscreenThumb} alt="Full Preview" className="w-full h-full object-cover" onClick={e => e.stopPropagation()} />
              <button onClick={() => setFullscreenThumb(null)} className="absolute top-4 right-4 text-white hover:text-gray-300 bg-white/20 p-2 rounded-full backdrop-blur-md transition-colors"><X size={32}/></button>
          </div>
      )}
      
      {/* Magic Edit Modal */}
      {editingThumbnail && (
        <ImageEditModal 
          isOpen={!!editingThumbnail}
          onClose={() => setEditingThumbnail(null)}
          scene={{
              id: editingThumbnail.id,
              number: 0,
              script: '',
              visualDescription: editingThumbnail.promptUsed,
              imageUrl: editingThumbnail.imageUrl,
              isGenerating: false,
              // Partial mock of Scene to satisfy interface for ImageEditModal
          } as Scene}
          aspectRatio="16:9" // Thumbnails default to 16:9
          onUpdateImage={handleUpdateThumbnailImage}
        />
      )}
    </div>
  );
};

export default ThumbnailCreator;
