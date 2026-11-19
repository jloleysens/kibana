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
in_process), two runs per family: **48 real persisted runs**. Not a timing claim.
The full matrix intentionally runs serially and restarts Kibana many times.

## Fixed method / outputs

- Builds the real graph once, retaining metafile, digest metadata, byte counts,
  source/config/Node/machine identity and dirty status. Captures process CPU/RSS
  contention snapshots before/after each profile. Build is outside timing cells.
- Original idle probe records three fresh workers, idle roots/RSS/post-GC heap.
  Compiled original inference/Cases/Security/conversation execution fixtures run three fresh
  processes each, retaining lazy shared-capability first-use JS/heap/latency and
  exclusive per-step curves. They execute valid original business responses, not
  just module imports. These are separate from end-to-end timing cells.
- Same actual definitions for ordinary in-Kibana and runner: extension-heavy
  entity resolution + exact exception filter + **nonempty fingerprint write** +
  Note create/read; Cases create/update/comment/find/get; inference prompt,
  summarize and classify via a local OpenAI-compatible fake ES inference endpoint;
  conversation create/metadata patch/registered event/read through the original
  native ES/OCC/ACL client, plus original add-user-message via a narrow
  authenticated never-trigger execution-service append; no agent/LLM executes
  for that append; attachment add/update/read/list/delete plus historical
  read and a real by-reference workflow YAML origin resolution; original rerank
  over a local Hugging Face-compatible fake through a real ES inference endpoint,
  retaining the original rank-window tail; ai.agent through its original authenticated
  coordinator agent runtime, with native normalization/output/error projection,
  persisted public conversation and independent stored workflow provenance. Every run persists an ES outcome;
  independent Case/comment/user-action-source/fingerprint/conversation/event/attachment/outcome reads
  validate it. No mocked business service or empty fingerprint fast path.
- Uninstrumented timing: ordinary Kibana (`remoteExecution.enabled:false`) vs
  child_process; delays **0/1/5/30ms one-way per outbound IPC frame** for extension
  and Cases. Inference, conversation, attachments, rerank and agent measured at delay0.
  Three independent fresh-Kibana+worker
  cold blocks per family/cell, five subsequent warm leases per block. Raw engine
  execution `duration` and submission-to-terminal-observation retained; latter
  includes 100ms polling quantization, not independent verification GETs. Cold
  means fresh processes, **not OS disk cache eviction**. Startup/readiness excluded.
- `summary.json`: cold3/warm15 nearest-rank medians and min/max per cell; inspect
  raw spread and contention before accepting stable medians. Instrumentation,
  forced GC, seam logging and load hooks explicitly absent from timing profiles.
  `finalTimingClaims:false` is deliberate: a harness cannot certify a quiet laptop.
- Separate instrumented memory/callback profiles: baseline, child_process and
  in_process, fixed family order extensions -> Cases -> inference -> conversation
  -> attachments -> rerank -> agent -> nightshift-compose. Per-step Core
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
| Original conversation client + first valid native read |6.08MB|1,575,390B|6.6MB /1.73MB /45ms median3|

Entity resolution is genuinely shared by getAlertEntities and fingerprint
matching. Exclusive execution increments remain <=2MiB and static closures
<=256KiB; idle <=80MiB; no UI or aggregate lodash. Entity Store audit: four public
synchronous built-in object exports eagerly construct definitions; main entity
schemas already lazy, original condition schemas eager. Lazy-per-type conversion
would change several public synchronous exports/identity; not a contained fix.
No allowance silently raised to hide it.

