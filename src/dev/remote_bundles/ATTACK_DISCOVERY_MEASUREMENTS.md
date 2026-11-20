# Attack Discovery — partial native placement

Delivered: `defaultValidation` and `defaultAlertRetrieval`. Generation, persistence,
run, and the later lane-C families remain unfinished. No native saved objects.

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

## Original async run lifetime (not yet relocated)

The original engine stops a step's monitor when its async handler returns. Later
workflow cancellation does not abort that completed step's retained signal.
A future coordinator-owned async pipeline must preserve that original gap, survive
normal lease close, and use the original coordinator request, not dispatch keys.
No invented retained-work cap or new shutdown cancellation is approved.
