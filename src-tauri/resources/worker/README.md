# The scan worker

The PDF pipeline: **resolve → download → Surya → chunk → EmbeddingGemma → index → search**.
It is a Python process the Rust side spawns once and talks to in JSON lines, so no heavy
work ever crosses the webview boundary.

```
python3 worker.py --root ~/lab/.openlab        # protocol mode (what the app uses)
python3 worker.py --selftest                   # offline checks: no network, no models
```

Every line in is `{"id": "...", "op": "...", "args": {…}}`; every line out carries the same
`id`. `scan_pdf` emits `progress` events before its `done`.

Ops: `health`, `scan_pdf`, `search`, `status`, `forget`, and the three the Rust hybrid
search drives — `embed` (a query vector), `bm25` (a BM25 ranking) and `hydrate` (ids to hits
with their snippets).

## The engine, installed on demand

The app does **not** ship a Python. A pinned CPython plus Surya is roughly a gigabyte, and the
pipeline already degrades without it, so it is fetched into the app's data directory the first
time a reader asks for it — Settings → **Scan engine** → *Install the scan engine*, or the
`scan_engine_install` command. `scan_engine_status` reports whether it is there and where.

What an install does, in `src-tauri/src/commands/engine.rs`:

```bash
# 1. the pinned interpreter, into <app data>/engine
curl -L -o /tmp/python.tar.gz \
  https://github.com/astral-sh/python-build-standalone/releases/download/20261009/cpython-3.12.15%2B20261009-aarch64-apple-darwin-install_only.tar.gz
tar -xzf /tmp/python.tar.gz -C "$ENGINE" --strip-components=1
# 2. the packages the worker actually imports
"$ENGINE/bin/python3" -m pip install surya-ocr pymupdf
```

`OPENLAB_ENGINE_URL` overrides the archive (a lab mirror); `OPENLAB_PYTHON` overrides the
interpreter entirely. `worker_paths` in `scan.rs` then prefers, in order: a bundled
`resources/python/` if one is present, the installed engine, a checkout's own
`resources/python/bin/python3`, and finally `python3` on the path — so a development checkout
can keep using a local environment without installing anything.

`lancedb` and `mojo` are deliberately **not** installed: the vector index is a Rust crate here
and the Mojo hot path is the compiled `openlab_scan.so`, so a Python `lancedb` was only ever
download weight. The worker reports what it found in `health`: `extract`, `hot_path`, `python`.

## Engines

Everything is optional and reported by `health`; the pipeline degrades, it does not fail.

| Part | Preferred | Fallback |
| --- | --- | --- |
| Extraction | **Surya** (`surya_ocr`) — decides text layer vs OCR itself | `pdftotext`, then PyMuPDF, then plain text files |
| Embeddings | **EmbeddingGemma 2** over `llama-server` | deterministic token-hash vectors (labelled `fallback`) |
| Vector index | **LanceDB — in Rust** (`src-tauri/src/commands/vectors.rs`) | JSONL vectors + cosine, in the worker's own search |
| BM25 / hot paths | **Mojo** (`openlab_scan.so`) | the Python twin in `scanlib` |

Text chunks and vectors live in `index/chunks.jsonl` and `index/vectors.jsonl` — greppable,
portable, and what BM25 and snippets read. The Rust side rebuilds the LanceDB table from
those files after every scan; the Python store stays deliberately dumb so there is one index
and one writer. A hybrid query is two rankings fused with RRF: BM25 from the worker, vectors
from LanceDB in Rust, then the worker hydrates the fused ids into hits.

### EmbeddingGemma 2

