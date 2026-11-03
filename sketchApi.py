# sketchApi.py - Updated for multi-tenant support + Golpo preset defaults
import os
import json
try:
    import vertexai
    from vertexai.preview.generative_models import GenerativeModel
    VERTEXAI_AVAILABLE = True
except Exception:
    vertexai = None
    GenerativeModel = None
    VERTEXAI_AVAILABLE = False
from google.oauth2 import service_account
from google.auth.exceptions import GoogleAuthError

# Golpo-accurate doodle preset defaults (colors, stroke)
# Derived from GOLPO_PRESET.md (1536x1024, 3:2 canvas).
GOLPO_PRESET = {
    "canvas": {
        "width": 1536,
        "height": 1024,
        "aspect": "3:2",
        "background": "#FEFEFD",
    },
    "colors": {
        "ink": "#1B1009",
        "fill": "#CFAF8A",
        "accent": "#D66A3A",
        "shadow": "#7A5A3F",
        "secondary": "#A87A52",
    },
    "stroke": {
        "width": 4,
        "caps": "round",
        "joins": "round",
        "jitter_px": 3,
    },
    "animation": {
        "draw_on_duration_s": 0.8,
        "hold_s": 1.5,
        "sequential": True,
    },
}

# Convenience aliases for callers that expect flat defaults.
DEFAULT_COLORS = GOLPO_PRESET["colors"]
DEFAULT_STROKE = GOLPO_PRESET["stroke"]
DEFAULT_BACKGROUND = GOLPO_PRESET["canvas"]["background"]


class DoodleMindsAI:
    def __init__(self, credentials_json=None, project_id=None, location=None,
                 preset=GOLPO_PRESET):
        """
        Initialize Vertex AI with optional partner credentials.

        Args:
            credentials_json (str/dict): Partner's service account JSON or dict
            project_id (str): Partner's GCP project ID
            location (str): GCP location (defaults to us-central1)
            preset (dict): Style preset defaults (colors/stroke). Defaults to
                the Golpo preset.
        """
        # Golpo preset defaults wired in (colors, stroke, canvas).
        self.preset = preset or GOLPO_PRESET
        self.colors = self.preset.get("colors", DEFAULT_COLORS)
        self.stroke = self.preset.get("stroke", DEFAULT_STROKE)
        self.background = self.preset.get("canvas", {}).get("background", DEFAULT_BACKGROUND)

        # Use partner's project or default
        self.project_id = project_id or os.getenv("GCP_PROJECT_ID", "doodleminds")
        self.location = location or os.getenv("GCP_LOCATION", "us-central1")
        self.model_name = os.getenv("MODEL_NAME", "gemini-1.5-pro")

        if not VERTEXAI_AVAILABLE:
            self.error = "vertexai SDK not installed"
            self.model = None
            return

        try:
            # CASE 1: Partner provides credentials JSON
            if credentials_json:
                if isinstance(credentials_json, str):
                    creds_dict = json.loads(credentials_json)
                else:
                    creds_dict = credentials_json
                if not isinstance(creds_dict, dict) or creds_dict.get("type") != "service_account":
                    raise ValueError("credentials_json must be a service_account JSON object")

                credentials = service_account.Credentials.from_service_account_info(creds_dict)

                # Override project_id from credentials if not explicitly provided
                if not project_id and 'project_id' in creds_dict:
                    self.project_id = creds_dict['project_id']

                vertexai.init(
                    project=self.project_id,
                    location=self.location,
                    credentials=credentials
                )
                print(f"✅ Initialized with partner credentials for project: {self.project_id}")

            # CASE 2: Use environment credentials (your default)
            else:
                vertexai.init(
                    project=self.project_id,
                    location=self.location
                )
                print(f"✅ Initialized with default credentials for project: {self.project_id}")

            self.model = GenerativeModel(self.model_name)
            self.error = None

        except GoogleAuthError as e:
            self.error = f"Authentication failed: {str(e)}"
            self.model = None
        except Exception as e:
            self.error = f"Initialization error: {str(e)}"
            self.model = None

    def _style_prompt(self, prompt):
        """Apply Golpo preset defaults (colors, stroke) to a generation prompt."""
        colors = self.colors
        stroke = self.stroke
        style = (
            f"Style: hand-drawn doodle on {self.background} paper. "
            f"Ink {colors.get('ink')}, fill {colors.get('fill')}, "
            f"accent {colors.get('accent')}, shadow {colors.get('shadow')}. "
            f"Stroke width {stroke.get('width')}px, {stroke.get('caps')} caps/joins, "
            f"slight jitter ~{stroke.get('jitter_px')}px. Sequential draw-on."
        )
        return f"{prompt}\n\n{style}"

    def generate_sketch(self, prompt, apply_preset=True):
        """Generate content using initialized model."""
        if self.error or not self.model:
            return f"🔐 Credentials Error: {self.error}"

        final_prompt = self._style_prompt(prompt) if apply_preset else prompt

        try:
            response = self.model.generate_content(final_prompt)
            return response.text
        except Exception as e:
            return f"❌ Generation failed: {str(e)}"