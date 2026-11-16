"""PDF to pages of blocks: Surya first, honest fallbacks after.

Surya decides on its own whether a page has a text layer or needs OCR — the worker
does not second-guess it. When Surya is not installed, pdftotext and PyMuPDF keep
the pipeline usable for born-digital PDFs, and a plain text file is a one-page
document so the whole chain can be tested without any of them.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from .chunk import clean_html


def extract_pdf(config, path: Path) -> list[dict]:
    suffix = path.suffix.lower()
    if suffix in (".txt", ".md", ".markdown"):
        return [{"page": 1, "blocks": [{"text": path.read_text(encoding="utf-8", errors="replace"), "label": "Text", "reading_order": 0}]}]

    extractor = config.extractor()
    if extractor == "surya":
        try:
            return _via_surya(path)
        except Exception:
            pass
    if shutil.which("pdftotext"):
        try:
            return _via_pdftotext(path)
        except Exception:
            pass
    try:
        return _via_pymupdf(path)
    except Exception as error:
        raise RuntimeError(f"no PDF extractor could read {path.name}: {error}") from error


def _via_surya(path: Path) -> list[dict]:
    with tempfile.TemporaryDirectory(prefix="openlab-surya-") as folder:
        result = subprocess.run(
            ["surya_ocr", str(path), "--output_dir", folder],
            capture_output=True,
            text=True,
            timeout=7200,
            check=False,
        )
        reports = list(Path(folder).rglob("results.json"))
        if not reports:
            raise RuntimeError(result.stderr.strip() or "surya_ocr produced no results.json")
        data = json.loads(reports[0].read_text(encoding="utf-8"))
    # The report is keyed by input name; take the first document's pages.
    pages = next(iter(data.values())) if isinstance(data, dict) else data
    return [_surya_page(page, index) for index, page in enumerate(pages)]


def _surya_page(page: dict, index: int) -> dict:
    blocks = page.get("blocks")
    if blocks is None:
        # Surya v1 shape: flat text lines.
        blocks = [
            {"text": line.get("text", ""), "label": "Text", "reading_order": position}
            for position, line in enumerate(page.get("text_lines", []))
        ]
    return {
        "page": page.get("page", index) + 1 if isinstance(page.get("page"), int) else index + 1,
        "blocks": [
            {
                "text": clean_html(block.get("html") or block.get("text") or ""),
                "label": block.get("label") or "Text",
                "reading_order": block.get("reading_order", position),
            }
            for position, block in enumerate(blocks)
        ],
    }


def _via_pdftotext(path: Path) -> list[dict]:
    result = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True, timeout=600, check=True)
    return [
        {"page": index + 1, "blocks": [{"text": page, "label": "Text", "reading_order": 0}]}
        for index, page in enumerate(result.stdout.split("\f"))
        if page.strip()
    ]


def _via_pymupdf(path: Path) -> list[dict]:
    import fitz  # type: ignore

    pages: list[dict] = []
    with fitz.open(path) as document:
        for index, page in enumerate(document):
            pages.append(
                {"page": index + 1, "blocks": [{"text": page.get_text(), "label": "Text", "reading_order": 0}]}
            )
    return pages
