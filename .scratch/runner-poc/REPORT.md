# Remotable workflow runner PoC — continuation results

## Plain-language result

**The runner is quick once dispatched; credentials and Task Manager polling dominate the user-visible start.** On the final bundle, clean direct request→first-step medians are **759ms cold /724ms warm in a child process**, and **489ms renewed graph /557ms warm in-process** (n10 each). Separate scalar profiles measure dispatch→step **111ms cold /13ms warm** in the child; credential granting costs roughly **0.4–1second**, strongly dependent on security-index refresh phase and request cadence. The earlier ~1086ms request /977ms key /14ms dispatch observation is CONFIRMED at the original cadence (repeated medians1104/991/14.4ms), but REFUTED as an invariant across cadences/topologies. This is not a millisecond end-to-end execution API.

On a version-matched earlier full matrix, normal TM polling starts in roughly **2.8–3.2seconds**, with **1.9–2.4seconds median poll wait** in scalar profiles. Direct scheduling preserves the same TM credential/runner/identity machinery; it does not get its speed by bypassing authorization or durability.

**Idle is leaner than the total bundle:** ~**69.3MiB post-GC RSS**, ~48ms graph readiness, ~**499KB loaded ESM chunks**, no step/template/schema/i18n implementations. A simple execution loads **7.41MB**, down **838177bytes (10.16%)** after removing the remaining field-conversion→authoring-schema edge; no Zod/Joi in its loaded chunk contributions. The full unminified split bundle is still **9851499bytes**, versus ~19.3MB before earlier surgery. Remaining heavy deferred paths still make this a PoC, not a minimal production executor.

**Placement is a trade, not magic:** moving already-lazy data.map then data.filter to the real generic coordinator saves only1164/3322 total bundle bytes, with no meaningful idle RSS benefit. It adds602/608-byte by-reference requests (45/29-byte replies), even with128KiB prior output. No large context snapshot crosses. Cases remains coordinator-side; two data capabilities were the measured flips, not an unimplemented native Cases/Agent Builder experiment.

**Package rule:** split by LOAD-TIME COST CLASS, not package count: always-cheap status/runtime values; first-use synchronous template runtime; definition analysis precomputed on coordinator and shipped as plain metadata. Only the two previously approved runtime packages exist. This continuation separates pure JSON shape/default helpers from authoring constructors within the existing workflows package, with exact old-path reexports; no duplicate algorithms or sideEffects:false.

### Security-relevant finding: fast grant can defeat immediate revoke

A key granted with **refresh:false authenticates immediately**, but invalidation-by-id **before the next refresh returns HTTP200 with an EMPTY invalidated list**, and that key **continues authenticating200**. One recorded sample; stopped immediately, no safety/distribution claim. HTTP200 alone is not revoke proof. No product credential changes were implemented. Supervisor explicitly ruled to abandon this experiment and retain default granting; **no credential caching/reuse**.

Initial latency harness mistakenly treated invalidate HTTP200 as success. Corrected finding prominently:12 still-active probe keys were explicitly invalidated after normal refresh visibility (zero errors). Final independent query found **22 probe records,0 active,all invalidated**. Artifacts: `refresh-immediate-auth.json`, `credential-probe-cleanup.json`, `credential-probe-cleanup-verified.json`. This demonstrates immediate-revocation semantics, not a claim that TM's asynchronous cleanup is universally broken.

Future options ONLY, not implementations: short-expiration per-run keys with VERIFIED revocation; a dedicated short-lived scoped security/UIAM token (measured requirement for the multi-tenant PRD); raise invalidate-before-refresh with Elasticsearch security owners. Fresh refresh:false keys may also be absent from key listings until refresh.

### Other defects / remaining gaps

- Pre-existing **claim→engine-start recovery gap**: ordinary TM reclaimed a never-started run, but workflows failed it merely because attempt2. Approved shared CAS start barrier now permits only provably-unstarted replay; real before-barrier crash completes, after-barrier crash deliberately fails TaskRecoveryError. No arbitrary started-run replay or mixed-version recovery claim.
- Previous remote shortcut bypassed admission/current-access/service-account guards; corrected before headline measurement, including cooperative cancellation and shared failure processing.
- Real business assertions previously caught missing logs, wrong restricted-index internal identity, and stale search-visible steps despite completed execution; corrected without weakening authorization or checking only exit codes.
- Unsupported core parallel/HITL/child-workflow paths remain explicit refusals. Long-tail registered phases work via generic coordinator; **full every-workflow parity is NOT proven**. No production multi-tenant isolation/routing, remote network topology or rollout protocol.

