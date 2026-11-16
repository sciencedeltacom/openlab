# openlab CLI

The research workbench, at the terminal. Not a second implementation: the same SQLite store,
the same workspace folder, the same statistical engine, the same agent — with the window taken
away and `--json` added.

```bash
# from apps/openlab
bun run cli status

# or put `openlab` on your PATH
cd cli && bun link && openlab status
```

## What it shares with the app

|                   |                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The store**     | `openlab.db` in the app's data directory (`~/Library/Application Support/dev.sciencedelta.deltalab` on macOS). A session you run here appears in the app, and the reverse. |
| **The workspace** | `.labconfig`, `openwiki/`, `.openlab/plan/`, `.openlab/figures/` — written with the app's own renderers, so the app opens what the CLI wrote.                              |
| **The agent**     | The same system prompt, tool inventory, pack gating, permission gate and subagent delegation (`src/store/engine.ts`, `src/lib/ai/tools.ts`).                               |
| **The science**   | `src/lib/science/stats.ts` verbatim: every result carries its assumption checks and the R and Python that recompute it.                                                    |
| **The models**    | The same provider registry and the same `models.dev` snapshot.                                                                                                             |

Two things are the CLI's own, because they cannot be shared: credentials (the app's are in an
encrypted Stronghold snapshot; the CLI reads the environment and its own `0600` vault), and the
Rust worker surfaces — the document scan engine and remote compute submission — which need the
desktop shell running.

## The terminal, the way a terminal should feel

The CLI is not a TUI, but it is not a log either. Three touches do the work:

- **A guided form for a review.** `openlab literature new` with no `--question` asks the
  protocol with `@clack/prompts`: question, criteria, sources (space to select), record limit
  and depth. Flags remain the scriptable path, and a pipe never waits for an answer.
- **Spinners while something is slow.** Retrieval and screening show a spinner on stderr
  (`ora`) with the current stage, so a long run is visibly alive and `--json` stays clean.
- **Colour that turns itself off.** `picocolors` draws the palette when a terminal is attached
  and strips it when the output is piped or `NO_COLOR` is set.

```
Δ openlab · the research workbench

lab      EGFR inhibitors  ~/research/egfr
model    anthropic/claude-sonnet-4-6
git      main 2 changed

Work
sessions 12
tasks    8 (3 open)
```

The prompts ask; they do not execute. The one place a decision matters, the permission gate,
is a choice list: allow this call, allow the tool for the rest of the turn, or refuse.

## A tour

```bash
openlab init ~/research/egfr --name "EGFR inhibitors" --git
openlab status                                  # the dashboard
openlab chat "clean data/raw.csv and plot the dose response"
openlab session list                            # what that turn left behind
openlab files tree --depth 2
openlab search grep --path scripts 'read_csv'
openlab git status && openlab git commit -m "Clean the dose series"
openlab research tasks new --title "Dose-response fit" --kind analysis --wave W1
openlab plan export                             # mirror the plan into .openlab/plan/
openlab wiki graph                              # the OpenWiki as a graph
openlab sources preview --database pubmed --question "egfr inhibitor resistance"
```

The statistics engine is the part worth trying first — it is the whole point of the workbench:

```bash
openlab analyze statistics ttest \
  --a 5.1,4.9,6.2,5.8,6.4 --b 4.2,4.4,3.9,4.8,4.1 --code
```

````
welch-t-test  t(6) = 4.206, p = 0.006, Cohen's d = 2.66 (large)

t               4.20589
df              5.99861
…
Assumptions
  ✓ equal-variance: Welch correction applied: …

R
```r
a <- c(5.1, 4.9, 6.2, 5.8, 6.4)
b <- c(4.2, 4.4, 3.9, 4.8, 4.1)
t.test(a, b)
````

````

It reads CSV too, including from a pipe:

```bash
cat assay.csv | openlab analyze statistics anova --data - --groups control,treatment
````

## Every command

```
openlab status · doctor · init · chat
openlab workspace   info · config · structure · projects
openlab files       ls · cat · write · rm · mv · stat · tree
openlab git         status · stage · unstage · commit · log · diff
openlab search      glob · grep
openlab exec        run · fetch
openlab db          path · tables · sql · stats
openlab secrets     list · set · rm
openlab session     list · show · new · rename · rm · ask · export
openlab research    tasks · waves · intake · analytics · notes · views · members · labels
openlab plan        export · read · waves
openlab wiki        list · show · graph · search · new
openlab sources     list · show · new · rm · preview
openlab databases   list · show · new · rm
openlab literature  list · show · new · papers · run
openlab analyze     statistics · experiments · figures
openlab compute     jobs · targets · run · autoresearch
openlab packs       list · show · install · uninstall · enable · disable
openlab skills      list · show · new · audit · recipes
openlab tools       catalog · connectors · credentials · custom · mcp
openlab connections list · show · new · rm
openlab providers   list · show · add · rm · base-url · test
openlab models      list · search
openlab agents      list · show · new · active · subagents · mcp
openlab settings    list · get · set
openlab scan        health · status
openlab cloud       request · download · providers
openlab autocomplete zsh|bash|powershell
```

## What needs the app

Five things are the desktop shell's, and the CLI says so rather than pretending:

|                          |                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The document scan engine | The Python worker and its embedding server are started, supervised and torn down by the Rust side. `scan health` reports what is on disk and where the index lives.                                                                  |
| Remote compute           | Submitting to Modal, Kaggle, Slurm, GCP or Azure needs the app's worker, which reads the credential from the credential vault and sets it on one child process. `compute run` runs a `local` target for real and refuses the rest by name. |
| S3-compatible requests   | SigV4 signing lives in the app's Rust client, so `cloud request` refuses an S3 endpoint and names it.                                                                                                                                |
| Figure rendering         | SVG and PNG come from the app's renderer; `analyze figures export` writes the source document into `results/` instead.                                                                                                               |
| The app's keys           | The desktop keeps provider keys in an encrypted Stronghold snapshot only the Rust plugin can read. The CLI reads the environment and its own vault.                                                                                  |

## Checking it

```bash
bun run cli:typecheck   # the CLI project
bun run verify:cli      # end to end, against a scratch data directory and lab
```

## Flags every command takes

| flag                       | what it does                                                           |
| -------------------------- | ---------------------------------------------------------------------- |
| `--json` / `-j`            | machine-readable output, for `jq`                                      |
| `--workspace <dir>` / `-w` | the lab folder, instead of the nearest one above the working directory |
| `--data <dir>`             | the app data directory, instead of the desktop app's                   |

Environment: `OPENLAB_WORKSPACE`, `OPENLAB_DATA_DIR`, `OPENLAB_DB`, `NO_COLOR`, and each
provider's own key variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …).

## Credentials

The agent and the provider commands read a key from the environment first, then from the CLI's
vault:

```bash
openlab secrets set anthropic            # value read from stdin
openlab secrets set openai --value sk-…
openlab providers test anthropic         # asks the provider whether the key is accepted
```

The app's keys are not visible here and these are not visible to the app: one is a Stronghold
snapshot the Rust plugin owns, the other is a `0600` JSON file in the same directory. That is a
deliberate split, not an oversight.

## Adding a command

See [CONTRIBUTING.md](./CONTRIBUTING.md). Short version: extend `LabCommand`, reuse the app's
modules through `@/…`, mutate `lab.state`, `await lab.save()`.
