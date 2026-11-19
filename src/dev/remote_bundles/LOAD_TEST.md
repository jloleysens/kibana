# Local workflow offload load test

Development-only harness. Requires an isolated source Kibana on 5634 and ES on 9234,
with the standard local development accounts. Never point this at shared infrastructure:
it creates workflows, connectors, an index and Cases. Connector secrets are fake;
owned HTTP/LLM fakes listen on 127.0.0.1:9934 (30ms response delay).

Build `load_test.ts` and `load_metrics.ts` with esbuild (platform node, packages external,
format cjs), placing generated scripts under ignored `.scratch/`. Start Kibana with
`NODE_OPTIONS=--require=<absolute generated load_metrics.cjs>` and
`KBN_LOAD_METRICS=<absolute profile directory>/metrics`. Signal ONLY the actual HTTP
listener, not its source-development launcher. The harness finds that PID with lsof.

Run the generated load-test script with:

```
node <load_test.cjs> <raw-output-directory> <profile-directory> 1,8 60000
```

Compare **remoteExecution.enabled:false** with **child_process remote execution**,
not the in_process RPC backend. Use identical definitions, concurrency, credential
policy, probe rate and payloads; record source revision, config, bundle and machine.
The single-host worker currently serializes leases: concurrency 8 measures that
queue as well as engine work. It is not an eight-worker throughput comparison.

## Fixed method

- Native: 1500 records, four data.map passes, ES search and conditional output.
- Long tail: HTTP, Jenkins spec action, ai.prompt (fake OpenAI), actual Cases creation,
  Kibana request and response assertion. Mixed concatenates both definitions.
- Prime each mix once, excluded; wait 3s. Start/reset metrics independently per cell.
- Closed-loop slots submit until at least 60s have elapsed, then drain every slot.
  At least 1200 probes per cell at 20Hz. Retain probe errors, never omit slow samples.
- Probe `/api/status` independently, with overlapping requests and a 30s timeout.
  The latency is request-to-full-response, not workflow completion latency.
- perf_hooks monitorEventLoopDelay resolution 10ms: p50/p99/max in milliseconds;
  eventLoopUtilization and process.cpuUsage user/system microseconds over matching
  signal-acknowledged windows. CPU is process-wide (including background work),
  not per-step attribution. Metrics writes/reset are outside the next window.
- Worker ps snapshots at 1Hz retain PID, PPID, cumulative CPU time and RSS KiB.
  Compare cumulative CPU differences **per PID**, never across host replacement.
- Each workflow must complete with expected native/AI outputs and a persisted Case
  read back through Cases API. Raw execution/step documents retained. Validation
  polling/step refresh/Case GET are inside the offered load in BOTH setups. Do not
  describe this as engine-only CPU or remove validation from only one profile.
- Report completion counts, duration, throughput; all probe samples and aggregate
  p95/p99; event-loop metrics, CPU totals and per-completion normalization. Report
  probe p99 spread over contiguous time blocks as well as the aggregate. A local
  1200-sample tail is not fleet calibration; repeat cells before claiming stability.

Keep raw data, methodology and results in ignored `.scratch/runner-poc/LOADTEST.md`.
Record source-version/cadence, external laptop interference and failed attempts.
Do not count coordinator dispatch as worker-native execution. This harness does
not itself establish step placement or cold first-use costs; use separate process/
module/seam instrumentation for those so headline load profiles stay comparable.

## Single-run network sensitivity (not a load-test result)

`KBN_REMOTE_MESSAGE_DELAY_MS=0|1|5|30` on Kibana opts into an artificial outbound
IPC delay; Core forwards it to child hosts. Each RPC frame incurs the configured
delay once in each direction. This is **one-way** delay, not RTT: an isolated
request/reply costs at least twice the value. Independent frames overlap instead
of being serialized. Init/ready fork control messages are not delayed. Teardown
cancels unsent frames; the default (unset or 0) allocates no delay timers.
Only `child_process` IPC is affected, not source-loopback or worker-thread ports.
The setting accepts integer milliseconds from 0 through 1000; invalid settings
reject before child allocation. Do not enable it in ordinary baseline profiles.

Compare one execution at a time with identical ordinary in-Kibana definitions,
cold and warm, retaining individual durations and spread at every delay. Count
coordinator calls by capability and step type in a separate instrumented profile;
flag per-item loop RPC and serial dependent calls. Network delay is not bandwidth,
packet loss, congestion, or proof of a production remote transport. CPU deltas
around async handlers remain process-wide; run without overlapping work and
report background noise rather than claiming thread-local attribution.

For memory containment, optional `remoteExecution.reuse.maxRssBytes` retires a
child after a lease closes its scopes if its RSS exceeds the ceiling. Sampling
uses actual RSS without forced GC. It does not stop an active run or cap its peak.
Shared-process backends do not apply a whole-process RSS retirement policy.

## Worker capability budgets

Total emitted JavaScript is measured in `bundle_size.json`, not an admission gate:
shared saved-object services are a worker data plane, not a reason to send extension
work back through Kibana. The workflow CLI's reporting threshold is 14,000,000 bytes
(measured original saved-objects/uiSettings union: 12,687,273, plus about 10% headroom).
Exceeding it is reported, not silently discarded or treated as a build failure.

Blocking guards remain: engine-only idle loaded set and idle RSS; no UI or aggregate
lodash inputs; 256 KiB exclusive static closure per contributed step. The approved
2 MiB incremental post-GC execution-heap guard and per-shared-capability first-use
byte/heap/latency ceilings still require execution measurement and enforcement;
module bytes alone do not establish them.

`source_digests.json` records selected contribution kinds' original source closures
(including deferred imports), with repository-relative paths and normalized line
endings. The workflow CLI selects `core.savedObjects.types`. It never imports those
factories to calculate a digest. This is build metadata, **not yet a per-lease parity
check**: admission must additionally compare build identity, coordinator-completed
migrations and live mappings/model-version metadata before a worker writes saved
objects. Unverifiable non-builtin external dependencies are rejected for a digested
closure; esbuild's synthetic helper runtime is covered by build identity instead.

### Inference endpoint subset

`inference_budgets.test.ts` executes original prompt (plain/structured), summarize
and classify handlers against an OS-assigned loopback fake. Shared inference first
use includes the original client, LangChain, byte-size parsing, and one real model
response: measured 34,526,328–34,539,272 heap bytes / 142–242 ms in three samples.
Ceilings: 36 MiB heap, 300 ms, 11,500,000 loaded JS bytes (measured 10,426,074).
Each handler still has the original 2 MiB exclusive post-GC and 256 KiB static
closure limits. SDK adapters load only when selected. Idle guards are unchanged.

These three types are **partially native**, not fully carved out: ES inference
endpoints run locally; legacy stack connector backings retain their existing
placement pending native legacy executors. Persistent-replacement anonymization
is not admitted: no encryption keys cross. Ordinary regex masking temporarily
calls the coordinator's original isolated Piscina helper. Scalar timing records
include payload byte counts and process CPU during each wait (not exclusive CPU).
Follow-up: bundle worker-thread/sidecar assets so the executor can own that pool.
