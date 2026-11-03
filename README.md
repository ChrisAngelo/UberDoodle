# ÜberDoodle

Golpo-accurate doodle studio. A standalone companion UI for generating and previewing hand-drawn doodle video with a Golpo-derived palette and pacing (see [GOLPO_PRESET.md](GOLPO_PRESET.md)).

## Golpo-accurate preset

- Canvas background: `#FEFEFD` (not pure white), 3:2 aspect (1536x1024).
- Palette: ink `#1B1009`, fill `#CFAF8A`, accent `#D66A3A`, shadow `#7A5A3F`.
- Stroke width 4px, round caps/joins, slight 2-4px jitter on straight segments.
- Sequential draw-on, ~0.8s per stroke, ~1.5s hold. Avoid simultaneous multi-element animation.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

The Vite dev server runs on http://localhost:5173. The CORS proxy (port 3001/3002) is started by `START.bat`.

## Launchers

- `START.bat` - launches CORS proxy + Vite dev server.
- `start-dev.bat` - Vite dev server only (run `start-proxy.bat` separately).
- `start-proxy.bat` - CORS proxy only.
- `INSTALL.bat` - installs npm dependencies.

## Verification

- `python -m py_compile main.py sketchApi.py`
- `node --check` on changed `.js`/`.ts`/`.tsx` files.