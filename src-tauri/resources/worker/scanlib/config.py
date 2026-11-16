"""Where the index lives and which engines are attached."""

from __future__ import annotations

import importlib
import os
import shutil
import socket
import subprocess
import urllib.error
import urllib.request
from pathlib import Path


def module_available(name: str) -> bool:
    """True when an optional Python package can be imported."""
    try:
        importlib.import_module(name)
        return True
    except Exception:
        return False


def command_available(name: str) -> bool:
    """True when the command is on the path or sits beside this interpreter.

    The bundled environment keeps its console scripts in the same `bin/` as the Python
    itself, which is not on PATH, so `surya_ocr` has to be looked for there too.
    """
    if shutil.which(name) is not None:
        return True
    import sys

    return (Path(sys.executable).resolve().parent / name).exists()


class Config:
    """Paths and endpoints, resolved once per worker."""

    def __init__(self, root: str | None = None, embed_url: str | None = None):
        self.root = Path(root or os.environ.get("OPENLAB_INDEX_ROOT") or Path.home() / ".openlab-index").expanduser()
        self.pdf_dir = self.root / "pdf"
        self.text_dir = self.root / "text"
        self.index_dir = self.root / "index"
        self.documents_file = self.index_dir / "documents.jsonl"
        self.embed_url = (embed_url or os.environ.get("OPENLAB_EMBED_URL") or "http://127.0.0.1:8901").rstrip("/")
        self.embed_model = os.environ.get("OPENLAB_EMBED_MODEL") or "embeddinggemma"

    def ensure(self) -> None:
        for folder in (self.pdf_dir, self.text_dir, self.index_dir):
            folder.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ engines

    def embedder(self) -> str:
        """Which embedder is in play: the model server, or the degraded fallback."""
        return "llama.cpp" if self._embed_server_up() else "fallback"

    def _embed_server_up(self) -> bool:
        try:
            with urllib.request.urlopen(f"{self.embed_url}/health", timeout=1.0):
                return True
        except Exception:
            pass
        try:
            # llama-server exposes /v1/models when it is up.
            with urllib.request.urlopen(f"{self.embed_url}/v1/models", timeout=1.0):
                return True
        except Exception:
            return False

    def extractor(self) -> str:
        if command_available("surya_ocr"):
            return "surya"
        if command_available("pdftotext"):
            return "pdftotext"
        if module_available("fitz"):
            return "pymupdf"
        return "text-only"

    def store(self) -> str:
        # The corpus is JSONL; the vector index is LanceDB, owned by the Rust side.
        return "jsonl"

    def mojo(self) -> str:
        try:
            import openlab_scan  # type: ignore  # the compiled Mojo module

            return "mojo"
        except Exception:
            return "python"

    def health(self) -> dict:
        return {
            "root": str(self.root),
            "embed": self.embedder(),
            "embed_url": self.embed_url,
            "extract": self.extractor(),
            "store": self.store(),
            "hot_path": self.mojo(),
            "surya": command_available("surya_ocr"),
            "llama_server": command_available("llama-server"),
            "python": ".".join(str(part) for part in _python_version()),
        }


def _python_version() -> tuple:
    import sys

    return sys.version_info[:3]


def free_port() -> int:
    """An ephemeral port, for a model server the worker spawns itself."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run(command: list[str], timeout: int = 3600) -> subprocess.CompletedProcess:
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
