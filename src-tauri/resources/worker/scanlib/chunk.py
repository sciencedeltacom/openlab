"""Cleaning and chunking — the Mojo hot path, with its Python twin.

The compiled Mojo module (`openlab_scan`) exports the same three functions; when it
is on the path this module calls it, otherwise the identical Python implementation
runs. Keeping one contract and two engines means the pipeline is testable on a
machine with no Mojo, and gets faster on one with it.
"""

from __future__ import annotations

import html as html_lib
import re

TARGET_CHARS = 900
OVERLAP_CHARS = 150
MIN_CHUNK_CHARS = 40

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"[ \t\r\f\v]+")
_BLANK = re.compile(r"\n{3,}")


def _mojo():
    try:
        import openlab_scan  # type: ignore

        return openlab_scan
    except Exception:
        return None


def clean_html(text: str) -> str:
    """HTML (Surya emits it for tables and maths) to readable plain text."""
    if not text:
        return ""
    mojo = _mojo()
    if mojo is not None:
        try:
            return mojo.clean_html(text)
        except Exception:
            pass
    stripped = _TAG.sub(" ", text)
    unescaped = html_lib.unescape(stripped)
    lines = [_SPACE.sub(" ", line).strip() for line in unescaped.split("\n")]
    return _BLANK.sub("\n\n", "\n".join(line for line in lines)).strip()


def chunk_text(text: str, target: int = TARGET_CHARS, overlap: int = OVERLAP_CHARS) -> list[str]:
    """Split prose into overlapping windows, preferring paragraph breaks."""
    mojo = _mojo()
    if mojo is not None:
        try:
            return list(mojo.chunk_text(text, target, overlap))
        except Exception:
            pass
    if not text:
        return []
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if current and len(current) + len(paragraph) + 2 > target:
            chunks.append(current)
            tail = current[-overlap:] if overlap > 0 else ""
            current = (tail + "\n\n" + paragraph).strip() if tail else paragraph
        else:
            current = f"{current}\n\n{paragraph}".strip() if current else paragraph
    if current:
        chunks.append(current)
    # A single very long paragraph still has to fit the window.
    sized: list[str] = []
    for chunk in chunks:
        if len(chunk) <= target * 2:
            sized.append(chunk)
            continue
        start = 0
        while start < len(chunk):
            sized.append(chunk[start : start + target])
            start += max(1, target - overlap)
    return [chunk for chunk in sized if len(chunk) >= MIN_CHUNK_CHARS]


def chunk_pages(pages: list[dict]) -> list[dict]:
    """Pages of blocks to indexed chunks, keeping page and label for citations."""
    chunks: list[dict] = []
    for page in pages:
        blocks = sorted(page.get("blocks", []), key=lambda block: block.get("reading_order", 0))
        for block in blocks:
            text = block.get("text") or clean_html(block.get("html") or "")
            text = text.strip()
            if not text:
                continue
            for piece in chunk_text(text):
                chunks.append(
                    {
                        "page": page.get("page", 0),
                        "label": block.get("label") or "Text",
                        "order": block.get("reading_order", 0),
                        "text": piece,
                    }
                )
    for index, chunk in enumerate(chunks):
        chunk["position"] = index
    return chunks
