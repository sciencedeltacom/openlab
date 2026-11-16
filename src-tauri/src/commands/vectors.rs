//! LanceDB: the vector index, on the Rust side.
//!
//! The worker extracts and embeds — that is Python's job, because Surya and the prompt
//! handling live there. The index itself is here, in the LanceDB crate, so vector search
//! does not depend on a Python package being installed: the worker writes
//! `index/chunks.jsonl` and `index/vectors.jsonl`, and this module turns them into a Lance
//! table after every scan.
//!
//! The corpus text stays in the worker's JSONL (greppable, portable, and what the Mojo BM25
//! ranks). A hybrid query is therefore two rankings fused with RRF: BM25 from the worker,
//! vectors from LanceDB here, and the fused ids go back to the worker to be hydrated into
//! hits with their snippets.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use arrow_array::{
    Array, FixedSizeListArray, Float32Array, RecordBatch, RecordBatchIterator, StringArray,
    UInt32Array,
};
use arrow_schema::{DataType, Field, Schema};
use futures_util::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
use lancedb::{connect, Connection};
use serde_json::Value;
use shaku::Component;

use crate::error::CommandError;

/// The table the chunks live in.
const TABLE: &str = "chunks";

/// The vector index a command reaches.
pub trait VectorIndex: crate::services::Service {
    /// The index root the connection is open for, or `None` when it is closed.
    fn is_open(&self) -> Option<String>;

    /// Rebuild the index from the worker's JSONL files; returns the row count.
    fn sync(&self, root: &str) -> Result<usize, CommandError>;

    /// Chunk ids by vector similarity, best first.
    fn search(
        &self,
        root: &str,
        vector: Vec<f32>,
        limit: usize,
        doc_ids: Option<Vec<String>>,
    ) -> Result<Vec<String>, CommandError>;
}

/// The open connection, keyed by the index root it was opened for.
#[derive(Component, Default)]
#[shaku(interface = VectorIndex)]
pub struct Vectors {
    #[shaku(force_default)]
    connection: Mutex<Option<(String, Connection)>>,
}

impl VectorIndex for Vectors {
    fn is_open(&self) -> Option<String> {
        self.connection
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|(root, _)| root.clone()))
    }

    fn sync(&self, root: &str) -> Result<usize, CommandError> {
        tauri::async_runtime::block_on(sync(self, root))
    }

    fn search(
        &self,
        root: &str,
        vector: Vec<f32>,
        limit: usize,
        doc_ids: Option<Vec<String>>,
    ) -> Result<Vec<String>, CommandError> {
        tauri::async_runtime::block_on(search(self, root, vector, limit, doc_ids))
    }
}

impl crate::services::Service for Vectors {
    /// Drop the Lance connection; the next search reopens it. LanceDB keeps an in-memory handle
    /// and its file mappings, which is exactly what an idle app should not hold.
    fn on_idle(&self) {
        *self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }
}

fn fail(message: impl Into<String>) -> CommandError {
    CommandError::new("vectors", message.into())
}

/// The connection for a root, opened once.
async fn connect_root(state: &Vectors, root: &str) -> Result<Connection, CommandError> {
    {
        let guard = state
            .connection
            .lock()
            .map_err(|_| fail("the vector index lock was poisoned"))?;
        if let Some((cached, connection)) = guard.as_ref() {
            if cached == root {
                return Ok(connection.clone());
            }
        }
    }

    let uri = PathBuf::from(root).join("index").join("lance");
    std::fs::create_dir_all(&uri)
        .map_err(|error| fail(format!("could not create {}: {error}", uri.display())))?;
    let connection = connect(uri.to_string_lossy().as_ref())
        .execute()
        .await
        .map_err(|error| fail(format!("could not open LanceDB: {error}")))?;

    let mut guard = state
        .connection
        .lock()
        .map_err(|_| fail("the vector index lock was poisoned"))?;
    *guard = Some((root.to_string(), connection.clone()));
    Ok(connection)
}

/// How many rows are collected before they are written to the table.
///
/// The index is built a batch at a time, not all at once: a corpus is unbounded and the
/// process's memory must not be. The vectors are the bulk of a row, so this is what keeps a
/// hundred-thousand-chunk index from needing a hundred times the memory of one batch.
const BATCH_ROWS: usize = 512;

