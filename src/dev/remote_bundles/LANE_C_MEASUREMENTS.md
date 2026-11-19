# Lane C: context-engine feedback (partial family)

Only `context-engine.getFeedbackContext` is carved out. The other five context-engine
steps and subsequent assigned families remain unfinished. No full-lane completion claim.

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
