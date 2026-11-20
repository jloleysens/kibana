# Attack Discovery — native handlers and typed domain services

Delivered: all five original handlers. `defaultValidation` and `defaultAlertRetrieval`
algorithms execute natively. Generation, persistence and run use narrow typed original
coordinator operations; not native business services. No native saved objects.
Other lane-C families are tracked separately.

Both original algorithm factories are shared with the registered definitions.
Validation uses native scoped ES plus coordinator-owned original request
authentication/space/connector policy. Retrieval uses native ES, query construction,
metadata normalization, anonymization and replacement accumulation. Its original
Actions client is scoped on the coordinator, referenced opaquely through the query,
and released on completion/error/scope abort. Workflow loggers and plugin diagnostics
remain distinct; plugin diagnostics are batched, not replayed as workflow events.

## Shared `esqlParser` (explicit supervisor approval)

Consumers: storage-adapter's dynamic ES|QL path and Attack Discovery retrieval.
Inference references the parser in source, but its current emitted static closure
excludes it. The budget test checks emitted imports/bytes, not just metafile inputs;
if that changes, inference accounting must be revisited. Its existing 36 MiB
first-use ceiling is unchanged. Do not subtract parser heap from that measurement.

Calibration: three independent fresh processes; load only the engine roots, force
GC, import original `injectMetadataId` through the runtime-only public root and
original `correctQueryWithAst` through its defining module, execute both, force GC.
The diagnostic graph adds only lazy entry points for these two original functions
so they share the production graph's actual parser module. No duplicate parser.
Inputs: `FROM fixture | KEEP message` and
`FROM fixture | EVAL rounded = DATE_TRUNC("1 year", @timestamp)`.
The correction sample asserts today's unchanged output/zero corrections, not an
invented correction (the original currently treats the parser's empty errors array
as truthy). No original parser/correction algorithm changed.

| Metric | Three calibration samples | Ceiling |
|---|---|---|
| Retained heap, bytes | 5,862,448 / 5,862,552 / 5,862,552 | 6,500,000 |
| Loaded JS bytes | 1,390,736 each | 1,530,000 |
| First use, ms | 47.397 / 47.528 / 47.642 | median of three <= 55 |

Heap/JS headroom: 10.9% / 10.0%; latency: 15.4%. This matches existing shared
capabilities' modest approximately 10–15% headroom. Timings are exploratory, not
stable performance claims. New consumers/imports are visible in the guard's
explicit consumer list; no general per-step or idle ceiling changed.

Before sharing, retrieval's actual first ES|QL response/normalization/anonymization
used 6,204,336–6,210,848 retained bytes and correctly failed the 2 MiB step gate.
After the parser baseline, open the original native ES SDK and obtain its first
HTTP response, then execute the original retrieval step including its first query
and anonymized result: exclusive heap 915,488–915,816 bytes. The same processes
also execute the original exact-ID search path. Validation's engine+SDK-only cold
first execution is independently guarded. Static per-step 256 KiB, exclusive
2 MiB, exact shell, no UI/aggregate lodash and idle gates remain unchanged.

Run: `node scripts/jest src/dev/remote_bundles/attack_discovery_budgets.test.ts --runInBand`.
Fakes bind OS-assigned loopback ports and close in `finally`. These compiled probes
are not authorization proofs; separate real persisted workflows exercise both
backends and ordinary Kibana, including nondefault space, errors, replacement
reuse, and field-by-field ordered workflow log comparisons. Child-process tracing
is the previously approved single workflow-event gap; no business fields excluded.

## Remaining three handlers

Original generation and persistence domain candidates, after identical per-method
lodash narrowing, exceed the unchanged 256 KiB exclusive static gate on the actual
production graph: 705,003 and 1,246,549 bytes respectively. These are static closure
measurements, not first-execution heap measurements. No shared consumer invented.
Their original thin handlers execute in the worker; original graph/prompt/Actions/SO
and rule-registry authenticated-user stamping/storage stay on the coordinator.

The run handler keeps original defaults, workflow configuration and output/error
projection worker-local. The original orchestration, scoped services, live per-space
policy, managed-workflow integrity, analytics and event logger stay on the coordinator.
All three use scope-owned opaque references where needed; retries/parallel calls get
independent references. Original default definitions share the same handler factories.

Three independent engine-only cold processes per handler, including first valid
response: generation 168,616–168,760 bytes, persistence 167,728–169,600 bytes,
run 168,448–170,128 bytes. Compiled typed fixtures are not authorization proofs.
No SDK/shared capability loaded just to hide exclusive cost. Existing 2 MiB,
256 KiB, idle, shell, parser and emitted-inference guards remain unchanged.

## Original async run lifetime

The original engine stops a step's monitor when its async handler returns. Later
workflow cancellation does not abort that completed step's retained signal.
Coordinator reference cancellation follows the original signal only while pending;
normal return detaches it. Scope/lease/host close and later cancellation cannot stop
that completed async pipeline. Bookkeeping is released on return or settlement;
there is no invented retained-work cap or new shutdown cancellation.

The POC has no separately minted dispatch-only API key: it forwards the original
restored run-user authorization. A prior requirement to survive revocation of such
a key was withdrawn. Background work captures the original coordinator request and
services, never worker headers, and preserves exactly the original credential lifetime.
The original fake-request pipeline-key policy is unchanged; no new credentials.

The original pipeline deliberately schedules sub-workflows, preserving tracking
order and UI visibility. Coordinator-authored scheduled execution IDs reserve only
existing bounded nested-host capacity while the parent lease is active; no execution
or task field is persisted. Single-use reservations disappear on parent release.
Async background dispatch after that uses ordinary admission. Neither capability
ancestry nor reservations confer identity, progress admission or resource authority.

Real both-backend and ordinary proofs independently read nonempty attacks, duplicate
counts, scheduled handover, sync/async outcomes, nested step outputs, six ordered
Attack Discovery event-log documents per pipeline and authenticated tracking API
results. Every normalized field matches the ordinary engine. Child async completes
after its outer host retires. Public workflow log API also returned nonzero documents
and exact nontrace field/order equality; the supervisor requested re-proof after an
incoming shared writer repair, so that workflow-log acceptance remains pending.