## 1. Timing tables

All numbers local Node24.22.1/macOS, default credential granting. Median[p10–p90]; raw per-execution requests, persisted execution/step outputs, logs and scalar marks retained. Every headline sample asserts two correct outputs and persisted terminal workflow+step logs. **440 successful simple executions** across three matrices; first sample/profile retained but excluded, giving n10 analyzed/cell. No loader/seam/wire/GC instrumentation in clean timing runs.

### Final direct path (exact final bundle)

Artifact: `final-build.json` + `final-bundles/workflows/metafile.json`,9851499bytes. Source code tip8856b5ce973d. Raw `headline3-*/runs/*`; `headline3-summary.json` contains all components and spread/min/max, not just this table.

| Backend / path / host | Request→first step, ms (median [p10–p90]) | n |
|---|---:|---:|
| child process-direct-cold | 758.94 [746.83–786.76] | 10 |
| child process-direct-warm | 723.70 [706.20–899.30] | 10 |
| in process-direct-cold | 488.90 [419.00–675.24] | 10 |
| in process-direct-warm | 556.98 [505.84–617.24] | 10 |

Separate scalar-only profiles, medians in ms (n10 each):

| Backend / path / host | Create execution | Grant credential | Persist task after grant | Persist→runner | Start barrier (CAS write) | Lease/renewal/wait | Dispatch→first step |
|---|---:|---:|---:|---:|---:|---:|---:|
| child process-direct-cold | 15.52 | 506.59 | 16.29 | 24.70 | 9.63 (8.73) | 50.36 | 110.71 |
| child process-direct-warm | 14.90 | 515.01 | 15.77 | 24.70 | 9.54 (8.67) | 3.44 | 13.18 |
| in process-direct-cold | 17.35 | 403.67 | 15.69 | 22.63 | 9.79 (8.96) | 1.95 | 12.63 |
| in process-direct-warm | 14.72 | 397.68 | 16.68 | 25.29 | 9.73 (8.80) | 3.40 | 12.95 |

Child cold engine import median57.55ms; warm0.015ms. In-process renewed graph retains coordinator module cache: import ~0.02ms, **not a fresh Node/module-cache cold start**. Child cold host means maxRuns1 renewal, including old-host retirement+new root boot on lease acquisition; index0's readiness-precreated host excluded. Warm=maxRuns1000. Max age1hour, capacity1.

### Version-matched direct versus normal Task Manager (prior full matrix)

Pinned artifact: `dependency-plan-final-bundles/workflows`,9850702bytes, before the contained field-conversion split (commit36787b7). Same2.5s quiet-gap method as final direct recheck. Do not subtract old TM medians from new direct medians as an exact causal improvement.

| Backend / path / host | Request→first step, ms (median [p10–p90]) | n |
|---|---:|---:|
| child process-direct-cold | 982.81 [954.20–1001.86] | 10 |
| child process-direct-warm | 926.84 [917.92–950.76] | 10 |
| child process-task manager-cold | 3201.17 [2460.28–3339.34] | 10 |
| child process-task manager-warm | 3213.59 [2995.86–3369.87] | 10 |
| in process-direct-cold | 230.09 [119.03–1119.73] | 10 |
| in process-direct-warm | 495.27 [447.51–511.36] | 10 |
| in process-task manager-cold | 3140.75 [2913.62–3347.56] | 10 |
| in process-task manager-warm | 2808.17 [2568.35–2949.98] | 10 |

Separate scalar component medians (n10 each):

