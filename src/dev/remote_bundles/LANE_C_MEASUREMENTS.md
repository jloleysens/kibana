# Lane C: context-engine and significant-events (partial lane)

All six context-engine steps and both significant-events steps are routed. Primary placement
is typed coordinator capability: native handlers are not native business services. Attack-discovery,
alerting, entityStore and eight flag-enabled extras remain unfinished. No full-lane completion claim.

## Placement

The original handler's flag ordering, output projection and specific error translation execute
in the worker. Its original `buildFeedbackContext` domain operation remains coordinator-side,
using the original AI-index registry and a caller-scoped ES client/improvements service.
The RPC accepts only scope + AI-index ID, never a request, space, client, definition or context.
The coordinator supplies the request/space from its scope. No generic handler invocation.

Native feasibility was measured before choosing this exception: original feedback selection,
ESQL/KQL, schemas, briefing and improvements store added **9,584,216–9,585,896 B post-GC**
after the original native ES SDK's first response; 2,541,370 incremental loaded JS bytes.
That exceeds the unchanged 2 MiB exclusive-step heap gate. Calling this a new shared
capability with only one actual worker consumer would conceal the step's cost; rejected.
No new shared budget or always-loaded provider was added. Native saved objects remain unwired.

The final thin handler measures about 59 KB on first response, following the existing
native ES initialization phase. The business service is **not** included in that number;
it runs on the coordinator. Subsequent cached calls are separately reported. These are
exploratory measurements, not stable latency comparisons or combined-process memory claims.

## Reproducible checked gates

```sh
node scripts/jest src/dev/remote_bundles/context_engine_budgets.test.ts --runInBand
node scripts/jest x-pack/platform/plugins/shared/context_engine --runInBand
```

The compiled production-graph probe checks both nonempty and empty service responses,
the unchanged 2 MiB exclusive heap limit, and absence of the coordinator analysis/store
implementations from the worker graph. Its explicit typed-service fixture is not a live
business/authz proof. The original context-engine suites cover the actual domain algorithms.
The existing complete tooling suite still checks idle engine-only roots/RSS, exact shell
inputs, forbidden UI/broad-lodash dependencies, and 256 KiB static contribution limits.

## Live evidence

Ignored artifacts: `.scratch/runner-poc-lane-c/`. `sealed-child/` and
`sealed-in-process/` contain the final typed-placement persisted proofs, original step documents,
independent ES outcome GETs, PID/timing markers and seam logs. Each backend runs twice with
both a nonempty classified-signal result and an empty result in a dedicated nondefault space.
No injected/fake Kibana or ES business service. The earlier `feedback-bundle*`, native-candidate
curves and initial proofs describe a rejected placement, not the final implementation.

Only ES/Kibana 9234/5634 are used. Unit fake listeners use OS-assigned loopback ports.
The total on-disk graph remains reporting-only; native handler counts must not be confused
with native business-service placement. Full quiet measurements belong to the merged phase.

## Significant events

Both original definitions share their native thin handlers with the worker contributions. Original
model selection retains scoped inference/SO/uiSettings policy; original classification retains its
bounded RuleEvents/ESQL probe/baseline domain service. The coordinator receives only named business
input, obtains its original request and asCurrentUser ES client from the scope, and releases owned
classification cancellation references. No StepContext/Core proxy or generic handler RPC. The
classifier's explicit space_id is the original user-authored read target, not workflow provenance.

The original classifier candidate measured 20,206,736–20,210,856 B post-GC on three independent
engine-only processes after a nonempty first response: rejected under the unchanged 2 MiB ceiling.
Final thin handlers measure roughly 155–162 KB cold, with the domain service excluded honestly.
Original dependency-free model errors moved unchanged to the SAME lane-B-owned
@kbn/significant-events-runtime package; schema root/internal exports preserve constructor identity.
The complete runtime root has only its three own inputs and zero external dependencies.

`node scripts/jest src/dev/remote_bundles/significant_events_budgets.test.ts --runInBand` checks
actual compiled first responses and excludes coordinator policy/classifier modules.
`node scripts/jest x-pack/solutions/observability/plugins/significant_events --runInBand` covers
the original plugin and the new scope/cancellation/RPC boundary. These tests do not simulate live
authorization; ignored session4/final artifacts provide actual persisted business evidence.

The final proof compares original in-Kibana, child_process and in_process outcomes, missing-model
errors, and settled persisted log documents (all stable fields, in order). It also verifies the
public logs API and each document's nondefault spaceId. This exposed and fixed the shared remote
logger dropping the original space context; credentials, system-index authorization and the
best-effort log queue are unchanged. Read system logs only through the original internal identity.

**Tracing gap:** child_process has no active Task Manager/OTEL span; trace/transaction ids and TM
debug events are absent. In_process inherits the original transaction. Exact tracing-only event
counts are retained in final-summary.json; all remaining fields/order match after normalizing
run/step ids, timestamps and durations. Follow-up (multi-tenant PRD decision 10): propagate trace
context through dispatch and start a child span in the worker. No fabricated APM transaction.

Wait for the final log flush and ES visibility before stopping a proof server; a terminal execution
document can precede its final best-effort event batch. No stable latency/combined-memory claim.
