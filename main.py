# main.py - Updated API endpoints (Golpo preset defaults wired in)
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import os
import re
from sketchApi import DoodleMindsAI, GOLPO_PRESET, DEFAULT_COLORS, DEFAULT_STROKE, DEFAULT_BACKGROUND

app = FastAPI(title="DoodleMinds API - Golpo Preset")

# Enable CORS for your frontend
app.add_middleware(
    CORSMiddleware,
    # Comma-separated list; defaults to the local Vite dev/preview servers only.
    allow_origins=[o.strip() for o in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"
    ).split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

MAX_PROMPT_CHARS = 8000
MAX_CREDENTIALS_CHARS = 20000
_PROJECT_RE = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
_LOCATION_RE = re.compile(r"^[a-z]+-[a-z]+[0-9]{1,2}$")


def _clean_prompt(v: str) -> str:
    v = (v or "").strip()
    if not v:
        raise ValueError("prompt must not be empty")
    if len(v) > MAX_PROMPT_CHARS:
        raise ValueError(f"prompt exceeds {MAX_PROMPT_CHARS} characters")
    return v

class GenerationRequest(BaseModel):
    prompt: str = Field(..., max_length=MAX_PROMPT_CHARS)
    credentials_json: str | None = Field(None, max_length=MAX_CREDENTIALS_CHARS)
    project_id: str | None = None
    location: str | None = None
    apply_preset: bool = True

    @field_validator("prompt")
    @classmethod
    def _v_prompt(cls, v):
        return _clean_prompt(v)

    @field_validator("project_id")
    @classmethod
    def _v_project(cls, v):
        if v is not None and not _PROJECT_RE.match(v):
            raise ValueError("invalid GCP project_id")
        return v

    @field_validator("location")
    @classmethod
    def _v_location(cls, v):
        if v is not None and not _LOCATION_RE.match(v):
            raise ValueError("invalid GCP location")
        return v

@app.get("/")
async def root():
    return {
        "message": "DoodleMinds API - Multi-tenant Vertex AI Gateway",
        "status": "online",
        "preset": "golpo",
        "background": DEFAULT_BACKGROUND,
        "colors": DEFAULT_COLORS,
        "stroke": DEFAULT_STROKE,
        "instructions": "POST /generate with credentials_json"
    }

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "DoodleMinds API", "preset": "golpo"}

@app.get("/preset")
async def get_preset():
    """Return the Golpo preset defaults (colors, stroke, canvas)."""
    return GOLPO_PRESET

@app.post("/generate")
async def generate_sketch(request: GenerationRequest):
    """Main endpoint for partners to use with their own credentials."""

    # Initialize AI with partner's credentials (Golpo preset defaults wired in)
    ai = DoodleMindsAI(
        credentials_json=request.credentials_json,
        project_id=request.project_id,
        location=request.location,
    )

    if ai.error:
        raise HTTPException(
            status_code=401,
            detail="Authentication failed: check credentials_json / project_id"
        )

    # Generate content
    result = ai.generate_sketch(request.prompt, apply_preset=request.apply_preset)

    if "❌ Generation failed" in result:
        raise HTTPException(
            status_code=500,
            detail="Content generation failed. Check Vertex AI quota."
        )

    return {
        "success": True,
        "project": ai.project_id,
        "preset": "golpo",
        "background": ai.background,
        "colors": ai.colors,
        "stroke": ai.stroke,
        "result": result,
        "message": f"Generated using partner project: {ai.project_id}"
    }

@app.post("/generate-demo")
async def generate_demo(prompt: str, apply_preset: bool = True):
    """Demo endpoint using YOUR default credentials. Disabled unless ENABLE_DEMO=1."""
    if os.getenv("ENABLE_DEMO") != "1":
        raise HTTPException(status_code=404, detail="Not found")
    try:
        prompt = _clean_prompt(prompt)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    ai = DoodleMindsAI()  # Uses your env credentials (Golpo preset defaults)

    if ai.error:
        raise HTTPException(status_code=500, detail="Server misconfigured")

    result = ai.generate_sketch(prompt, apply_preset=apply_preset)
    return {
        "success": True,
        "project": ai.project_id,
        "preset": "golpo",
        "result": result,
        "note": "Using default server credentials. For production, use /generate with your own credentials."
    }

if __name__ == "__main__":
    import uvicorn
    print("Starting DoodleMinds API (Golpo preset)...")
    print(f"📡 Project: {os.getenv('GCP_PROJECT_ID', 'test-mode')}")
    host = os.getenv("API_HOST", "127.0.0.1")
    port = int(os.getenv("API_PORT", "8000"))
    print(f"Open: http://{host}:{port}  Docs: http://{host}:{port}/docs")
    uvicorn.run(app, host=host, port=port, log_level="info", log_config=None)