| Backend / path / host | Create execution | Grant credential | Persist task after grant | Persist→runner | Start barrier (CAS write) | Lease/renewal/wait | Dispatch→first step |
|---|---:|---:|---:|---:|---:|---:|---:|
| child process-direct-cold | 15.75 | 717.57 | 16.57 | 25.66 | 9.95 (8.82) | 49.77 | 123.87 |
| child process-direct-warm | 14.06 | 770.02 | 18.56 | 27.01 | 9.82 (8.77) | 3.33 | 14.02 |
| child process-task manager-cold | 14.22 | 484.48 | 16.01 | 2412.52 | 9.60 (8.30) | 52.97 | 124.16 |
| child process-task manager-warm | 16.71 | 657.26 | 16.35 | 1949.90 | 10.14 (8.75) | 0.13 | 13.48 |
| in process-direct-cold | 13.43 | 918.67 | 16.35 | 24.31 | 9.85 (8.82) | 1.04 | 12.31 |
| in process-direct-warm | 13.64 | 125.92 | 15.57 | 26.98 | 10.25 (9.20) | 1.38 | 13.37 |
| in process-task manager-cold | 15.59 | 685.36 | 16.14 | 1919.97 | 10.29 (8.93) | 0.99 | 14.85 |
| in process-task manager-warm | 16.07 | 863.45 | 16.35 | 2210.89 | 10.13 (8.66) | 0.17 | 14.24 |

Complete poll-wait, worker-receive, IPC, engine-import/setup and component p10/p90/min/max are in `headline2-summary.json`; every raw mark includes ids for independent recomputation. The barrier is INSIDE shared admission; engine import/setup INSIDE dispatch→step. These are nested components, NOT numbers to add or independently subtract. External route overhead is included in request→step, not all component columns.

### Timing method and limitations

- External client epoch performance clock→authoritative persisted first-step startedAt (1ms precision); scalar first logical step mark separately. Same-machine monotonic epoch clocks. Startup of source Kibana itself is setup, never called workflow latency.
- Clean and scalar distributions are separate sequential profiles, **not paired overhead experiments**. Refresh-phase/cadence aliasing materially changes grant duration: do not infer topology speedups from key-phase differences or claim cold is intrinsically faster in-process.
-2.5s between validated runs reduces previous-lease teardown wait to low milliseconds; earlier `headline-*` baseline has no gap and shows up to~1s loopback lease waiting. Retained, not silently discarded. End-state persistence can precede RPC return/lease release.
- No schema/loading hook in headline profiles. Heavy loaded-module tracing measured separately. Original single ~1.1s/~977ms/~14ms observation and repeated original-cadence distribution are preserved.

## 2. Credential investigation and options

Source: workflow run API→engine execute/createAndPersistWorkflowExecution→ `lib/schedule_workflow_run_task.ts` (cloneApiKey:true, normal/direct)→TaskStore.schedule→grantApiKeysFromRequest→EsApiKeyStrategy→ `lib/api_key_utils.ts:createApiKey` → security.authc.apiKeys.grantAsInternalUser→ES security.grantApiKey. Default refresh omitted; existing refreshApiKey:false option forwards refresh:false. Basic/session callers get fresh per-run keys; fake/API-key paths follow existing clone semantics. No identity/hydration/recovery/invalidation code changed here.

Scheduled workflows already retain an encrypted key on their **workflow:scheduled TM task**, created by `workflows_management/server/tasks/workflow_task_scheduler.ts`, with editor identity; schedule updates regenerate it. NOT a generic credential on the workflow document. Immediate resume tasks also retain per-execution credentials. Reusing the editor's key for another manual caller would change principal: rejected.

| Option | Benefit | Cost / ruling |
|---|---|---|
| Existing fresh key, refresh:false | Direct alternating ES n10/default vs n10/false:~1s vs11–22ms | Immediate revoke fails before refresh; STOPPED, rejected after conditional approval |
| Reuse scheduled task key | Removes grant from manual request | Wrong principal, absent for unscheduled workflow, coupled revoke/rotation; rejected |
| Persist caller/workflow-scoped reusable key | Amortized grant | New identity, revocation, privilege drift, secret ownership semantics; not implemented |
| Pre-mint / short-lived scoped token | Removes grant from click path | Bounded unused stock, expiration, scope and revocation proof required; security/UIAM option only |
| ES-side grant/visibility investigation | Could help all consumers | Escalate measured invalidate-before-refresh behaviour; do not tune cluster merely to flatter runner |

Raw alternating latency samples `credential-es-latency.json`; concurrent with final cell of FIRST matrix (not uncontended final data). All probe keys now verified invalidated. Earlier caption claiming successful immediate invalidation was explicitly corrected in LOG.

## 3. Idle and per-execution loading

