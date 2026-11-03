import React, { useState } from 'react';
import { Scene, AspectRatio } from '../types';
import { editImageWithGemini } from '../services/geminiService';
import { X, Wand2, Loader2, RefreshCcw } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  scene: Scene;
  aspectRatio: AspectRatio;
  onUpdateImage: (id: string, newImage: string) => void;
}

const ImageEditModal: React.FC<Props> = ({ isOpen, onClose, scene, aspectRatio, onUpdateImage }) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen || !scene.imageUrl) return null;

  const handleEdit = async () => {
    if (!prompt) return;
    setLoading(true);
    setError('');
    try {
      const newImage = await editImageWithGemini(scene.imageUrl!, prompt, aspectRatio);
      onUpdateImage(scene.id, newImage);
      setPrompt(''); // Reset prompt after success
    } catch (err) {
      setError("Failed to edit image. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-paper w-full max-w-3xl rounded-xl border-4 border-black shadow-[8px_8px_0px_0px_rgba(234,88,12,1)] overflow-hidden">
        <div className="bg-slate-900 p-4 flex justify-between items-center text-white">
          <h3 className="font-bold text-xl flex items-center gap-2">
            <Wand2 className="text-highlight" />
            Magic Edit (Gemini 2.5)
          </h3>
          <button onClick={onClose} className="hover:bg-slate-700 p-1 rounded">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
             <div className="bg-white p-2 border-2 border-black rounded shadow-sm flex items-center justify-center bg-slate-50">
               <img 
                 src={scene.imageUrl} 
                 alt="Scene" 
                 className={`max-w-full max-h-64 object-contain ${aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-video'}`} 
                />
             </div>
             <p className="text-xs text-slate-600 font-bold text-center">Original Scene #{scene.number}</p>
          </div>

          <div className="space-y-4 flex flex-col justify-center">
             <div className="space-y-2">
                <h4 className="font-extrabold text-xl text-secondary">What should we change?</h4>
                <p className="text-sm font-medium text-slate-800">
                  Use natural language to edit this doodle.
                  <br/>
                  <span className="text-slate-600 italic">"Add a red hat to the stick figure"</span>
                  <br/>
                  <span className="text-slate-600 italic">"Make the background look like a storm"</span>
                </p>
             </div>

             <textarea 
               value={prompt}
               onChange={(e) => setPrompt(e.target.value)}
               placeholder="Describe your changes..."
               className="w-full h-32 p-3 border-2 border-black rounded bg-white text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-highlight resize-none placeholder:text-slate-400"
             />

             {error && <p className="text-red-600 text-sm font-bold">{error}</p>}

             <button
               onClick={handleEdit}
               disabled={loading || !prompt}
               className="w-full py-3 bg-secondary text-white font-bold rounded hover:bg-teal-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none transition-all"
             >
               {loading ? <Loader2 className="animate-spin" /> : <RefreshCcw size={18} />}
               Regenerate with Edit
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageEditModal;