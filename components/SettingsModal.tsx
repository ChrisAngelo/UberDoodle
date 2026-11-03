import React, { useEffect, useState } from 'react';
import { X, KeyRound, Save, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Eye, EyeOff, Cpu, Image as ImageIcon, Film } from 'lucide-react';
import { AppSettings, getSettings, saveSettings, getProxySecretStatus, saveProxySecrets, ProxySecretStatus, TextProvider } from '../services/settings';
import { getLocalServer, listLocalModels } from '../services/localLlmService';

interface Props { onClose: () => void }

const inputCls = 'w-full bg-paper dark:bg-slate-950 border border-tan dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-ink dark:text-slate-100 focus:outline-none focus:border-highlight';
const labelCls = 'block text-xs font-bold uppercase tracking-wider text-umber dark:text-slate-300 mb-1';

const SecretInput: React.FC<{ id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: React.ReactNode }> =
    ({ id, label, value, onChange, placeholder, hint }) => {
        const [show, setShow] = useState(false);
        return (
            <div>
                <label htmlFor={id} className={labelCls}>{label}</label>
                <div className="flex gap-2">
                    <input id={id} type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={value}
                        onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
                    <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? `Hide ${label}` : `Show ${label}`}
                        className="px-3 rounded-lg border border-tan dark:border-slate-700 text-umber hover:text-highlight">
                        {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                </div>
                {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
            </div>
        );
    };

const SettingsModal: React.FC<Props> = ({ onClose }) => {
    const [s, setS] = useState<AppSettings>(getSettings());
    const [kieKey, setKieKey] = useState('');
    const [genaiproJwt, setGenaiproJwt] = useState('');
    const [proxy, setProxy] = useState<ProxySecretStatus | null>(null);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [models, setModels] = useState<Record<string, string[]>>({});
    const [probe, setProbe] = useState<Record<string, string>>({});

    const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setS(prev => ({ ...prev, [k]: v }));

    useEffect(() => { getProxySecretStatus().then(setProxy); }, []);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const testLocal = async (p: TextProvider) => {
        saveSettings(s); // probe with the URLs currently typed
        const server = getLocalServer(p);
        if (!server) return;
        setProbe(prev => ({ ...prev, [p]: 'Checking…' }));
        try {
            const list = await listLocalModels(server);
            setModels(prev => ({ ...prev, [p]: list }));
            setProbe(prev => ({ ...prev, [p]: list.length ? `Connected · ${list.length} model(s)` : 'Connected · no model loaded' }));
        } catch (e) {
            setProbe(prev => ({ ...prev, [p]: (e as Error).message }));
        }
    };

    const handleSave = async () => {
        setSaving(true); setMsg(null);
        try {
            saveSettings(s);
            const secrets: { kieApiKey?: string; genaiproJwt?: string } = {};
            if (kieKey.trim()) secrets.kieApiKey = kieKey.trim();
            if (genaiproJwt.trim()) secrets.genaiproJwt = genaiproJwt.trim();
            if (Object.keys(secrets).length) {
                setProxy(await saveProxySecrets(secrets));
                setKieKey(''); setGenaiproJwt('');
            }
            setMsg({ ok: true, text: 'Saved. Settings persist after closing the app.' });
        } catch (e) {
            setMsg({ ok: false, text: `Browser settings saved, but proxy keys were not: ${(e as Error).message}. Start the proxy (npm run proxy) and save again.` });
        } finally {
            setSaving(false);
        }
    };

    const clearProxyKey = async (field: 'kieApiKey' | 'genaiproJwt') => {
        try { setProxy(await saveProxySecrets({ [field]: '' })); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    };

    const proxyBadge = (configured: boolean | undefined) => proxy?.reachable === false
        ? <span className="text-amber-600">proxy offline</span>
        : configured ? <span className="text-green-700 inline-flex items-center gap-1"><CheckCircle2 size={12} /> saved on this PC</span>
            : <span className="text-slate-400">not set</span>;

    const localBlock = (p: 'lmstudio' | 'unsloth', title: string, urlKey: 'lmStudioUrl' | 'unslothUrl', modelKey: 'lmStudioModel' | 'unslothModel', hint: string) => (
        <div className="border border-tan/60 dark:border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-ink dark:text-slate-100">{title}</span>
                <button type="button" onClick={() => testLocal(p)} className="text-xs font-bold text-highlight inline-flex items-center gap-1" aria-label={`Test ${title} connection`}>
                    <RefreshCw size={12} /> Test
                </button>
            </div>
            <input aria-label={`${title} server URL`} className={inputCls} value={s[urlKey]} onChange={e => set(urlKey, e.target.value)} />
            <input aria-label={`${title} model id`} className={inputCls} list={`${p}-models`} value={s[modelKey]} onChange={e => set(modelKey, e.target.value)} placeholder="Model id (blank = first loaded model)" />
            <datalist id={`${p}-models`}>{(models[p] || []).map(m => <option key={m} value={m} />)}</datalist>
            <p className="text-[11px] text-slate-500">{probe[p] || hint}</p>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border-2 border-ink dark:border-slate-700 shadow-[6px_6px_0_0_#1B1009]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-tan/60 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-900 z-10">
                    <h2 id="settings-title" className="text-lg font-extrabold text-ink dark:text-white flex items-center gap-2"><KeyRound size={18} className="text-highlight" /> Settings & API Keys</h2>
                    <button onClick={onClose} aria-label="Close settings" className="p-1 text-slate-500 hover:text-ink"><X size={20} /></button>
                </div>

                <div className="p-6 space-y-6">
                    <section className="space-y-3">
                        <h3 className="text-sm font-extrabold text-ink dark:text-white">Providers</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                                <label htmlFor="text-provider" className={labelCls}><Cpu size={11} className="inline mr-1" />Text / scripts</label>
                                <select id="text-provider" className={inputCls} value={s.textProvider} onChange={e => set('textProvider', e.target.value as TextProvider)}>
                                    <option value="gemini">Gemini (cloud)</option>
                                    <option value="lmstudio">LM Studio (local)</option>
                                    <option value="unsloth">Unsloth (local)</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="image-provider" className={labelCls}><ImageIcon size={11} className="inline mr-1" />Images</label>
                                <select id="image-provider" className={inputCls} value={s.imageProvider} onChange={e => set('imageProvider', e.target.value as AppSettings['imageProvider'])}>
                                    <option value="gemini">Gemini</option>
                                    <option value="kie">Kie · Nano Banana</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="video-provider" className={labelCls}><Film size={11} className="inline mr-1" />Video</label>
                                <select id="video-provider" className={inputCls} value={s.videoProvider} onChange={e => set('videoProvider', e.target.value as AppSettings['videoProvider'])}>
                                    <option value="gemini">Gemini Veo</option>
                                    <option value="kie">Kie · Veo 3</option>
                                </select>
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-500">Local LLMs handle text-only tasks. Image analysis, transcription and voices stay on Gemini/TTS providers.</p>
                    </section>

                    <section className="space-y-3">
                        <h3 className="text-sm font-extrabold text-ink dark:text-white">Cloud keys <span className="font-normal text-[11px] text-slate-500">(stored in this browser)</span></h3>
                        <SecretInput id="gemini-key" label="Gemini API key" value={s.geminiApiKey} onChange={v => set('geminiApiKey', v)} placeholder="AIza…" />
                        <SecretInput id="lmnt-key" label="LMNT API key" value={s.lmntApiKey} onChange={v => set('lmntApiKey', v)} />
                        <SecretInput id="eleven-key" label="ElevenLabs API key" value={s.elevenLabsApiKey} onChange={v => set('elevenLabsApiKey', v)} />
                    </section>

                    <section className="space-y-3">
                        <h3 className="text-sm font-extrabold text-ink dark:text-white">Proxy-held keys <span className="font-normal text-[11px] text-slate-500">(saved to disk by the local proxy, never stored in the browser)</span></h3>
                        <SecretInput id="kie-key" label="Kie.ai API key" value={kieKey} onChange={setKieKey} placeholder="Leave blank to keep current"
                            hint={<span className="flex items-center gap-2">{proxyBadge(proxy?.kieConfigured)}{proxy?.kieConfigured && <button type="button" className="underline" onClick={() => clearProxyKey('kieApiKey')}>remove</button>}</span>} />
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="kie-image-model" className={labelCls}>Kie image model</label>
                                <input id="kie-image-model" className={inputCls} list="kie-image-models" value={s.kieImageModel} onChange={e => set('kieImageModel', e.target.value)} />
                                <datalist id="kie-image-models"><option value="nano-banana-pro" /><option value="nano-banana-2" /></datalist>
                            </div>
                            <div>
                                <label htmlFor="kie-video-model" className={labelCls}>Kie Veo model</label>
                                <input id="kie-video-model" className={inputCls} list="kie-video-models" value={s.kieVideoModel} onChange={e => set('kieVideoModel', e.target.value)} />
                                <datalist id="kie-video-models"><option value="veo3_fast" /><option value="veo3" /></datalist>
                            </div>
                        </div>
                        <SecretInput id="genaipro-jwt" label="GenAiPro token" value={genaiproJwt} onChange={setGenaiproJwt} placeholder="Leave blank to keep current"
                            hint={<span className="flex items-center gap-2">{proxyBadge(proxy?.genaiproConfigured)}{proxy?.genaiproConfigured && <button type="button" className="underline" onClick={() => clearProxyKey('genaiproJwt')}>remove</button>}</span>} />
                        <div>
                            <label htmlFor="proxy-url" className={labelCls}>Proxy URL</label>
                            <input id="proxy-url" className={inputCls} value={s.proxyUrl} onChange={e => set('proxyUrl', e.target.value)} />
                        </div>
                    </section>

                    <section className="space-y-3">
                        <h3 className="text-sm font-extrabold text-ink dark:text-white">Local LLM servers</h3>
                        {localBlock('lmstudio', 'LM Studio', 'lmStudioUrl', 'lmStudioModel', 'Developer tab → Start Server, and enable CORS. Default http://localhost:1234/v1')}
                        {localBlock('unsloth', 'Unsloth', 'unslothUrl', 'unslothModel', 'OpenAI-compatible server for your Unsloth model (llama-server :8080, Unsloth Studio, or vLLM). Allow CORS.')}
                        <SecretInput id="local-key" label="Local server API key (optional)" value={s.localLlmApiKey} onChange={v => set('localLlmApiKey', v)} />
                    </section>

                    {msg && (
                        <div role="status" className={`text-sm rounded-lg p-3 flex gap-2 ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                            {msg.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{msg.text}
                        </div>
                    )}
                    <p className="text-[11px] text-slate-500">Browser keys are saved in this browser's local storage on this PC. Don't use this on a shared computer.</p>
                </div>

                <div className="flex justify-end gap-2 px-6 py-4 border-t border-tan/60 dark:border-slate-700 sticky bottom-0 bg-white dark:bg-slate-900">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">Close</button>
                    <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-bold bg-highlight text-white hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2">
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