| State | Loaded ESM chunk bytes | Contributing source inputs | Evidence |
|---|---:|---:|---|
| Idle host |499428|320|field-conversion-loads/idle-loads-analysis.json|
| Simple two data.set steps |7408463|1725|field-conversion-loads/simple-loads-analysis.json|
| Chosen if branch +wait/park/resume+native ES+Cases |7435712|1738|field-conversion-branch-loads/completed-loads-analysis.json|

Independent fresh hosts for simple/branch. Idle has only engine/data-provider/catalog shells: zero logical step/template/schema/i18n implementations. Simple adds only data.set (+engine timeout/helpers); branch adds only reached if/wait/ES/custom/Cases implementations. Untaken Security alert_graph_step remains unloaded; data.map/filter and unsupported workflow/HITL implementations also absent. Scalar node-resolution/import marks match reached nodes. `execution-load-validation.json` asserts the exact observed sets; `check_execution_loads.ts` reproduces it.

**Bound, not overclaim:** Node ESM loader sees loaded chunks; source contribution mapping does NOT prove every bundled CJS wrapper evaluated. Warm pooled hosts retain their prior reached-module cache, not unload between executions. Per-run fresh-host proof / newly reached additions is not “only current run code remains resident” after heterogeneous prior runs.

Contained split moved plain builtin JSON input registry, JSON shape constants/guard and manual-trigger predicate away from Zod constructors; public modules reexport exact same objects/functions. New field-conversion closure guard verifies no authoring construction. Loaded reduction838177bytes versus prior8246640; TOTAL bundle increased797bytes (chunk/compatibility overhead), not a bundle-size win. No third package, no sideEffects:false.

Business outcomes after extraction: `field-conversion-branch-loads/outcome/validation.json` (child,26logs) and `field-conversion-loopback/outcome/validation.json` (source clients,no raw worker credential env,30logs): correct selected branch, observed durable park, native ES hit, real persisted case title, untaken step absent. Source-loopback extra map harness reached business assertions but omitted required seam-path argument; retained failure, not counted as full seam validation.

## 4. Placement experiment and budgets

Cumulative executor contribution selection→existing generic coordinator fallback, real registered handlers, no mock handlers/new placement API. Actual source manifest restored byte-for-byte in finally. Three business-validated executions/variant,128KiBseed, correct map/filter outputs,18logs each. Idle separately sampled n3 with explicit GC. Raw `placement-{native,map-coordinator,map-filter-coordinator}-retry2/{build,idle}.stdout`, outcome directories, companion `*-retry2-live/{timing,seam,wire}.jsonl`; recomputed/asserted `placement-summary.json`.

| Placement | Bundle bytes (delta) | Idle RSS MiB median | Graph ready ms median | First cold dispatch→seed ms | Warm app JSON/run |
|---|---:|---:|---:|---:|---:|
| Native map+filter |9851499|69.281|48.315|118.88|1087|
| Map coordinator |9850335(-1164)|69.328|46.752|118.92|1734|
| Map+filter coordinator |9848177(-3322)|69.344|45.532|120.02|2371|

RSS/readiness differences too small/n3 to attribute causally. Already-lazy handlers do not affect idle initialization. First step is common seed, not map/filter: no claim placement sped that later handler. App totals exclude standalone dependency-plan diagnostic already within run request; actual IPC serialized envelope+newline totals are separately recorded per sample (exclude OS framing, include cleanup until next request; last window includes host stop). Generic request/reply:map602/45bytes; filter608/29bytes. Request budget2048bytes remains met despite131072bytes prior output.

New `src/dev/remote_bundles/budgets.test.ts` builds real graph and asserts:
- total JS<=10,000,000bytes (measured9851499,~1.5%headroom);
- idle post-GC RSS<=80MiB (measured~69.3,n3; local Node24/macOS PoC ceiling, not portable fleet calibration);
- exact idle implementation roots==engine/data-provider/catalog shells; loader-mapped idle source set excludes all steps/templates/schema/i18n;
- UI/full-lodash guard rejects EUI/charts/emotion/React/ReactDOM/lodash/lodash-es/fp entrypoints, including negative fixtures;
- existing runtime-package exact closure checks remain; new field-conversion authoring exclusion guard passes.

