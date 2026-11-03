# ÜberDoodle: guide for Claude Code

Golpo-accurate hand-drawn doodle video studio. React 19 + Vite 6 + TypeScript, Tailwind 3 (bundled via PostCSS), a local Node CORS proxy, and an optional Python (FastAPI) backend.

## Commands
- `npm run dev`: Vite dev server on http://localhost:5173
- `npm run proxy`: local proxy on :3002. Needed for Kie, GenAiPro, and saving proxy-held keys.
- `npm run typecheck` · `npm test` (vitest) · `npm run build`
- Python: `python -m py_compile main.py sketchApi.py`
- Before you say a change is done, run: typecheck, test, build.

## Layout
- `App.tsx`: shell, step navigation, error boundary, lazy-loaded screens.
- `components/`: Storyboard, ScriptEditor, PreviewPlayer (draw-on renderer and export), ThumbnailCreator, JackTheRipper, SettingsModal, modals.
- `services/golpoStyle.ts`: **Golpo source of truth**: palette, 3:2 canvas, stroke and jitter, timing, image prompt builder, palette post-process. Spec: `GOLPO_PRESET.md`.
- `services/geminiService.ts`: all AI calls, central `GEMINI_MODELS`, `withRetry`, provider routing:
  - text-only calls go to the local LLM when `textProvider` is `lmstudio` or `unsloth` (`generate()` → `textOnlyPrompt()`)
  - images go to Kie when `imageProvider` is `kie`, and video when `videoProvider` is `kie`
- `services/kieService.ts`: Kie.ai Nano Banana (`/api/v1/jobs/*`) and Veo 3 (`/api/v1/veo/*`), always through the proxy.
- `services/localLlmService.ts`: OpenAI-compatible client for LM Studio (:1234) and Unsloth servers (:8080).
- `services/settings.ts`: persisted settings (localStorage) and proxy-held secrets (`/proxy/settings`).
- `services/genAiProService.ts`: TTS (LMNT, ElevenLabs, GenAiPro via proxy).
- `cors-proxy.mjs`: localhost-only, allowlisted, not an open relay. It stores secrets in `.uberdoodle-secrets.json`.

## Rules
- **Never hardcode or commit keys.** Keys come from Settings, `.env.local`, or the proxy secrets file, and all of those are gitignored. Don't read those files.
- Keep exported service function signatures stable. Add only optional params.
- Golpo fidelity: take values from `golpoStyle.ts`, never hand-copy hex values or timings.
  - Doodle frames are 3:2.
  - Paper is `#FEFEFD`.
  - Drawing is sequential, about 0.8s per element, then a 1.5s hold.
- Any new outbound host in the proxy must be allowlisted. Never add a generic `?url=` relay.
- New buttons need an `aria-label`. Heavy screens are loaded with `React.lazy`.
- Windows is the main dev OS: keep the `.bat` launchers working and the paths cross-platform.
