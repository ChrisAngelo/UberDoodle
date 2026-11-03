# main.py - Updated API endpoints (Golpo preset defaults wired in)
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from sketchApi import DoodleMindsAI, GOLPO_PRESET, DEFAULT_COLORS, DEFAULT_STROKE, DEFAULT_BACKGROUND

app = FastAPI(title="DoodleMinds API - Golpo Preset")

# Enable CORS for your frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production!
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GenerationRequest(BaseModel):
    prompt: str
    credentials_json: str = None  # Partner's service account JSON
    project_id: str = None
    location: str = None
    apply_preset: bool = True

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
            detail=f"Authentication failed: {ai.error}"
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
    """Demo endpoint using YOUR default credentials."""
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
    print("Open: http://localhost:8000")
    print("Docs: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info", log_config=None)