/// One row of the index, held only until its batch is written.
struct Row {
    id: String,
    doc_id: String,
    page: u32,
    vector: Vec<f32>,
}

/// A cursor over the vectors file: one vector at a time, tolerating a bad line.
struct VectorsFile {
    reader: BufReader<File>,
    pending: Option<(String, Vec<f32>)>,
}

impl VectorsFile {
    fn open(path: &Path) -> Option<Self> {
        File::open(path).ok().map(|file| Self {
            reader: BufReader::new(file),
            pending: None,
        })
    }

    fn next(&mut self) -> Option<(String, Vec<f32>)> {
        let mut line = String::new();
        loop {
            line.clear();
            if self.reader.read_line(&mut line).ok()? == 0 {
                return None;
            }
            if let Some(pair) = parse_vector(line.trim()) {
                return Some(pair);
            }
        }
    }

    fn peek(&mut self) -> Option<&(String, Vec<f32>)> {
        if self.pending.is_none() {
            self.pending = self.next();
        }
        self.pending.as_ref()
    }

    fn take(&mut self) -> Option<(String, Vec<f32>)> {
        if self.pending.is_none() {
            self.pending = self.next();
        }
        self.pending.take()
    }
}

/// The id and vector of one line, or `None` for a line that is not a vector.
fn parse_vector(line: &str) -> Option<(String, Vec<f32>)> {
    let row: Value = serde_json::from_str(line).ok()?;
    let id = row.get("id").and_then(Value::as_str)?.to_string();
    let list = row.get("vector").and_then(Value::as_array)?;
    let vector: Vec<f32> = list
        .iter()
        .filter_map(Value::as_f64)
        .map(|value| value as f32)
        .collect();
    if vector.is_empty() {
        None
    } else {
        Some((id, vector))
    }
}

/// The vector column's field, which every batch shares.
fn vector_field() -> Arc<Field> {
    Arc::new(Field::new("item", DataType::Float32, true))
}

/// The table's schema, without the corpus text: the text stays in the worker's JSONL and is
/// hydrated from there, so it is not stored a second time in the vector index.
fn schema(dim: usize) -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("docId", DataType::Utf8, false),
        Field::new("page", DataType::UInt32, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                dim as i32,
            ),
            false,
        ),
    ]))
}

/// Write one batch of rows into the table.
async fn write_batch(
    table: &lancedb::Table,
    rows: &[Row],
    schema: Arc<Schema>,
    dim: usize,
) -> Result<usize, CommandError> {
    if rows.is_empty() {
        return Ok(0);
    }
    let ids: Vec<String> = rows.iter().map(|row| row.id.clone()).collect();
    let doc_ids: Vec<String> = rows.iter().map(|row| row.doc_id.clone()).collect();
    let pages: Vec<u32> = rows.iter().map(|row| row.page).collect();
    let mut flat: Vec<f32> = Vec::with_capacity(rows.len() * dim);
    for row in rows {
        flat.extend_from_slice(&row.vector);
    }

    let vectors_array = FixedSizeListArray::try_new(
        vector_field(),
        dim as i32,
        Arc::new(Float32Array::from(flat)),
        None,
    )
    .map_err(|error| fail(format!("could not build the vector column: {error}")))?;

    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(StringArray::from(ids)) as Arc<dyn Array>,
            Arc::new(StringArray::from(doc_ids)),
            Arc::new(UInt32Array::from(pages)),
            Arc::new(vectors_array),
        ],
    )
    .map_err(|error| fail(format!("could not build the batch: {error}")))?;

    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema);
    table
        .add(reader)
        .execute()
        .await
        .map_err(|error| fail(format!("could not write the batch: {error}")))?;
    Ok(rows.len())
}

/// The dimension of the vectors on disk, from the first vector line.
fn vector_dim(index: &Path) -> Result<Option<usize>, CommandError> {
    let Some(mut vectors) = VectorsFile::open(&index.join("vectors.jsonl")) else {
        return Ok(None);
    };
    Ok(vectors.next().map(|(_, vector)| vector.len()))
}