The model needs a llama.cpp build containing
[EmbeddingGemma 2 support](https://github.com/ggml-org/llama.cpp/pull/30054) — release
binaries may not have it yet:

```bash
git clone --depth 1 https://github.com/ggml-org/llama.cpp.git
cmake -S llama.cpp -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release
cmake --build llama.cpp/build -j 8 --target llama-server

llama-server \
  --model embeddinggemma-2-UD-Q4_K_XL.gguf \
  --alias embeddinggemma2 \
  --embeddings --pooling mean \
  --ctx-size 2048 --batch-size 2048 --ubatch-size 2048 --parallel 1 \
  --host 127.0.0.1 --port 8901
```

The app starts this server itself: `resources/bin/llama-server` (binary plus its dylibs,
with `@loader_path` on the rpath) and `models/embeddinggemma*.gguf` in the app data
directory. `OPENLAB_EMBED_MODEL_PATH` overrides the model, `OPENLAB_EMBED_URL` points at a
server you run yourself, and a machine with neither gets the fallback embedder.

Copy the dylibs with their symlinks intact. `libX.0.dylib` and `libX.dylib` are symlinks to
`libX.0.<patch>.dylib`, and the load commands name only the `.0` form; copying them as files
triples the directory (56 MB instead of 23 MB) and the copies drift out of sync. `cp -a` or
`rsync -a` preserves them, `cp` alone does not.

### Relinking a rebuilt binary

A Homebrew build of `llama-server` links OpenSSL by absolute path
(`/opt/homebrew/opt/openssl@4/lib/libssl.4.dylib`, and in `libssl` itself the Cellar path to
`libcrypto`), and every dylib carries the builder's
`/Users/<you>/.cache/llama-build/bin` rpath. Neither exists on another machine, so the shipped
binary would not load there. The fix is to vendor the two OpenSSL libraries beside the others
and point everything at `@loader_path` — all the files sit in one directory, so one rpath
covers them. Re-run this after any rebuild:

```bash
cd src-tauri/resources/bin
cp -L /opt/homebrew/opt/openssl@4/lib/lib{ssl,crypto}.4.dylib .
chmod u+w libssl.4.dylib libcrypto.4.dylib llama-server libllama-*.dylib

for f in llama-server libllama-server-impl.dylib libllama-common.0.6.0.dylib; do
  install_name_tool \
    -change /opt/homebrew/opt/openssl@4/lib/libssl.4.dylib @loader_path/libssl.4.dylib \
    -change /opt/homebrew/opt/openssl@4/lib/libcrypto.4.dylib @loader_path/libcrypto.4.dylib "$f"
  install_name_tool -delete_rpath /Users/$USER/.cache/llama-build/bin "$f"
  install_name_tool -add_rpath @loader_path "$f"
done
install_name_tool -id @rpath/libssl.4.dylib \
  -change /opt/homebrew/Cellar/openssl@4/4.0.3/lib/libcrypto.4.dylib @loader_path/libcrypto.4.dylib libssl.4.dylib
install_name_tool -id @rpath/libcrypto.4.dylib libcrypto.4.dylib

# every remaining dylib: drop the builder rpath, add @loader_path, and re-sign
for f in $(ls *.dylib); do
  install_name_tool -delete_rpath /Users/$USER/.cache/llama-build/bin "$f" 2>/dev/null || true
  install_name_tool -add_rpath @loader_path "$f" 2>/dev/null || true
done
codesign --force --sign - libssl.4.dylib libcrypto.4.dylib llama-server *.dylib
```

Editing a Mach-O invalidates its signature on Apple silicon; the `codesign --force --sign -`
is what makes dyld load it again. Check the result by copying the whole directory somewhere
else and running the copy — if it starts, nothing depends on this machine:

```bash
rm -rf /tmp/reloc && cp -a resources/bin /tmp/reloc && /tmp/reloc/llama-server --version
```

The Mojo hot path has the same problem for the same reason, documented under **Mojo** below.

Queries and documents **must** carry different task prefixes; the worker adds them
(`task: search result | query: …` and `title: none | text: …`). Vectors are 768-dim and
already normalized; do not run the model in FP16.

### Surya

```bash
pip install surya-ocr          # CPU / Apple Silicon also needs `brew install llama.cpp`
```

The worker calls `surya_ocr <pdf> --output_dir <tmp>` and reads its `results.json`
(layout, reading order, tables, maths). Surya decides on its own whether a page needs OCR.

### Mojo

```bash
cd ../mojo && ./build.sh       # runs the checks, then builds openlab_scan.so
```

`build.sh` compiles `openlab_scan_py.mojo` into a Python extension
(`mojo build --emit shared-lib`); the worker imports it as `openlab_scan` when it is on the
path. `health` says `hot_path: mojo` or `python`.

The compiled `.so` carries two things that only work on the build machine: an rpath pointing
at the absolute path of the modular package in the checkout, and a dependency on that
package's `libKGENCompilerRTShared.dylib`. So `resources/mojo/` vendors the three runtime
libraries it actually needs (1.5 MB; the REPL and LLDB libraries beside them are not among
them) and rewrites the `.so` to `@loader_path`. Re-run this after any rebuild:

```bash
cd src-tauri/resources/mojo
MOD=../python/lib/python3.12/site-packages/modular/lib
cp -L "$MOD"/lib{KGENCompilerRTShared,MSupportGlobals,AsyncRTRuntimeGlobals}.dylib .
chmod u+w openlab_scan.so libKGENCompilerRTShared.dylib libMSupportGlobals.dylib libAsyncRTRuntimeGlobals.dylib
install_name_tool -delete_rpath "$(cd "$MOD" && pwd)" openlab_scan.so
install_name_tool -add_rpath @loader_path openlab_scan.so
for l in libKGENCompilerRTShared libMSupportGlobals libAsyncRTRuntimeGlobals; do
  install_name_tool -id "@rpath/$l.dylib" "$l.dylib"
done
codesign --force --sign - openlab_scan.so libKGENCompilerRTShared.dylib libMSupportGlobals.dylib libAsyncRTRuntimeGlobals.dylib
```

Verify it loads from the vendored copies rather than the toolchain:

```bash
DYLD_PRINT_LIBRARIES=1 ../python/bin/python3 -c "
import sys; sys.path.insert(0, 'src-tauri/resources/mojo'); import openlab_scan"
```

## Environment

| Variable | Meaning |
| --- | --- |
| `OPENLAB_INDEX_ROOT` | where the index lives when no `--root` is passed |
| `OPENLAB_EMBED_URL` | the embedding server (default `http://127.0.0.1:8901`) |
| `OPENLAB_EMBED_MODEL` | the model alias the server serves (default `embeddinggemma`) |
| `OPENLAB_PYTHON` | the interpreter Rust should spawn (default: the bundled one, then `python3`) |

## Index layout

```
<root>/
  pdf/             downloaded PDFs, one per document id
  text/            (reserved)
  index/
    documents.jsonl
    chunks.jsonl   the corpus, read by BM25
    vectors.jsonl  the vectors, read by Rust's LanceDB sync
    lance/         the LanceDB tables
```

## Checks

`bun run verify:scan` runs `--selftest` and then drives the protocol end to end (health,
scan of a fixture, search, progress, unknown op). The worker's own checks are in
`selftest()`; the Mojo twin has its own in `../mojo/test_openlab_scan.mojo`, and the Rust
vector index has `cargo test vectors::`.
