"""Portable backend build for ÜberDoodle. Run from repo root after creating .venv-build."""
import subprocess
from pathlib import Path
repo = Path(__file__).resolve().parents[1]
python = repo / ".venv-build" / "Scripts" / "python.exe"
if not python.exists():
    python = Path("python")
assets = ["GOLPO_PRESET.md", "requirements.txt"]
args = [str(python), "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile",
        "--noconsole", "--name", "uberdoodle-backend",
        "--distpath", str(repo / "build" / "backend"),
        "--workpath", str(repo / "build" / "pyinstaller"),
        "--specpath", str(repo / "build")]
for f in assets:
    p = repo / f
    if p.exists():
        args += ["--add-data", str(p) + ";."]
args += [str(repo / "main.py")]
raise SystemExit(subprocess.call(args, cwd=repo))