No blanket budget raise or side-effect hiding. Placement did not justify moving the heavy Cases implementation into the worker or implementing new sync→async APIs. Initial two placement attempts failed harness API-create routing/payload400; both retained. Successful artifacts explicitly retry2. Raw map-only seam counter typo corrected by independently deriving expected602byte invoke from complete raw arrays in summary, not by altering workflow behaviour.

## 5. Validation, reproduction, review, cleanup

Continuation commits: **1e7a94129e74** pure field-conversion graph split; **8856b5ce973d** measured bundle/idle budgets and dependency guard tests. Eleven source/test files; enumerate via `git diff --name-only 36787b7..8856b5c`. No credential product code changed, no push/PR.

Validation artifacts:
- native documented bootstrap passed:continuation-bootstrap.log;
- workflows input conversion/builtin compatibility:2suites61tests (field-conversion-tests.log);
- context/runtime regression:2suites117tests (field-conversion-engine-tests.log);
- final tooling:5suites32tests (final-tooling-tests.log); rerun --detectOpenHandles also32passes/no remaining handle report (final-tooling-open-handles.log). Initial ordinary run warned about delayed Jest exit; retained, not suppressed;
- engine remote:6suites32tests (final-remote-tests.log), including2048byte reference seam budget;
- scoped workflows, engine and tooling typechecks pass; read-only lint for all11changed files and git diff --check pass;
- execution-load assertions and placement-summary assertions pass; all440headline executions and9placement outcomes independently persisted outputs/logs.

Reproduction scripts remain under this scratch directory: `start_profile.ts`, `benchmark_start.ts`, `run_headline{,_quiet,_final}.sh`, `summarize_headline.ts` (prefix headline/headline2/headline3); `run_placement.cjs`, `validate_placement.ts`, `summarize_placement.ts`; `analyze_loads.cjs`, `check_execution_loads.ts`. Build final CLI from src/dev/remote_bundles/cli.ts with esbuild packages external; execute generated CLI workflows <outdir>. Do not rerun the unsafe refresh:false probe against shared infrastructure.

**Review gate remains open:** executor has no independent review tools; parent owns required AgentReview of76c4dcfb..HEAD and final acceptance. No fabricated reviewer verdict, no ready/completed state mutation. Self-review found no new code blockers; remaining full-parity/production limitations above are explicit. Source/test edits committed; scratch raw evidence intentionally retained untracked. No staged files.

**Cleanup done:** verified0active probe keys; stopped only worktree-owned Kibana/ES process trees after confirming commands. Both5634/9234ports no longer listen (services-cleanup.json, pid.stopped.json files). No service/data deletion. No right-hand complete, push or PR.

## Second independent review follow-up (54125b40 baseline)

Five findings verified/fixed; detailed verdicts/negative evidence in LOG.md's second review entry. Primitive contract that fell out of real use: **scope lifetime is a cancellation signal**. Core scope lookup exposes an AbortSignal ending on explicit scope/lease teardown, host stop, or transport failure (including IPC send failure/child death). Any coordinator capability can observe it; WorkflowStepRunner subscribes per invocation and removes the listener in finally. Scope state/controllers are removed idempotently; handler cancellation remains cooperative, not external rollback. In-process hosts now dispose their executor root before closing ports; failed binding construction closes startup resources.

Recovery alone establishes step-index search visibility before treating bounded count=0 as absence. The realtime execution-document start barrier remains primary; failed/partial refresh cannot authorize replay. Normal dispatch adds no index refresh. Coordinator handler/start/poll now recheck cancellation after async context preparation; onCancel remains intentionally callable under cancellation.

Final validation:183 focused tests (Core31, engine/recovery/repositories119, tooling33); scoped Core API/internal+engine types, lint/diff checks pass. All five negative tests fail before their fix (review2-before-*.log). Final bundle9,852,666bytes. Persisted representative outcomes pass on child and loopback with park/resume/native ES/Cases and26/30logs (review2-final-child/outcome, review2-loopback/outcome). Before-barrier SIGKILL replays/completes SAME run; after-barrier SIGKILL still fails TaskRecoveryError without dispatch (review2-{before,after}-crash/validation.json). Warm child/direct clean-only n10 recheck median341.29ms [p10 333.52,p90 359.07], no attributable latency change claim across independent restarted security refresh phases. No full matrix repeated. Owned ES/Kibana stopped; ports9234/5634unreachable (review2-services-cleanup.json). No push/PR/completion mutation; parent retains independent review gate.
