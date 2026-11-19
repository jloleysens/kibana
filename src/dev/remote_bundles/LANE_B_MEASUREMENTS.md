# Lane B consolidated quiet phase

Development-only. Isolated scratch ES on **9235**, standard local development
accounts; no Kibana listener on **5635**. Never use shared infrastructure. Start ES
with `--port 9235 -E transport.port=0 -E network.host=127.0.0.1` and an ignored
scratch data path. Stop both lanes' builds/typechecks before collecting timings.

One command, from the merged worktree (pinned Node):

```sh
node scripts/measure_runner_lane_b.js \
  --config .scratch/runner-poc-lane-b/quiet-base.yml \
  --output .scratch/runner-poc-lane-b/quiet-$(date +%s)
```

Required flat-key YAML base config: `server.port: 5635`,
`server.host: 127.0.0.1`,
`elasticsearch.hosts: [http://127.0.0.1:9235]`, ordinary local development security,
reporting and encrypted-SO keys/accounts, `path.data` under this worktree's
`.scratch/`, `xpack.alertzero.enabled: true`, and
`feature_flags.overrides: {workflows.kibanaRequest.coreSelfClientEnabled: true}`.
The session5 `s5-child.yml` is a working example. Config contents are not printed;
identity records their hash. Generated local configs contain these local keys;
keep output ignored and private. The command owns/restarts only its own Kibana,
uses an OS-assigned loopback port for the fake, deletes only its uniquely named
inference endpoint, and closes its fake/Kibana on ordinary completion/failure.
ES remains caller-owned. It refuses an occupied Kibana port or existing output
directory; retains failed attempts. Workflows, Cases, Notes, fingerprints and
outcome docs remain for independent review; all identifiers have a lane-B prefix.

`--smoke` runs only three instrumented profiles (ordinary Kibana, child_process,
in_process), two runs per family: **18 real persisted runs**. Not a timing claim.
The full matrix intentionally runs serially and restarts Kibana many times.

## Fixed method / outputs

- Builds the real graph once, retaining metafile, digest metadata, byte counts,
  source/config/Node/machine identity and dirty status. Captures process CPU/RSS
  contention snapshots before/after each profile. Build is outside timing cells.
- Original idle probe records three fresh workers, idle roots/RSS/post-GC heap.
  Compiled original inference/Cases/Security execution fixtures run three fresh
  processes each, retaining lazy shared-capability first-use JS/heap/latency and
  exclusive per-step curves. They execute valid original business responses, not
  just module imports. These are separate from end-to-end timing cells.
- Same actual definitions for ordinary in-Kibana and runner: extension-heavy
  entity resolution + exact exception filter + **nonempty fingerprint write** +
  Note create/read; Cases create/update/comment/find/get; inference prompt,
  summarize and classify via a local OpenAI-compatible fake ES inference endpoint.
  Every run persists an ES outcome; independent Case/comment/fingerprint/outcome
  reads validate it. No mocked business service or empty fingerprint fast path.
- Uninstrumented timing: ordinary Kibana (`remoteExecution.enabled:false`) vs
  child_process; delays **0/1/5/30ms one-way per outbound IPC frame** for extension
  and Cases. Inference measured at delay0. Three independent fresh-Kibana+worker
  cold blocks per family/cell, five subsequent warm leases per block. Raw engine
  execution `duration` and submission-to-terminal-observation retained; latter
  includes 100ms polling quantization, not independent verification GETs. Cold
  means fresh processes, **not OS disk cache eviction**. Startup/readiness excluded.
- `summary.json`: cold3/warm15 nearest-rank medians and min/max per cell; inspect
  raw spread and contention before accepting stable medians. Instrumentation,
  forced GC, seam logging and load hooks explicitly absent from timing profiles.
  `finalTimingClaims:false` is deliberate: a harness cannot certify a quiet laptop.
- Separate instrumented memory/callback profiles: baseline, child_process and
  in_process, fixed family order extensions -> Cases -> inference. Per-step Core
  heap markers + 100ms per-process RSS/heap/cumulative process CPU samples.
  Acknowledged SIGUSR2 samples force GC in **each owned process** before/after each
  run. `memory-curve.jsonl` retains individual PIDs and combined Kibana+worker RSS/
  heap, compared with Kibana alone. Family-first-use is incremental on preceding
  families here; standalone first use comes from the isolated fixtures above.
  Samples are near-synchronous, not proof of synchronized transient peaks.
