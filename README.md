# ÜberDoodle

Golpo-accurate doodle studio: a React 19 + Vite + TypeScript app for generating and previewing hand-drawn whiteboard doodle video. It uses a palette, stroke style and pacing taken from Golpo (see [GOLPO_PRESET.md](GOLPO_PRESET.md)).

## Golpo preset

- Canvas: 1536x1024 (3:2). The background is `#FEFEFD`, not pure white.
- Palette: ink `#1B1009`, fill `#CFAF8A`, accent `#D66A3A`, shadow `#7A5A3F`, mid `#A87A52`.
- Stroke: 4px with round caps and joins. Lines get a deterministic 2-4px hand wobble (`jitterPath`).
- Timing: strokes draw on one after another. Each takes about 0.8s (clamped to 0.6-1.2s by `strokeDurationSec`), then holds for about 1.5s.
- Source of truth: `services/golpoStyle.ts` on the frontend and `GOLPO_PRESET` in `sketchApi.py` on the backend.

## Architecture

```
Browser (Vite app: App.tsx, components/, services/)
  ├── Gemini (@google/genai) ──────────── direct from browser, key bundled at build time
  └── http://127.0.0.1:3002  cors-proxy.mjs ── GenAiPro API (genaipro.vn) + allowlisted audio CDNs
Optional: http://127.0.0.1:8000  main.py (FastAPI) → sketchApi.py → Vertex AI
```

## Setup

Prerequisites: Node.js 20+ (CI uses 22). Python 3.10+ is needed only for the backend.

```bash
npm install
cp .env.example .env.local        # Windows: copy .env.example .env.local
# edit .env.local: set GEMINI_API_KEY and GENAIPRO_JWT
```

### Run (Linux / macOS)

```bash
npm run proxy      # terminal 1: CORS proxy on 127.0.0.1:3002
npm run dev        # terminal 2: app on http://localhost:5173
```

Optional Python backend:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py     # http://127.0.0.1:8000/docs
```

### Run (Windows)

- `INSTALL.bat`: runs `npm install`.
- `START.bat`: starts the proxy and the dev server, and creates `.env.local` from `.env.example` if it is missing.
- `start-dev.bat` / `start-proxy.bat`: start each one separately.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` (vendor chunks: react, genai, jszip, lucide) |
| `npm run preview` | Serve `dist/` |
| `npm run proxy` | Start `cors-proxy.mjs` |
| `npm test` | Vitest unit tests (`tests/`) |
| `npm run typecheck` | `tsc --noEmit` |
| `python -m py_compile main.py sketchApi.py` | Backend syntax check |
| `python tools/build_backend.py` | PyInstaller one-file backend build (needs `.venv-build` with PyInstaller) |

CI (`.github/workflows/ci.yml`) runs `npm ci`, typecheck, tests, build and a `py_compile` check.

## Security notes

- **Gemini key is client-side.** `vite.config.ts` injects `GEMINI_API_KEY` into the JS bundle with `define`, so anyone who can load the app or `dist/` can read it. Use real keys only for local use, and never publish a build that contains one. The dev server binds to `127.0.0.1` unless you set `VITE_HOST`.
- **CORS proxy:**
  - It listens on `127.0.0.1` only.
  - It accepts browser requests only from localhost origins.
  - `/proxy/genaipro/*` can reach only `GENAIPRO_API_URL`.
  - `/proxy/fetch-audio` fetches only `https` URLs on hosts in `AUDIO_HOST_ALLOWLIST`.
  - Request bodies are capped at 1 MB and responses at 50 MB.
  - The legacy open relay `/?url=` has been removed.
  - The GenAiPro token is read from `GENAIPRO_JWT`.
- **Backend:**
  - It binds to `127.0.0.1`, and CORS is limited to `ALLOWED_ORIGINS`.
  - It validates inputs: prompt length, project ID and location format, and that the credentials are a service-account JSON.
  - `/generate-demo` is disabled unless `ENABLE_DEMO=1`.
  - Dependencies are pinned in `requirements.txt`.


## Settings, providers & API keys

Click the **gear icon** (top right) to open **Settings & API Keys**. Everything saved there persists after closing the app:

| What | Where it is stored |
|---|---|
| Gemini, LMNT, ElevenLabs keys, provider choices, local LLM URLs/models | Browser `localStorage` on this PC |
| Kie.ai key, GenAiPro token | Local proxy writes `.uberdoodle-secrets.json` (gitignored, `chmod 600`). Never stored in the browser. |

The proxy must be running (`npm run proxy`, or `START.bat`) for Kie, GenAiPro and saving proxy-held keys.

### Kie.ai: Nano Banana + Veo 3
- **Images:** set **Images → Kie · Nano Banana**. Model `nano-banana-pro` (or `nano-banana-2`). It uses `POST /api/v1/jobs/createTask` and polls `recordInfo`. Frames are requested at 3:2 and get the Golpo palette post-process.
- **Video:** set **Video → Kie · Veo 3**. Model `veo3_fast` (or `veo3`). It uses `POST /api/v1/veo/generate` and polls `veo/record-info`. A scene image is uploaded and used as the first frame.
- Every call goes through the proxy (`/proxy/kie/api/v1/*`), which adds your key server-side.

### Local LLMs: LM Studio & Unsloth
Set **Text / scripts → LM Studio** or **Unsloth**. Text-only tasks (scripts, scene breakdown, hooks, titles, translation) then run locally. Image analysis, transcription and TTS stay on cloud providers.
- **LM Studio:** Developer tab → *Start Server*, enable **CORS**. Default `http://localhost:1234/v1`.
- **Unsloth:** serve your Unsloth model with any OpenAI-compatible server: Unsloth Studio, llama.cpp `llama-server -m model.gguf --port 8080`, or `vllm serve <model> --port 8081 --allowed-origins '["http://localhost:5173"]'`. Port 8000 is taken by the Python backend. Default `http://localhost:8080/v1`.
- Click **Test** in Settings to list the loaded models.
