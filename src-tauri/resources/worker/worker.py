#!/usr/bin/env python3
"""The scan worker.

A long-lived process the Tauri backend spawns: one JSON object per line in, one per
line out. It owns the whole PDF pipeline — resolve, download, Surya, chunk, embed,
index, search — so the heavy work never crosses the webview boundary.

    python3 worker.py --root ~/lab/.openlab            # protocol mode
    python3 worker.py --selftest                       # offline checks, no models

Ops: `health`, `scan_pdf`, `search`, `status`, `forget`. Every reply carries the
request's `id`; `scan_pdf` also emits `progress` events before its `done`.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# The compiled Mojo hot path, when `../mojo/build.sh` has produced it.
_MOJO_DIR = Path(__file__).resolve().parent.parent / "mojo"
if _MOJO_DIR.exists():
    sys.path.insert(0, str(_MOJO_DIR))

from scanlib import pipeline  # noqa: E402
from scanlib.config import Config  # noqa: E402

SAMPLE = """# Chromatin accessibility and off-target prediction

Chromatin accessibility improves off-target prediction over sequence alone in
most published benchmarks. The gain is largest when the accessibility measurement
comes from the same cell type as the edit.

## Methods

We compared ATAC-seq and DNase-seq as features for a sequence model. The frozen
holdout was evaluated once per configuration, and the noise floor was estimated
from three seeds.

## Results

