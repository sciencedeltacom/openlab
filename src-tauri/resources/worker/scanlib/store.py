"""The chunk store.

Texts and vectors live in JSONL files in the index directory — greppable, portable, and the
source of truth for BM25 and for snippets. The vector index itself is LanceDB, owned by the
Rust side (`src-tauri/src/commands/vectors.rs`), which reads these files; the Python store
stays deliberately dumb so there is one index and one writer.

Everything here **streams**. A corpus is unbounded and the worker is a long-lived process, so
nothing reads a whole file into a list unless the caller actually needs the whole file: a
scoped query filters while it reads, and a vector search keeps only the best few candidates.
"""

from __future__ import annotations

import heapq
import json
from pathlib import Path
from typing import Iterator


def _iter(path: Path) -> Iterator[dict]:
    """Yield each JSON object in a JSONL file, skipping a blank or broken line."""
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _read(path: Path) -> list[dict]:
    return list(_iter(path))


def _append(path: Path, rows: list[dict]) -> None:
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _doc_of(chunk_id: str) -> str:
    """The document a `docId:position` chunk id belongs to."""
    return chunk_id.rsplit(":", 1)[0]


class Store:
    def __init__(self, config):
        self.config = config
        self.config.ensure()
        self.chunks_file = config.index_dir / "chunks.jsonl"
        self.vectors_file = config.index_dir / "vectors.jsonl"

    # ---------------------------------------------------------------- documents

    def documents(self) -> list[dict]:
        return _read(self.config.documents_file)

    def iter_documents(self) -> Iterator[dict]:
        return _iter(self.config.documents_file)

    def find_document(self, doc_id: str) -> dict | None:
        for document in _iter(self.config.documents_file):
            if document.get("id") == doc_id:
                return document
        return None

    def upsert_document(self, document: dict) -> None:
        rows = [row for row in _iter(self.config.documents_file) if row.get("id") != document.get("id")]
        rows.append(document)
        self.config.documents_file.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8"
        )

    # ------------------------------------------------------------------- chunks

    def add_chunks(self, doc_id: str, chunks: list[dict], vectors: list[list[float]] | None) -> None:
        rows = [{**chunk, "docId": doc_id} for chunk in chunks]
        _append(self.chunks_file, rows)
        if vectors is not None:
            vector_rows = [{"id": f"{doc_id}:{index}", "vector": vector} for index, vector in enumerate(vectors)]
            _append(self.vectors_file, vector_rows)

    def iter_chunks(self, doc_ids: list[str] | None = None) -> Iterator[dict]:
        """Every chunk, or only those of the named documents, filtered as it reads."""
        wanted = set(doc_ids) if doc_ids else None
        for row in _iter(self.chunks_file):
            if wanted is None or row.get("docId") in wanted:
                yield row

    def chunks(self, doc_ids: list[str] | None = None) -> list[dict]:
        return list(self.iter_chunks(doc_ids))

    def chunks_by_id(self, ids: list[str]) -> dict[str, dict]:
        """Only the chunks the caller asked for, keyed by chunk id."""
        wanted = set(ids)
        found: dict[str, dict] = {}
        for row in _iter(self.chunks_file):
            chunk_id = f"{row.get('docId')}:{row.get('position', 0)}"
            if chunk_id in wanted:
                found[chunk_id] = row
                if len(found) == len(wanted):
                    break
        return found

    def vectors(self) -> dict[str, list[float]]:
        return {row["id"]: row["vector"] for row in _iter(self.vectors_file)}

    def vector_search(self, query_vector: list[float], limit: int, doc_ids: list[str] | None = None) -> list[str]:
        """Chunk ids by cosine similarity, best first — keeping only the best `limit`.

        The whole vectors file is a hundred megabytes at scale, so this streams it and holds a
        bounded heap of candidates rather than a map of every vector.
        """
        from .embed import cosine

        wanted = set(doc_ids) if doc_ids else None
        best: list[tuple[float, str]] = []
        for row in _iter(self.vectors_file):
            chunk_id = row.get("id", "")
            if wanted is not None and _doc_of(chunk_id) not in wanted:
                continue
            score = cosine(query_vector, row.get("vector") or [])
            if score <= 0:
                continue
            if len(best) < limit:
                heapq.heappush(best, (score, chunk_id))
            elif score > best[0][0]:
                heapq.heapreplace(best, (score, chunk_id))
        return [chunk_id for _, chunk_id in sorted(best, reverse=True)]

    def remove_document(self, doc_id: str) -> None:
        for path in (self.chunks_file, self.vectors_file):
            rows = [
                row
                for row in _iter(path)
                if row.get("docId") != doc_id and not row.get("id", "").startswith(f"{doc_id}:")
            ]
            if rows:
                path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
            elif path.exists():
                path.unlink()
