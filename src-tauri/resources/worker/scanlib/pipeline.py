"""The worker's own checks, the query embedding, BM25 ranking and hit hydration.

The Rust side owns the LanceDB vector index; these three ops are what it needs from the
worker to run a hybrid search: embed the query, rank by BM25, and turn a list of chunk ids
back into hits with their snippets.
"""

from __future__ import annotations

import hashlib
import re
import time
from pathlib import Path

from .bm25 import BM25, rrf, snippet
from .chunk import chunk_pages
from .embed import embed_texts
from .extract import extract_pdf
from .resolve import NoPdfFound, download, resolve_pdf_url
from .store import Store


def _doc_id(args: dict) -> str:
    if args.get("docId"):
        return str(args["docId"])
    if args.get("recordId"):
        return str(args["recordId"])
    if args.get("doi"):
        return "doi-" + re.sub(r"[^A-Za-z0-9]+", "-", str(args["doi"])).strip("-").lower()
    return "doc-" + hashlib.sha1(str(args.get("url") or time.time()).encode("utf-8")).hexdigest()[:12]


def scan_pdf(config, args: dict, progress) -> dict:
    """Index one record's PDF. Returns the document row."""
    store = Store(config)
    doc_id = _doc_id(args)
    existing = store.find_document(doc_id)
    if existing and existing.get("status") == "indexed" and not args.get("force"):
        return {**existing, "cached": True}

    progress("resolve", 5)
    # A local file is scanned where it lies: the workspace's own PDFs and text files need no
    # lookup and no download.
    local = args.get("path")
    if local:
        path = Path(str(local))
        if not path.exists():
            raise FileNotFoundError(f"no file at {path}")
        url, sha, size = None, None, path.stat().st_size
    else:
        url = args.get("url") if str(args.get("url") or "").lower().endswith(".pdf") else None
        if url is None:
            try:
                url = resolve_pdf_url(config, doi=args.get("doi"), record_id=args.get("recordId"), url=args.get("url"))
            except NoPdfFound as error:
                document = {
                    "id": doc_id,
                    "doi": args.get("doi"),
                    "recordId": args.get("recordId"),
                    "status": "paywalled",
                    "error": str(error),
                    "updatedAt": int(time.time() * 1000),
                }
                store.upsert_document(document)
                raise

        progress("download", 15)
        path, sha, size = download(config, url, doc_id)

    progress("extract", 35)
    pages = extract_pdf(config, path)

    progress("chunk", 55)
    chunks = chunk_pages(pages)

    progress("embed", 70)
    vectors, engine = embed_texts(config, [chunk["text"] for chunk in chunks])

    progress("index", 90)
    store.add_chunks(doc_id, chunks, vectors)

    document = {
        "id": doc_id,
        "doi": args.get("doi"),
        "recordId": args.get("recordId"),
        "title": args.get("title"),
        "pdfPath": str(path),
        "url": url,
        "sha256": sha,
        "bytes": size,
        "pages": len(pages),
        "chunks": len(chunks),
        "embed": engine,
        "status": "indexed",
        "indexedAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
    }
    store.upsert_document(document)
    progress("indexed", 100)
    return document


def search(config, query: str, doc_ids: list[str] | None = None, limit: int = 10) -> dict:
    """Hybrid search: BM25 and (when the model is up) vectors, fused by RRF."""
    store = Store(config)
    rows = store.chunks(doc_ids)
    if not rows or not query.strip():
        return {"hits": [], "mode": "empty"}

    by_id: dict[str, dict] = {}
    bm25 = BM25()
    for row in rows:
        chunk_id = f"{row.get('docId')}:{row.get('position', 0)}"
        by_id[chunk_id] = row
        bm25.add(chunk_id, row.get("text", ""))

    scores = bm25.scores(query)
    rankings = [[chunk_id for chunk_id, _ in sorted(scores.items(), key=lambda pair: pair[1], reverse=True)]]
    mode = "bm25"

    if config.embedder() == "llama.cpp":
        query_vector, _ = embed_texts(config, [query], "query")
        rankings.append(store.vector_search(query_vector[0], max(limit * 4, 20), doc_ids))
        mode = "hybrid"

    fused = rrf(rankings)
    ordered = sorted(fused.items(), key=lambda pair: pair[1], reverse=True)[:limit]
    documents = {document["id"]: document for document in store.iter_documents()}
    hits = []
    for chunk_id, score in ordered:
        row = by_id.get(chunk_id)
        if row is None:
            continue
        document = documents.get(row.get("docId"), {})
        hits.append(
            {
                "chunkId": chunk_id,
                "docId": row.get("docId"),
                "doi": document.get("doi"),
                "title": document.get("title"),
                "page": row.get("page"),
                "label": row.get("label"),
                "score": round(score, 6),
                "snippet": snippet(row.get("text", ""), query),
            }
        )
    return {"hits": hits, "mode": mode, "searched": len(rows)}


def status(config, doc_ids: list[str] | None = None) -> list[dict]:
    documents = Store(config).documents()
    if doc_ids:
        wanted = set(doc_ids)
        documents = [document for document in documents if document.get("id") in wanted]
    return documents


def forget(config, args: dict) -> dict:
    doc_id = _doc_id(args)
    Store(config).remove_document(doc_id)
    return {"removed": doc_id}


def embed_query(config, text: str) -> dict:
    """The query's vector, and which engine produced it."""
    vectors, engine = embed_texts(config, [text], "query")
    return {"vector": vectors[0], "engine": engine}


def bm25_ranking(config, query: str, doc_ids: list[str] | None = None, limit: int = 40) -> dict:
    """The BM25 ranking over the corpus, best first."""
    rows = Store(config).chunks(doc_ids)
    if not rows or not query.strip():
        return {"ids": []}
    bm25 = BM25()
    for row in rows:
        bm25.add(f"{row.get('docId')}:{row.get('position', 0)}", row.get("text", ""))
    scores = bm25.scores(query)
    ordered = [chunk_id for chunk_id, _ in sorted(scores.items(), key=lambda pair: pair[1], reverse=True)]
    return {"ids": ordered[:limit]}


def hydrate(config, query: str, ids: list[str]) -> dict:
    """Chunk ids to hits: text, page and the snippet the query matched.

    Only the requested chunks are read, so a hydration of ten hits does not parse the whole
    corpus.
    """
    store = Store(config)
    documents = {document["id"]: document for document in store.iter_documents()}
    rows = store.chunks_by_id(ids)
    hits = []
    for position, chunk_id in enumerate(ids):
        row = rows.get(chunk_id)
        if row is None:
            continue
        document = documents.get(row.get("docId"), {})
        hits.append(
            {
                "chunkId": chunk_id,
                "docId": row.get("docId"),
                "doi": document.get("doi"),
                "title": document.get("title"),
                "page": row.get("page"),
                "label": row.get("label"),
                "rank": position,
                "snippet": snippet(row.get("text", ""), query),
            }
        )
    return {"hits": hits}