ATAC-seq matched DNase-seq AUROC at a lower sequencing depth. Single-cell ATAC
was the most expensive option and did not improve ranking on the holdout.
"""


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle(config: Config, message: dict) -> None:
    request_id = message.get("id")
    op = message.get("op")
    args = message.get("args") or {}

    def progress(phase: str, pct: int, **extra) -> None:
        emit({"id": request_id, "event": "progress", "phase": phase, "pct": pct, **extra})

    try:
        if op == "health":
            emit({"id": request_id, "event": "done", "result": config.health()})
        elif op == "scan_pdf":
            emit({"id": request_id, "event": "done", "result": pipeline.scan_pdf(config, args, progress)})
        elif op == "search":
            emit(
                {
                    "id": request_id,
                    "event": "done",
                    "result": pipeline.search(
                        config,
                        str(args.get("query") or ""),
                        args.get("docIds"),
                        int(args.get("limit") or 10),
                    ),
                }
            )
        elif op == "status":
            emit({"id": request_id, "event": "done", "result": pipeline.status(config, args.get("docIds"))})
        elif op == "forget":
            emit({"id": request_id, "event": "done", "result": pipeline.forget(config, args)})
        elif op == "embed":
            emit(
                {
                    "id": request_id,
                    "event": "done",
                    "result": pipeline.embed_query(config, str(args.get("text") or "")),
                }
            )
        elif op == "bm25":
            emit(
                {
                    "id": request_id,
                    "event": "done",
                    "result": pipeline.bm25_ranking(
                        config, str(args.get("query") or ""), args.get("docIds"), int(args.get("limit") or 40)
                    ),
                }
            )
        elif op == "hydrate":
            emit(
                {
                    "id": request_id,
                    "event": "done",
                    "result": pipeline.hydrate(
                        config, str(args.get("query") or ""), [str(i) for i in (args.get("ids") or [])]
                    ),
                }
            )
        else:
            emit({"id": request_id, "event": "error", "error": f"unknown op `{op}`"})
    except Exception as error:  # a bad record must not take the worker down
        emit(
            {
                "id": request_id,
                "event": "error",
                "error": str(error),
                "trace": traceback.format_exc()[-1500:],
            }
        )


def bench(rows: int) -> int:
    """A synthetic corpus, timed and measured: how the store scales as the index grows.

    The corpus is written straight to the JSONL files (no embedding, no models), then the
    three hot ops are timed and the process's peak resident set is reported. It is what the
    architecture benchmark compares before and after a change.
    """
    import random
    import resource
    import time as clock

    from scanlib.store import Store

    words = (
        "chromatin accessibility off-target prediction sequence model holdout atac dnase "
        "assay genome crispr benchmark guide rna protein structure variant"
    ).split()
    with tempfile.TemporaryDirectory(prefix="openlab-bench-") as folder:
        config = Config(root=folder, embed_url="http://127.0.0.1:1")
        config.ensure()
        store = Store(config)

        with store.chunks_file.open("w", encoding="utf-8") as chunks_file, store.vectors_file.open(
            "w", encoding="utf-8"
        ) as vectors_file:
            for index in range(rows):
                doc = f"doc-{index // 20}"
                slot = index % 20
                randomizer = random.Random(index)
                text = " ".join(randomizer.choice(words) for _ in range(60))
                chunks_file.write(json.dumps({"docId": doc, "position": slot, "page": 1, "text": text}) + "\n")
                vector = [0.0] * 768
                vector[0] = 1.0
                vectors_file.write(json.dumps({"id": f"{doc}:{slot}", "vector": vector}) + "\n")

        timings: dict[str, float] = {}
        started = clock.perf_counter()
        ranking = pipeline.bm25_ranking(config, "chromatin accessibility", None, 40)
        timings["bm25_ms"] = round((clock.perf_counter() - started) * 1000, 2)

        started = clock.perf_counter()
        hits = pipeline.hydrate(config, "chromatin", ranking["ids"][:10])
        timings["hydrate_ms"] = round((clock.perf_counter() - started) * 1000, 2)

        started = clock.perf_counter()
        result = pipeline.search(config, "chromatin accessibility", None, 10)
        timings["search_ms"] = round((clock.perf_counter() - started) * 1000, 2)

        query_vector = [0.0] * 768
        query_vector[0] = 1.0
        started = clock.perf_counter()
        nearest = store.vector_search(query_vector, 10)
        timings["vector_ms"] = round((clock.perf_counter() - started) * 1000, 2)

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        payload = {
            "rows": rows,
            "timings": timings,
            "peak_rss_mb": round(peak / (1024 * 1024), 1),
            "hits": len(hits),
            "searched": result.get("searched"),
            "nearest": len(nearest),
        }
        print(json.dumps(payload, ensure_ascii=False))
    return 0


def selftest() -> int:
    """Offline checks: no network, no models, no Surya. Prints JSON, exits non-zero on failure."""
    from scanlib.bm25 import BM25, rrf
    from scanlib.chunk import chunk_text, clean_html

    checks: list[tuple[str, bool, object]] = []
    with tempfile.TemporaryDirectory(prefix="openlab-selftest-") as folder:
        # Port 1 is never a model server: the fallback embedder is what runs here.
        config = Config(root=folder, embed_url="http://127.0.0.1:1")
        fixture = Path(folder) / "fixture.md"
        fixture.write_text(SAMPLE, encoding="utf-8")

        document = pipeline.scan_pdf(config, {"path": str(fixture), "docId": "fixture"}, lambda *a, **k: None)
        checks.append(("a text document is indexed", document.get("status") == "indexed", document.get("status")))
        checks.append(("and produces chunks", int(document.get("chunks") or 0) > 0, document.get("chunks")))

        result = pipeline.search(config, "chromatin accessibility", None, 5)
        checks.append(("search finds the fixture", len(result.get("hits") or []) > 0, result.get("mode")))
        top = (result.get("hits") or [{}])[0]
        checks.append(("the hit carries its page", top.get("page") == 1, top.get("page")))
        checks.append(
            ("the snippet carries the term", "chromatin" in str(top.get("snippet") or "").lower(), str(top.get("snippet"))[:70])
        )

        cached = pipeline.scan_pdf(config, {"path": str(fixture), "docId": "fixture"}, lambda *a, **k: None)
        checks.append(("a second scan is served from the index", bool(cached.get("cached")), cached.get("cached")))

        status = pipeline.status(config, ["fixture"])
        checks.append(("status lists the document", len(status) == 1 and status[0]["id"] == "fixture", len(status)))

        scoped = pipeline.search(config, "chromatin", ["someone-else"], 5)
        checks.append(("a doc filter excludes other documents", scoped.get("hits") == [], scoped.get("hits")))

        health = config.health()
        checks.append(("health names every engine", all(health.get(key) for key in ("embed", "extract", "store", "hot_path")), health))

    bm25 = BM25()
    bm25.add("a", "chromatin accessibility improves off-target prediction")
    bm25.add("b", "unrelated text about battery economics")
    scores = bm25.scores("chromatin")
    checks.append(("bm25 ranks the matching chunk first", max(scores, key=scores.get) == "a", scores))

    fused = rrf([["x", "y"], ["y", "x"]])
    checks.append(("rrf fuses two rankings", abs(fused["x"] - fused["y"]) < 1e-9, fused))

    checks.append(("html is stripped", clean_html("<p>Hello <b>world</b></p>") == "Hello world", clean_html("<p>Hello <b>world</b></p>")))
    checks.append(("a long paragraph is windowed", len(chunk_text("A" * 2500)) >= 2, len(chunk_text("A" * 2500))))

    payload = {
        "ok": all(ok for _, ok, _ in checks),
        "checks": [{"label": label, "ok": bool(ok), "detail": detail} for label, ok, detail in checks],
        "health": Config().health(),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["ok"] else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="openlab scan worker")
    parser.add_argument("--root", help="index directory (defaults to OPENLAB_INDEX_ROOT)")
    parser.add_argument("--embed-url", help="llama.cpp embedding server")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--bench", type=int, metavar="ROWS", help="time the store over a synthetic corpus")
    options = parser.parse_args()

    if options.selftest:
        return selftest()

    if options.bench:
        return bench(options.bench)

    config = Config(options.root, options.embed_url)
    config.ensure()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            emit({"event": "error", "error": "the line was not JSON"})
            continue
        handle(config, message)
    return 0


if __name__ == "__main__":
    sys.exit(main())
