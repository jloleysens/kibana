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