- `runs.jsonl` records named coordinator callbacks/run and request payload bytes,
  excluding coordinator->worker dispatch. `seams.jsonl` retains control/describe
  calls separately by name; no generic `WorkflowStepRunner.invoke` admitted in
  instrumented native profiles. Original Cases timing records retain operation,
  bytes, wall time and **process-wide CPU during wait**, not exclusive CPU per SO
  call. No direct SO fallback is used by these workloads: Cases is its separately
  approved original business-service capability; Security uses scoped native ES
  and ordinary authenticated HTTP. Do not relabel either as native SO.

## Shared first-use guards (not final quiet latency results)

| Lazy shared capability | Observed post-GC heap | Incremental JS | Guard heap / JS / first-use |
|---|---:|---:|---|
| Original inference + first model response |34.53–34.56MB|10,426,176B|36MiB /11.5MB /300ms|
| Original Cases validation + first valid response |8.21–8.43MB|1,538,894B|9MiB /1.7MB /65ms median3|
| Original native ES `ExecutorDataPlane.open` |4.77–5.12MB|2,567,898B|5.6MB /2.8MB /45ms median3|
| Original EntityStore entity resolution, valid Painless+parse |5.98–6.23MB|1,431,802B|6.8MB /1.56MB /45ms median3|

Entity resolution is genuinely shared by getAlertEntities and fingerprint
matching. Exclusive execution increments remain <=2MiB and static closures
<=256KiB; idle <=80MiB; no UI or aggregate lodash. Entity Store audit: four public
synchronous built-in object exports eagerly construct definitions; main entity
schemas already lazy, original condition schemas eager. Lazy-per-type conversion
would change several public synchronous exports/identity; not a contained fix.
No allowance silently raised to hide it.

## Pre-existing product safety finding — upstream owner decision

With **AlertZero disabled**, the original live fingerprint create guard defaults
true. First nonempty `security.matchAttackFingerprints` auto-creates
`ai-index-idx-security-attack-fingerprints` without nested
`permissions.kibana.privileges`; subsequent calls refuse writes. The unchanged
in-Kibana implementation has the same behavior. Empty-attacks tests miss it;
independent nonempty persisted proof exposed it. Runner relocation deliberately
does **not** change this default. Proposed owning-team follow-up: fail-closed
default plus regression test. Local proof index contained exactly one owned test
doc; deleted only with explicit supervisor approval. Normal AlertZero startup
installs the original exact-name template; correctly configured nonempty proofs
then pass both backends. Never delete an unknown index or relax the mapping guard
just to make this harness pass.

## Legacy inference execution addition

AI3 also uses the original legacy LLM executors through lane A's authorized
prepare/secrets/finalize pipeline. Additive `runLocal` returns live streams only
to in-worker inference adapters; ordinary connector `runLegacy` behavior unchanged.
Original token tracking runs once, after consumption/abort/error its JSON-safe
usage joins the existing durable completion drain. Run Node-native stream tests
separately (the general tooling project intentionally uses JSDOM):

```sh
node scripts/jest src/dev/remote_bundles/node_tests --runInBand
```

Those two serialized-backend tests use explicitly fake scoped Actions preparation
and real original model/connector/token code, not production authorization proof.
Production auth/secrets/PID/persisted outcomes are the separate live workflow
proofs. The original workflow AI handlers use `model.invoke` (non-streaming);
streaming coverage deliberately calls original `model.stream`, never changes
workflow semantics to manufacture a streaming workflow API.

Reviewed shell source growth:2188B ->2857B (laneA runLegacy/types) ->2996B (additive
runLocal). Source ceiling3300B; same exact two-input allowlist;40KiB median post-GC
shell heap unchanged (measured33.6–38.8KiB). Source cap may grow only for explicit
reviewed API methods with this unchanged allowlist. Any new input requires a
source fix, not a higher cap. Both token-tracker imports remain dynamic.