Conversation storage, OCC and ACL checks execute in the worker; dedicated ES
indices are not saved objects. Original request-derived identity/space/template
facts and opaque client references are per client, not cross-step cached. Live
agent registry checks and original event validation stay coordinator-side;
validation precedes OCC. Original audit/event/telemetry/log hooks batch on drain;
client references release on drain or run abort. Hooks are rebuilt coordinator-side
from original converse-authorized before/after snapshots, never worker-authored
provenance. Optional original-client beforeWrite capture binds seqNo/primaryTerm
to the worker's conditional write; notify verifies per-document `_version + 1`
(not index-global `_seq_no + 1`). Attachment event IDs must resolve to new visible
persisted events; duplicate notifications and foreign targets are rejected.
The conversation workload adds3prepare RPCs and6coordinator ES authorization
reads/run plus1original never-trigger message-append business-service RPC; attachment workload adds5prepare RPCs and10reads/run. Each read's
wall time and process-wide CPU are retained in `runs.jsonl` and `timing.jsonl`. Safe typed error DTOs preserve
original AgentBuilder error prototypes without private request/header metadata.
Attachment handlers reuse the original state manager, version hashing, reconciliation
and atomic event+snapshot writes in the worker. Only live type validation and
origin resolution call the typed coordinator registry; the original resolver gets
the authenticated run request/space and normal scoped SO client. No fake Core/SO
objects cross, no direct saved-object storage claim. The live workflow-YAML origin
proof exercises the original workflow authorization and repository, not a fabricated
SO resolver. Attachment exclusive first-business increments0.10–0.43MB remain
inside the existing2MiB guard; shared conversation guard unchanged. Original rerank
first business response adds~0.22MB after the native ES shared service; no new
coordinator capability, only the usual step-describe control RPC.
`add_user_message` handler and normalization execute in the worker, but its
original message persistence/execution-business-service operation deliberately
stays coordinator-side (the approved heavy execution-service exception); this
is not claimed to be native conversation storage for that one step.

### Known remote notification race divergence

In-Kibana describes the successful write from its in-memory before/after and
never misses that notification. If a concurrent writer updates the document
between the remote write and notify GET, the remote path deliberately skips the
notification with an original best-effort coordinator warning (IDs/versions),
never emits a wrong diff. Tests cover capture/write conflicts and this later race.
An authoritative durable outbox or atomically captured after-state would close
the gap; neither is silently claimed here.

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
runLocal) ->3147B (merged runClassic). Source ceiling3300B; same exact two-input
allowlist and292-input static closure. Merged-graph shell heap44,304–44,960B;
50,000B median post-GC ceiling (~11%headroom), recalibrated under the approved
same-input repartition policy, not an unchanged40KiB claim. Source cap may grow only for explicit
reviewed API methods with this unchanged allowlist. Any new input requires a
source fix, not a higher cap. Both token-tracker imports remain dynamic.

Cases audit proof now independently reads original user-actions API after create/update/comment, retains the raw API response, and checks every action source against the persisted workflow ID/name/run ID for ordinary and both runner backends. No worker-supplied ActionSource is admitted on the remote path.

## Agent trust and placement

The original heavy agent/template/conversation services remain a typed coordinator
business-service exception (original closure assessment:18.77MB/9114inputs,
including React SSR). Original schema-free input normalization and output/error
projection execute in the worker; authoring schemas remain original on coordinator.
Original API selectors/schema validation are not removed. The scope's persisted
definition must contain the named ai.agent step; coordinator resolves its output
limit with exact step > workflow > plugin >10mb precedence, including deliberate0
disabling. Request/result are checked there; result references are opaque,
run-owned and consumed once. Scope and step cancellation cancel original service
work. Original request authorization and workflow provenance come from coordinator,
not worker-supplied run/space/identity facts. No live events or handler context cross.

**Within its own run the worker is the trusted engine**, already holding that
run's credentials and referenced connector secrets. Worker-persisted RUNNING
rows cannot independently prove legitimate progress; no such admission claim or
invented call cap is made. Across runs/spaces/tenants the worker is untrusted.
Architectural mitigations belong to the multi-tenant PRD: tenant processes,
one run/process, short-lived credentials and disposal of secrets at lease end.
Original workflow timeouts and permissions remain the cost controls.

Agent first-use fixture uses an explicit typed-service response fixture to exercise
the real native normalization/projection, not to claim LLM/resource authz proof.
Live harness performs the original agent execution through real ES inference to
the loopback fake, independently reads conversation/event data and allowlisted
stored execution provenance, and asserts generic coordinator invoke0.

## Nightshift: partial family, not sixteen-step coverage

The additional Nightshift workload executes **only** the original pure
`nightshift.composeHydrateNotifications` handler (same function as the original
authoring definition), nonempty writer content plus an incomplete writer and
recalled-memory IDs. No coordinator business callback. Fifteen other Nightshift
types remain unfinished. The harness's `nightshift` family label must not be
read as full Nightshift service coverage.