/// Rebuild the Lance table from the worker's JSONL files, a batch at a time. Returns the row
/// count.
///
/// The chunks and vectors are read in lockstep — the worker appends both in the same order —
/// so a chunk and its vector are paired without holding the whole vectors file in a map. A
/// chunk whose vector is missing is skipped, and the cursor is left where it is for the next
/// chunk. Nothing larger than one batch is held.
pub async fn sync(state: &Vectors, root: &str) -> Result<usize, CommandError> {
    let index = PathBuf::from(root).join("index");
    let Some(dim) = vector_dim(&index)? else {
        return Ok(0);
    };
    let Some(chunks) = File::open(index.join("chunks.jsonl")).ok() else {
        return Ok(0);
    };
    let Some(mut vectors) = VectorsFile::open(&index.join("vectors.jsonl")) else {
        return Ok(0);
    };

    let schema = schema(dim);
    let connection = connect_root(state, root).await?;
    if connection
        .table_names()
        .execute()
        .await
        .map_err(|error| fail(format!("could not list the tables: {error}")))?
        .iter()
        .any(|name| name == TABLE)
    {
        connection
            .drop_table(TABLE, &[])
            .await
            .map_err(|error| fail(format!("could not replace the table: {error}")))?;
    }
    let table = connection
        .create_empty_table(TABLE, schema.clone())
        .execute()
        .await
        .map_err(|error| fail(format!("could not create the table: {error}")))?;

    let mut reader = BufReader::new(chunks);
    let mut line = String::new();
    let mut rows: Vec<Row> = Vec::with_capacity(BATCH_ROWS);
    let mut written = 0usize;

    loop {
        line.clear();
        if reader
            .read_line(&mut line)
            .map_err(|error| fail(format!("could not read the chunks: {error}")))?
            == 0
        {
            break;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        let doc_id = chunk
            .get("docId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let position = chunk.get("position").and_then(Value::as_u64).unwrap_or(0);
        let expected = format!("{doc_id}:{position}");

        // The vector is the next one in the file, and only when it is this chunk's. A chunk
        // whose vector is gone leaves the cursor untouched, so the next chunk still pairs.
        let matches = matches!(vectors.peek(), Some((id, _)) if id == &expected);
        if !matches {
            continue;
        }
        let Some((_, vector)) = vectors.take() else {
            continue;
        };
        if vector.len() != dim {
            continue;
        }
        rows.push(Row {
            id: expected,
            doc_id,
            page: chunk.get("page").and_then(Value::as_u64).unwrap_or(0) as u32,
            vector,
        });

        if rows.len() >= BATCH_ROWS {
            written += write_batch(&table, &rows, schema.clone(), dim).await?;
            rows.clear();
        }
    }
    written += write_batch(&table, &rows, schema.clone(), dim).await?;

    Ok(written)
}

/// Chunk ids by vector similarity, best first.
pub async fn search(
    state: &Vectors,
    root: &str,
    vector: Vec<f32>,
    limit: usize,
    doc_ids: Option<Vec<String>>,
) -> Result<Vec<String>, CommandError> {
    let connection = connect_root(state, root).await?;
    let names = connection
        .table_names()
        .execute()
        .await
        .map_err(|error| fail(format!("could not list the tables: {error}")))?;
    if !names.iter().any(|name| name == TABLE) {
        return Ok(Vec::new());
    }
    let table = connection
        .open_table(TABLE)
        .execute()
        .await
        .map_err(|error| fail(format!("could not open the table: {error}")))?;

    let mut query = table
        .vector_search(vector.as_slice())
        .map_err(|error| fail(format!("could not start the vector search: {error}")))?
        .limit(limit.max(1));
    if let Some(ids) = doc_ids {
        if !ids.is_empty() {
            let quoted: Vec<String> = ids
                .iter()
                .map(|id| format!("'{}'", id.replace('\'', "''")))
                .collect();
            query = query.only_if(format!("docId IN ({})", quoted.join(", ")));
        }
    }

    let stream = query
        .execute()
        .await
        .map_err(|error| fail(format!("the vector search failed: {error}")))?;
    let batches: Vec<RecordBatch> = stream
        .try_collect()
        .await
        .map_err(|error| fail(format!("could not read the search results: {error}")))?;

    let mut ids = Vec::new();
    for batch in batches {
        let column = batch
            .column_by_name("id")
            .and_then(|column| column.as_any().downcast_ref::<StringArray>())
            .ok_or_else(|| fail("the search result has no id column"))?;
        for index in 0..column.len() {
            ids.push(column.value(index).to_string());
        }
    }
    Ok(ids)
}

/// Reciprocal-rank fusion over ordered id lists (best first). Pure, so it is tested directly.
pub fn rrf(rankings: &[Vec<String>], k: usize) -> Vec<String> {
    let mut scores: HashMap<&str, f64> = HashMap::new();
    for ranking in rankings {
        for (position, id) in ranking.iter().enumerate() {
            *scores.entry(id.as_str()).or_insert(0.0) += 1.0 / (k + position + 1) as f64;
        }
    }
    let mut fused: Vec<(&str, f64)> = scores.into_iter().collect();
    fused.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    fused.into_iter().map(|(id, _)| id.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rrf_fuses_two_rankings() {
        let first = vec!["a".to_string(), "b".to_string()];
        let second = vec!["b".to_string(), "a".to_string()];
        let fused = rrf(&[first, second], 60);
        assert_eq!(fused.len(), 2);
        // Both appear first once and second once, so the order is stable and both are present.
        assert!(fused.contains(&"a".to_string()));
        assert!(fused.contains(&"b".to_string()));
    }

    #[test]
    fn rrf_prefers_the_shared_top() {
        let first = vec!["a".to_string(), "b".to_string()];
        let second = vec!["a".to_string(), "c".to_string()];
        let fused = rrf(&[first, second], 60);
        assert_eq!(fused.first().map(String::as_str), Some("a"));
    }

    #[tokio::test]
    async fn sync_and_search_round_trip() {
        let root =
            std::env::temp_dir().join(format!("openlab-vectors-roundtrip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let index = root.join("index");
        std::fs::create_dir_all(&index).unwrap();
        std::fs::write(
            index.join("chunks.jsonl"),
            [
                r#"{"docId":"doc-1","position":0,"page":1,"text":"chromatin accessibility improves prediction"}"#,
                r#"{"docId":"doc-1","position":1,"page":2,"text":"battery economics are unrelated"}"#,
            ]
            .join("\n"),
        )
        .unwrap();
        std::fs::write(
            index.join("vectors.jsonl"),
            [
                r#"{"id":"doc-1:0","vector":[1.0,0.0,0.0]}"#,
                r#"{"id":"doc-1:1","vector":[0.0,1.0,0.0]}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let vectors = Vectors::default();
        let rows = sync(&vectors, root.to_str().unwrap()).await.unwrap();
        assert_eq!(rows, 2);

        let ids = search(
            &vectors,
            root.to_str().unwrap(),
            vec![1.0, 0.0, 0.0],
            1,
            None,
        )
        .await
        .unwrap();
        assert_eq!(ids.first().map(String::as_str), Some("doc-1:0"));

        let scoped = search(
            &vectors,
            root.to_str().unwrap(),
            vec![0.0, 1.0, 0.0],
            2,
            Some(vec!["someone-else".to_string()]),
        )
        .await
        .unwrap();
        assert!(scoped.is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A chunk whose vector is missing is skipped, and the next chunk still finds its own —
    /// the cursor is not consumed by the gap.
    #[tokio::test]
    async fn a_chunk_without_a_vector_does_not_desync_the_pairing() {
        let root = std::env::temp_dir().join(format!("openlab-vectors-gap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let index = root.join("index");
        std::fs::create_dir_all(&index).unwrap();
        std::fs::write(
            index.join("chunks.jsonl"),
            [
                r#"{"docId":"doc-1","position":0,"page":1,"text":"a"}"#,
                r#"{"docId":"doc-1","position":1,"page":2,"text":"b"}"#,
                r#"{"docId":"doc-1","position":2,"page":3,"text":"c"}"#,
            ]
            .join("\n"),
        )
        .unwrap();
        std::fs::write(
            index.join("vectors.jsonl"),
            [
                r#"{"id":"doc-1:0","vector":[1.0,0.0,0.0]}"#,
                r#"{"id":"doc-1:2","vector":[0.0,1.0,0.0]}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let state = Vectors::default();
        let rows = sync(&state, root.to_str().unwrap()).await.unwrap();
        assert_eq!(
            rows, 2,
            "the chunk with no vector is skipped, the others are kept"
        );

        let ids = search(&state, root.to_str().unwrap(), vec![0.0, 1.0, 0.0], 1, None)
            .await
            .unwrap();
        assert_eq!(ids.first().map(String::as_str), Some("doc-1:2"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A live check against a root the worker produced, with real embeddings:
    ///
    /// ```text
    /// OPENLAB_TEST_ROOT=<root> cargo test vectors::sync_a_live_root -- --ignored
    /// ```
    #[tokio::test]
    #[ignore = "needs a root the worker has already indexed"]
    async fn sync_a_live_root() {
        let Ok(root) = std::env::var("OPENLAB_TEST_ROOT") else {
            return;
        };
        let vectors = Vectors::default();
        let rows = sync(&vectors, &root).await.unwrap();
        assert!(rows > 0, "the worker's JSONL had no vectors to index");
        let query = {
            let mut vector = vec![0.0f32; 768];
            vector[0] = 1.0;
            vector
        };
        let ids = search(&vectors, &root, query, 3, None).await.unwrap();
        assert!(!ids.is_empty(), "the LanceDB search returned nothing");
    }

    /// The process's resident set, in kilobytes, from `ps`.
    fn resident_kb() -> u64 {
        let pid = std::process::id().to_string();
        match std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &pid])
            .output()
        {
            Ok(output) => String::from_utf8_lossy(&output.stdout)
                .trim()
                .parse()
                .unwrap_or(0),
            Err(_) => 0,
        }
    }

    /// How many rows the benchmark builds.
    fn bench_rows() -> usize {
        std::env::var("OPENLAB_BENCH_ROWS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(5000)
    }

    /// A synthetic corpus on disk: `rows` chunks and their 768-dimension vectors.
    fn synthetic_corpus(root: &Path, rows: usize) {
        let index = root.join("index");
        std::fs::create_dir_all(&index).unwrap();
        let mut chunks = String::new();
        let mut vectors = String::new();
        for position in 0..rows {
            let doc = position / 20;
            let slot = position % 20;
            chunks.push_str(&format!(
                r#"{{"docId":"doc-{doc}","position":{slot},"page":1,"text":"chromatin accessibility off-target prediction sequence model holdout atac dnase assay genome crispr"}}"#
            ));
            chunks.push('\n');
            vectors.push_str(&format!(r#"{{"id":"doc-{doc}:{slot}","vector":["#));
            for dimension in 0..768 {
                if dimension > 0 {
                    vectors.push(',');
                }
                vectors.push_str(if dimension == position % 768 {
                    "1.0"
                } else {
                    "0.0"
                });
            }
            vectors.push_str("]}\n");
        }
        std::fs::write(index.join("chunks.jsonl"), chunks).unwrap();
        std::fs::write(index.join("vectors.jsonl"), vectors).unwrap();
    }

    /// The streaming index build, timed and measured.
    ///
    /// ```text
    /// OPENLAB_BENCH_ROWS=20000 cargo test --lib vectors::tests::bench_sync -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "a benchmark; run it with --ignored"]
    async fn bench_sync() {
        let rows = bench_rows();
        let root = std::env::temp_dir().join(format!("openlab-bench-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        synthetic_corpus(&root, rows);

        let before = resident_kb();
        let state = Vectors::default();
        let started = std::time::Instant::now();
        let written = sync(&state, root.to_str().unwrap()).await.unwrap();
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        let after = resident_kb();
        println!(
            "BENCH {{ \"rows\": {rows}, \"written\": {written}, \"sync_ms\": {elapsed:.1}, \"rss_before_mb\": {:.1}, \"rss_after_mb\": {:.1} }}",
            before as f64 / 1024.0,
            after as f64 / 1024.0
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The pre-change algorithm, kept as a same-machine baseline: read the whole corpus into
    /// memory and write one table. It exists only to be measured against [`bench_sync`].
    #[tokio::test]
    #[ignore = "a benchmark; run it with --ignored"]
    async fn bench_sync_legacy() {
        use std::collections::HashMap;

        let rows = bench_rows();
        let root =
            std::env::temp_dir().join(format!("openlab-bench-legacy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        synthetic_corpus(&root, rows);
        let index = root.join("index");

        let read = |path: &Path| -> Vec<Value> {
            std::fs::read_to_string(path)
                .map(|text| {
                    text.lines()
                        .filter_map(|line| serde_json::from_str(line).ok())
                        .collect()
                })
                .unwrap_or_default()
        };

        let before = resident_kb();
        let started = std::time::Instant::now();

        let chunk_rows = read(&index.join("chunks.jsonl"));
        let vector_rows = read(&index.join("vectors.jsonl"));
        let mut by_id: HashMap<String, Vec<f32>> = HashMap::new();
        for row in &vector_rows {
            let (Some(id), Some(list)) = (
                row.get("id").and_then(Value::as_str),
                row.get("vector").and_then(Value::as_array),
            ) else {
                continue;
            };
            let values: Vec<f32> = list
                .iter()
                .filter_map(Value::as_f64)
                .map(|value| value as f32)
                .collect();
            by_id.insert(id.to_string(), values);
        }

        let mut ids: Vec<String> = Vec::new();
        let mut doc_ids: Vec<String> = Vec::new();
        let mut pages: Vec<u32> = Vec::new();
        let mut texts: Vec<String> = Vec::new();
        let mut flat: Vec<f32> = Vec::new();
        let mut dim = 0usize;
        for row in &chunk_rows {
            let doc_id = row.get("docId").and_then(Value::as_str).unwrap_or_default();
            let position = row.get("position").and_then(Value::as_u64).unwrap_or(0);
            let id = format!("{doc_id}:{position}");
            let Some(vector) = by_id.get(&id) else {
                continue;
            };
            if dim == 0 {
                dim = vector.len();
            }
            if vector.len() != dim {
                continue;
            }
            ids.push(id);
            doc_ids.push(doc_id.to_string());
            pages.push(row.get("page").and_then(Value::as_u64).unwrap_or(0) as u32);
            texts.push(
                row.get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            );
            flat.extend_from_slice(vector);
        }

        let legacy_schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Utf8, false),
            Field::new("docId", DataType::Utf8, false),
            Field::new("page", DataType::UInt32, false),
            Field::new("text", DataType::Utf8, false),
            Field::new(
                "vector",
                DataType::FixedSizeList(
                    Arc::new(Field::new("item", DataType::Float32, true)),
                    dim as i32,
                ),
                false,
            ),
        ]));
        let vectors_array = FixedSizeListArray::try_new(
            vector_field(),
            dim as i32,
            Arc::new(Float32Array::from(flat)),
            None,
        )
        .unwrap();
        let batch = RecordBatch::try_new(
            legacy_schema.clone(),
            vec![
                Arc::new(StringArray::from(ids.clone())) as Arc<dyn Array>,
                Arc::new(StringArray::from(doc_ids)),
                Arc::new(UInt32Array::from(pages)),
                Arc::new(StringArray::from(texts)),
                Arc::new(vectors_array),
            ],
        )
        .unwrap();

        let state = Vectors::default();
        let connection = connect_root(&state, root.to_str().unwrap()).await.unwrap();
        if connection
            .table_names()
            .execute()
            .await
            .unwrap()
            .iter()
            .any(|name| name == TABLE)
        {
            connection.drop_table(TABLE, &[]).await.unwrap();
        }
        let reader = RecordBatchIterator::new(vec![Ok(batch)], legacy_schema);
        connection
            .create_table(TABLE, reader)
            .execute()
            .await
            .unwrap();

        let written = ids.len();
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        let after = resident_kb();
        println!(
            "BENCH-LEGACY {{ \"rows\": {rows}, \"written\": {written}, \"sync_ms\": {elapsed:.1}, \"rss_before_mb\": {:.1}, \"rss_after_mb\": {:.1} }}",
            before as f64 / 1024.0,
            after as f64 / 1024.0
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
