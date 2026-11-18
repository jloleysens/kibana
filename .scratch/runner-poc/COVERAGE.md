# Remote workflow parity coverage

Source: c188d7007079. Both backends use the same engine and async serialization boundary. No remaining explicit refusal for a locally supported core step, registered extension, action/spec connector, or storage source. Unknown registrations still fail normally.

## Counts and evidence strength

- **890 advertised step types + 33 cross-cutting capabilities = 923 supported routes/capabilities per backend; 0 identified runtime known issues per backend.**
- Categories: actions/spec connector: 741; extension: 111; core: 16; Elasticsearch request: 9; Kibana request: 13.
- Final four profiles:84 top-level terminal executions with persisted business assertions and durable logs; nine exact existing scenario bodies/profile (36 total). Two additional final-artifact native ES -> actual Case outcomes, one/backend. Spawned child executions are additional, not counted as top-level samples.
- **Not an assertion of890 independently exercised SaaS operations.** Most connector/extension rows rely on tested generic dispatch/context contracts and original handlers remaining in Kibana. Provider-specific integration/authentication results are not invented. Original440-assertion engine integration suite ran locally, NOT wholly remotely; nine source scenarios were reused remotely in every profile.
- Scheduled/event-triggered initial dispatch, every concurrency/parallel option, every HITL provider, and every registered handler's business logic were not each independently persisted in the final remote profiles; rows identify their shared-code/test evidence. No genuinely impossible capability was identified requiring a refusal. Independent review remains required.

## Inventory source / reproducibility

`parity-schema.json` is the real source Kibana `GET /api/workflows/schema?loose=false` response; `parity-step-types.json` enumerates the890 top-level step-union constants (not nested request-body enums or trigger types). `parity-connectors.json` records actual Actions connector types. All111 extension-only registrations in that runtime schema are enumerated below; disabled plugins are not runtime registrations in this measured configuration. Generated request/action variants each have their own row. Generator: `generate_parity_coverage.ts`.

## Evidence key

- **R**: `parity-final-{child,loopback,stream-child,stream-loopback}/outcome/`. `parity_real.ts` runs identical scenarios through normal APIs, real Core child_process or source-loopback, default credentials, ordinary TM resume. Each directory contains definitions, execution and step documents, notification assertions and validation.json. Controls/errors/timeout artifacts carry additional assertions beyond the compact validation.json.
- **X**: same profiles' `existing/`, `parity_existing.ts`: exact existing YAML bodies and business assertions from workflow_output, workflow_fail, wait_for_input, parallel, variables and output_eviction. Each source file/line/hash is recorded; only required API wrapper metadata changes.
- **N**: `parity-native-child/` and `parity-native-loopback/outcome/`; `parity_native.ts`: actual native ES hit1, fast data.set output consumed by coordinator Cases, actual Case GET title Native hits1.
- **G**: `server/remote/workflow_step_runner.test.ts`, `remote_node.test.ts` and the original NodesFactory/WorkflowExecuteStepImpl; coordinator phases load context by reference, preserve synchronous helpers and scope aborts.
- **C**: workflow_step_runner tests: describes registered spec connectors for the generic connector transport; keeps spec connector metadata for subactions; describes registered action connector subactions without rejecting non-spec types; executes a system connector without looking up a saved connector. Actual HTTP + Jenkins spec actions and HTTP HITL delivery also pass in R.
- **E**: workflow_step_runner test describes only requested Elasticsearch operations with scalar runtime metadata, never schemas; existing elasticsearch_action_step tests; native ES real N.
- **U**: `server/remote/workflow_executor.test.ts` source-named tests.
- **L**: existing `integration_tests/tests/`:28 suites440 tests pass, unchanged scenarios (local implementation regression, not wholesale remote proof).
- **Q**: `server/concurrency/`:4 suites61 tests pass; coordinator policy unchanged.
- **T**: `src/dev/remote_bundles/`:5 suites35 tests, real graph, both backends, unchanged closure/bundle/idle budgets.
- **P1**: `parity-p1-fast-negative.log` and `parity-p1-fast-positive.log`; engine test awaits in-flight execution references before a coordinator reads a fast native output; deterministic IO queue regression too.

All short server paths above are within src/platform/plugins/shared/workflows_execution_engine unless specified.

## Cross-cutting capabilities

| Capability | child_process | in_process | Evidence / qualification |
|---|---|---|---|
| Parallel static named branches + progress/park/resume | Supported | Supported | R: parallel-parked/parallel; U: persists parallel branch progress and gathers both branch outputs |
| Parallel dynamic fan-out, fail-fast/settled, max/count-waiting, branch timeout | Supported | Supported | L: parallel.test.ts (shared native implementation); static/nested real outcomes R/X; not every parallel setting independently persisted remotely |
| Short inline waits | Supported | Supported | R: controls.inline (1s); L: wait_step.test.ts |
| Long durable wait and new-host resume | Supported | Supported | R: parallel.durable + sync child.pause; U: parks a long wait and resumes the case from the saved graph output |
| HITL input/approval resumeInput + audit envelope | Supported | Supported | R: waitForInput/waitForApproval API resume and persisted response; U: parameterized parks %s and consumes resumeInput |
| HITL HTTP system/saved connector notifications + external resume links | Supported | Supported | R: *-notification.json proves owned HTTP delivery + populated link; C: saved/system connector dispatch; L: resume_notifications.test.ts and hitl_notifications helper suites |
| HITL email/Slack/Teams/ServiceNow channel adapters | Supported | Supported | Original lazy HITL adapters + C connector capability; existing hitl_notifications helper tests. Actual third-party delivery not exercised; no third-party credentials used |
| Sync child WAITING_FOR_CHILD + authenticated parent wake handshake | Supported | Supported | R: parent-parked/parent; G: existing WorkflowExecuteStepImpl + task scheduling capability; source unchanged child strategy |
| Async child dispatch + lineage/run-as/depth guards | Supported | Supported | R: async-parent; G: existing WorkflowExecuteStepImpl/async strategy; existing workflow_execute_step tests retain local policy |
| Step failure fallback/retry/continue together | Supported | Supported | R: errors: two actual failed requests, fallback recovered, final continued; wrapper docs distinguished by stepType |
| Workflow-level on-failure/fallback/retry/continue | Supported | Supported | L: on_failure_{retry,fallback,continue}.test.ts + error_handling_scenarios.test.ts; identical native graph/walker |
| Step timeout + continue + cooperative connector abort | Supported | Supported | R: timeout: persisted TimeoutError + downstream continued; C scoped abort signal |
| Workflow timeout cancellation | Supported | Supported | R: workflow-timeout: timed_out; L: workflow_level_timeout.test.ts |
| User cancellation | Supported | Supported | R: cancel: durable cancelled state, downstream never absent; U: cooperatively cancels a reached native step and releases its scope |
| Transport/scope cancellation and host disposal | Supported | Supported | G: aborts an active coordinator invocation on scope teardown without completing its external effect; U: aborts an active native step and closes clients when its host is disposed; T: both backend lifecycle suites |
| Child-start cancellation cleanup ordering | Supported | Supported | remote_node.test.ts: waits for a cancelled child-start phase to persist its id before reconstructing cancellation; original child onCancel reused |
| Concurrency key/max + drop | Supported | Supported | Q: concurrency_manager.test.ts; admission remains coordinator-side before remote dispatch; no engine-only bypass |
| Concurrency cancel-in-progress | Supported | Supported | Q: concurrency_manager.test.ts + U/G cooperative cancellation contracts |
| Concurrency queue, queue-size, queue-ttl and drain | Supported | Supported | Q: concurrency_manager/concurrency_queue_drainer/handle_queued_workflow_run_at_task_start/maybe_schedule_dormant_queued_run; same coordinator terminal post-loop path |
| Manual initial runs / direct dispatch | Supported | Supported | All R/X/N persisted real executions use normal API + authenticated TM self-claim/CAS barrier |
| Scheduled initial runs / ordinary Task Manager dispatch | Supported | Supported | Shared plugin workflow:run path calls same runWorkflow/dispatchWorkflow; shared admission/CAS tests + prior real TM timing profiles in REPORT. Final parity profiles did not create a fresh cron-triggered initial run |
| Event-triggered initial runs | Supported | Supported | Shared runWorkflow event guards in run_workflow.test.ts (cases.caseCreated) + same dispatch; parent/child trigger lineage real R. No new final external event initial-run artifact |
| Plain-index workflow storage | Supported | Supported | R/X both final plain-index profiles; native worker PlainIndexDataClient + source-loopback Core DAL |
| Data-stream workflow storage (versioning/metadata/legacy) | Supported | Supported | R/X both final stream profiles, .ds backing hits; executor_storage.test.ts: lazily reuses the coordinator DAL capability for data streams over loopback. EXACT initialized DAL, no worker clone |
| Synchronous handler context helpers + scoped identity | Supported | Supported | G: rebuilds synchronous context from persisted references without shipping a large prior output; N: native run-user ES + coordinator actual Cases; no raw worker env in source-loopback profiles |
| Durable extension start/poll/onCancel author state | Supported | Supported | G: uses persisted durable author state for poll and onCancel without a state snapshot in the DTO; cancellation-during-context-preparation tests for handler/start/poll; original durable poll algorithm remains worker-native |
| Variables/loop scope/output eviction and rehydration | Supported | Supported | X: exact variables/output_eviction/parallel nesting scenarios and original assertions; L: output_eviction + output_eviction_advanced suites; IO suite91 tests |
| Connector response transport size limits / max-step-size | Supported | Supported | C preserves isSpecConnector base metadata and original ConnectorStepImpl transport limits; L: response_size_limits.test.ts; no limit/budget increases |
| Kibana and Elasticsearch typed + generic request variants | Supported | Supported | N native elasticsearch.search -> one hit; R kibana.request; E requested ES metadata; original request builders and identity paths |
| Persisted workflow/step logs and errors | Supported | Supported | parity-final-artifact-validation.json:84 terminal runs, durable logs for each; per-run persisted outputs/state/errors independently checked; N adds two actual Cases/native ES outcomes |
| Execution reference persistence barrier | Supported | Supported | P1 engine negative fails before fix; current fast native -> coordinator sees exact current output; StepIoService queued flush awaits both step IO and execution refs |
| Workflow output token usage accounting | Supported | Supported | remote_node.test.ts: reloads only the completed node and accounts for output usage without repeating its phase; original StepExecutionRuntime.recordTokenUsage reused |
| Cancellation/timeout around parallel/loop/failure scopes | Supported | Supported | L: parallel, loop_control, timeout_retry_fallback_continue, cancellation and timeout suites; same native graph/scopes; R controls/timeouts/parallel persisted separately |

## Every advertised step / registered extension / connector action

| Step type | Kind | child_process | in_process | Evidence |
|---|---|---|---|---|
| `1password.getUser` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `1password.listUsers` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `1password.reactivateUser` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `1password.suspendUser` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `abuseipdb.bulkCheck` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `abuseipdb.checkIp` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `abuseipdb.getBlacklist` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `abuseipdb.getIpInfo` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `abuseipdb.reportIp` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ai.agent` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.attachment.add` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.attachment.delete` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.attachment.list` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.attachment.read` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.attachment.update` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.classify` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.conversation.add_event` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.conversation.add_user_message` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.conversation.create` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.conversation.metadata.patch` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.conversation.metadata.read` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.prompt` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `ai.summarize` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `alerting.create_alert` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `alienvault-otx.getIndicator` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `alienvault-otx.getPulse` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `alienvault-otx.getRelatedPulses` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `alienvault-otx.searchPulses` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `amazon_s3.downloadFile` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `amazon_s3.listBucketObjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `amazon_s3.listBuckets` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.cancelJob` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.getJob` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.getJobStdout` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.getJobTemplate` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.getJobTemplateLaunchOptions` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.getMe` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.launchJobTemplate` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.listHosts` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.listInventories` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.listJobEvents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.listJobTemplates` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.listJobs` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.listProjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `ansible_controller.request` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `aws_lambda.getFunction` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `aws_lambda.invoke` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `aws_lambda.listFunctions` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `azure-blob.getBlob` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `azure-blob.getBlobProperties` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `azure-blob.listBlobs` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `azure-blob.listContainers` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bedrock.bedrockClientSend` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bedrock.converse` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bedrock.converseStream` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bedrock.getDashboard` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bedrock.invokeAI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bedrock.invokeAIRaw` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bedrock.invokeStream` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bedrock.run` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bedrock.test` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bigquery.executeQuery` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bigquery.getQueryResults` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bigquery.listDatasets` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `bigquery.runQuery` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.aiExtractFreeform` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.aiExtractStructuredFromMetadataTemplate` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.aiQaHub` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.aiQaMultiFile` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.aiQaSingleFile` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.callTool` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.getComments` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.getFileContent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.getFileDetails` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.getFolderDetails` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.getHubDetails` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.getHubItems` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.listFolderContent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.listHubs` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.listRecentItems` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.listTools` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.searchByMetadata` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.searchFilesKeyword` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.searchFoldersByName` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `box.whoAmI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `brave-search.webSearch` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.callTool` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.cancelBuild` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.createBuild` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.createBuildAnnotation` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.getBuild` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.getJobLog` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.getPipeline` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.listArtifacts` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.listBuildAnnotations` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.listBuilds` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.listJobs` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.listPipelines` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.listTools` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.rebuild` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.retryFailedJobs` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.retryJob` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `buildkite.unblockJob` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `cases.addAlerts` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.addAttachments` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.addComment` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.addEvents` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.addObservables` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.addTags` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.assignCase` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.bulkDeleteObservables` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.closeCase` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.createCase` | extension | Supported | Supported | N: actual persisted Case; G: synchronous phase |
| `cases.createCaseFromTemplate` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.deleteAttachments` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.deleteCases` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.deleteObservable` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.findCases` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.findSimilarCases` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.getAllAttachments` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.getCase` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.getCases` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.getCasesByAlertId` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.pushCases` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.removeTags` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.setCategory` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.setCustomField` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.setDescription` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.setExtendedFields` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.setSeverity` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.setStatus` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.setTitle` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.unassignCase` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.updateCase` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.updateCases` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `cases.updateObservable` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `censys.censEyeCreateAnalysisJob` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `censys.censEyeJobResult` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `censys.censEyeJobStatus` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `censys.getCertificate` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `censys.getHost` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `censys.getHostEnrichment` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `censys.getHostHistory` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `censys.getWebProperty` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `censys.rescan` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `censys.scanStatus` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `confluence-cloud.getPage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `confluence-cloud.getSpace` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `confluence-cloud.listPages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `confluence-cloud.listSpaces` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `console` | core | Supported | Supported | R: gathered output; X: wait_for_input log |
| `context-engine.createKi` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `context-engine.deleteKi` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `context-engine.getFeedbackContext` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `context-engine.recordImprovements` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `context-engine.updateKi` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `context-engine.verifyKi` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `d3security.run` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `d3security.test` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `data.aggregate` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `data.concat` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `data.dedupe` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `data.filter` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `data.find` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `data.map` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `data.parseJson` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `data.regexExtract` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `data.regexReplace` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `data.set` | core | Supported | Supported | R: fast seed; X: nested variables/eviction; P1: stale-reference regression |
| `data.stringifyJson` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `datadog.cancelDowntime` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `datadog.createIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `datadog.getAlertEvents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `datadog.getMonitor` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `datadog.listMonitors` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `datadog.muteMonitor` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `datadog.postEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `datadog.queryTimeseries` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `datadog.scheduleDowntime` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `datadog.searchLogs` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `datadog.unmuteMonitor` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `datadog.updateIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dropbox.callTool` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dropbox.createSharedLink` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dropbox.getFileContent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dropbox.getFileMetadata` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dropbox.listFolder` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dropbox.listSharedLinks` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dropbox.listTools` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dropbox.search` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dropbox.whoAmI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.addProblemComment` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.closeProblem` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.createMaintenanceWindow` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.deleteMaintenanceWindow` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.getEntity` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.getEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.getMetricDescriptor` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.getProblem` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.ingestEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.listEntities` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.listEvents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.listMaintenanceWindows` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.listMetrics` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.listProblemComments` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.listProblems` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `dynatrace.queryMetrics` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `elasticsearch.bulk` | Elasticsearch request | Supported | Supported | E: requested-operation runtime metadata; same native request runner |
| `elasticsearch.esql.query` | Elasticsearch request | Supported | Supported | E: requested-operation runtime metadata; same native request runner |
| `elasticsearch.index` | Elasticsearch request | Supported | Supported | E: requested-operation runtime metadata; same native request runner |
| `elasticsearch.indices.create` | Elasticsearch request | Supported | Supported | E: requested-operation runtime metadata; same native request runner |
| `elasticsearch.indices.delete` | Elasticsearch request | Supported | Supported | E: requested-operation runtime metadata; same native request runner |
| `elasticsearch.indices.exists` | Elasticsearch request | Supported | Supported | E: requested-operation runtime metadata; same native request runner |
| `elasticsearch.request` | Elasticsearch request | Supported | Supported | E: requested-operation runtime metadata; same native request runner |
| `elasticsearch.search` | Elasticsearch request | Supported | Supported | N: native query returns one hit |
| `elasticsearch.update` | Elasticsearch request | Supported | Supported | E: requested-operation runtime metadata; same native request runner |
| `email` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `entityStore.updateAssetCriticality` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `figma.getFile` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `figma.listProjectFiles` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `figma.listTeamProjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `figma.renderNodes` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `figma.whoAmI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `firecrawl.crawl` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `firecrawl.crawlAndWait` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `firecrawl.getCrawlStatus` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `firecrawl.map` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `firecrawl.scrape` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `firecrawl.search` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `foreach` | core | Supported | Supported | R: controls (selected branch, exact loop counts/items, untaken steps absent) |
| `gcp_cloud_functions.getFunction` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_cloud_functions.invoke` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_cloud_functions.listFunctions` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.addIamPolicyBinding` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.createServiceAccount` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.createServiceAccountKey` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.deleteServiceAccount` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.deleteServiceAccountKey` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.disableServiceAccount` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.disableServiceAccountKey` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.enableServiceAccount` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.enableServiceAccountKey` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.getIamPolicy` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.getRole` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.getServiceAccount` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.listServiceAccountKeys` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.listServiceAccounts` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.queryGrantableRoles` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.removeIamPolicyBinding` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.setIamPolicy` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.testIamPermissions` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_iam.undeleteServiceAccount` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.accessSecretVersion` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.addSecretVersion` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.createSecret` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.deleteSecret` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.destroySecretVersion` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.disableSecretVersion` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.enableSecretVersion` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.getSecret` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.getSecretIamPolicy` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.getSecretVersion` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.listSecretVersions` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.listSecrets` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.setSecretIamPolicy` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gcp_secret_manager.updateSecret` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gemini.getDashboard` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gemini.invokeAI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gemini.invokeAIRaw` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gemini.invokeStream` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gemini.run` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gemini.test` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gen-ai.getDashboard` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gen-ai.invokeAI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gen-ai.invokeAsyncIterator` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gen-ai.invokeStream` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gen-ai.run` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gen-ai.stream` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gen-ai.test` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.addAssignee` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.addIssueComment` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.addLabels` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.callTool` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.createBranch` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.createIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.createOrUpdateFile` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.createPullRequest` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.getCommit` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.getFileContents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.getIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.getIssueComments` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.getLatestRelease` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.getMe` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.listBranches` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.listCommits` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.listIssues` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.listPullRequests` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.listReleases` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.listTags` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.listTools` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.mergePullRequest` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.pullRequestRead` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.requestReviewers` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.searchCode` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.searchIssues` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.searchPullRequests` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.searchRepositories` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.searchUsers` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.triggerWorkflow` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.updateIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `github.updatePullRequest` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.getAttachment` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.getMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.listLabels` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.listMessages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.markAsRead` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.markAsUnread` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.modifyLabels` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.replyMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.searchMessages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.sendMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.trashMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `gmail.untrashMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_calendar.freeBusy` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_calendar.getEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_calendar.listCalendars` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_calendar.listEvents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_calendar.searchEvents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_cloud_storage.downloadObject` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_cloud_storage.getObjectMetadata` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_cloud_storage.listBuckets` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_cloud_storage.listObjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_cloud_storage.listProjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_drive.downloadFile` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_drive.getFileMetadata` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_drive.listFiles` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_drive.searchFiles` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.advancedSearch` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getAnalysis` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getCollection` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getDomainRelationship` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getDomainReport` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getFileBehaviours` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getFileMitreAttackTechniques` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getFileRelationship` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getFileReport` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getIocStream` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getIpRelationship` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getIpReport` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getPrivateAnalysis` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getPrivateUrlReport` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getRelatedObjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getReportMitreAttackTechniques` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getUrlRelationship` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getUrlReport` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.getUrlScanReport` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.scanPrivateUrl` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.scanUrl` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.searchCollectionIocs` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `google_threat_intelligence.searchCollections` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.createAnnotation` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.createSilence` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.deleteAnnotation` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.deleteSilence` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.getAlertRule` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.getAlerts` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.getDashboard` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.getNotificationPolicyTree` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.getSilence` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.listAnnotations` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.listContactPoints` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.listMuteTimings` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.listRules` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.listSilences` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.searchDashboards` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `grafana.updateAnnotation` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `greynoise.getIpContext` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `greynoise.getMetadata` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `greynoise.quickLookup` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `greynoise.riotLookup` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `http` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `hubspot.getCrmObject` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `hubspot.listOwners` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `hubspot.listPipelines` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `hubspot.searchBroad` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `hubspot.searchCrmObjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `hubspot.searchDeals` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `if` | core | Supported | Supported | R: controls (selected branch, exact loop counts/items, untaken steps absent) |
| `inference.completion` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `inference.completion_stream` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `inference.rerank` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `inference.sparse_embedding` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `inference.text_embedding` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `inference.unified_completion` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `inference.unified_completion_async_iterator` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `inference.unified_completion_stream` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.cancelQuietDown` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.disableJob` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.enableJob` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.getBuild` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.getBuildTestReport` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.getConsoleLog` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.getJob` | actions/spec connector | Supported | Supported | R: transports (real registered spec connector, owned HTTP fixture) |
| `jenkins.getLastBuild` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.getQueue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.getQueueItem` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.listBuilds` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.listJobs` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.quietDown` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.request` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.stopBuild` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.triggerBuild` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jenkins.triggerBuildWithParameters` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jina.browse` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jina.fileToMarkdown` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jina.fileToRenderedImage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jina.search` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.addAttachment` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.addComment` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.addWatcher` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.assignIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.createIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.deleteIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.getAttachment` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.getCreateMetadata` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.getIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.getIssueTypes` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.getProject` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.getProjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.getTransitions` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.linkIssues` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.removeWatcher` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.searchIssuesWithJql` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.searchUsers` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.transitionIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-cloud.updateIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-service-management.closeAlert` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira-service-management.createAlert` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira.fieldsByIssueType` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira.getFields` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira.getIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira.issue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira.issueTypes` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira.issues` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `jira.pushToService` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `kibana.SetAlertTags` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kibana.SetAlertsStatus` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kibana.addCaseComment` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kibana.addCaseCommentDefaultSpace` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kibana.createCase` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kibana.createCaseDefaultSpace` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kibana.getCase` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kibana.getCaseDefaultSpace` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kibana.request` | Kibana request | Supported | Supported | R: kibana, errors; G: node phase |
| `kibana.streams.get` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kibana.streams.list` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kibana.updateCase` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kibana.updateCaseDefaultSpace` | Kibana request | Supported | Supported | G: node phase; original KibanaActionStepImpl |
| `kubernetes.applyResource` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `kubernetes.createResource` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `kubernetes.deleteResource` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `kubernetes.getPodLogs` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `kubernetes.getResource` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `kubernetes.listEvents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `kubernetes.listNamespaces` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `kubernetes.listResources` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `kubernetes.patchResource` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `kubernetes.request` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `kubernetes.scaleWorkload` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `loop.break` | core | Supported | Supported | R: controls (selected branch, exact loop counts/items, untaken steps absent) |
| `loop.continue` | core | Supported | Supported | R: controls (selected branch, exact loop counts/items, untaken steps absent) |
| `mcp.callTool` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `mcp.listTools` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `mcp.test` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `merge` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `microsoft-teams.createChat` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `microsoft-teams.getUser` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `microsoft-teams.listChannelMessages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `microsoft-teams.listChannels` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `microsoft-teams.listChatMessages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `microsoft-teams.listChats` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `microsoft-teams.listJoinedTeams` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `microsoft-teams.searchMessages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `microsoft-teams.sendChannelMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `microsoft-teams.sendChatMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `microsoft-teams.updateMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `misp.addAttribute` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `misp.addSighting` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `misp.addTagToEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `misp.checkIndicator` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `misp.checkWarninglist` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `misp.createEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `misp.getEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `misp.publishEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `misp.searchAttributes` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `misp.searchEvents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.archiveItem` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.callTool` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.changeItemColumnValues` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.createItem` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.createNotification` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.createSubitem` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.createUpdate` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.deleteItem` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.editUpdate` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.getBoardInfo` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.getBoardItemsPage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.getItem` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.getItemsByColumnValue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.getUpdates` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.listTools` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.moveItemToGroup` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.search` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `monday_com.whoAmI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.acknowledgeIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.createAlertPolicy` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.createDeploymentMarker` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.createMutingRule` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.createNrqlCondition` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.deleteMutingRule` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.listAlertPolicies` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.listIncidents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.listIssues` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.listMutingRules` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.listNrqlConditions` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.resolveIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.runNrqlQuery` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.unacknowledgeIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `new_relic.updateMutingRule` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `nightshift.composeHydrateNotifications` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.cortexHydrate` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.cortexOptimize` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.decisionTreeHydrate` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.decisionTreePrepare` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.decisionTreeReinforce` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.ensureInvestigationAgent` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.followUpRecoveredAlert` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.handleInvestigationFailure` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.memoryMaterializeToSandbox` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.memoryOptimize` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.obtainSandbox` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.renderSlackMessage` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.resolveModel` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.sendNotifications` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `nightshift.triggerInvestigation` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `notion.getDataSource` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `notion.getPage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `notion.queryDataSource` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `notion.searchPageOrDSByTitle` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.activateUser` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.addUserToGroup` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.clearUserSessions` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.deactivateUser` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.expirePassword` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.getLogs` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.getUser` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.getUserFactors` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.getUserGroups` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.listUsers` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.removeUserFromGroup` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.resetFactors` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.resetPassword` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.searchUsers` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.suspendUser` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `okta.unsuspendUser` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `one_drive.getDrive` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `one_drive.getFileContent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `one_drive.getFileMetadata` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `one_drive.getItemChildren` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `one_drive.getMe` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `one_drive.listRecentFiles` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `one_drive.listSharedWithMe` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `one_drive.search` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `opsgenie.closeAlert` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `opsgenie.createAlert` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `outlook.getAttachment` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `outlook.getMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `outlook.listAttachments` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `outlook.listFolders` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `outlook.listMessages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `outlook.searchMessages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.acknowledgeIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.addResponders` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.browseActivity` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.browseAlertGrouping` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.browseChangeEvents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.browseEscalationPolicies` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.browseEventOrchestrations` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.browseIncidents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.browseSchedules` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.browseServices` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.browseStatusPages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.browseTeams` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.browseUsers` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.callTool` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.listServices` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.listTools` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.manageAlertGrouping` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.manageEventOrchestrations` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.manageIncidents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.manageSchedules` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.manageServices` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.manageStatusPages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.manageTeams` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.resolveIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.runResponsePlay` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.triggerIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `pagerduty_mcp.updateIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `parallel` | core | Supported | Supported | R: parallel + branch park/gather; X: parallel.test.ts:1080; U: branch progress |
| `prometheus.createAlerts` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.createSilence` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.expireSilence` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.getPrometheusSeries` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.getSilence` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.getStatus` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.listAlertGroups` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.listAlerts` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.listPrometheusAlerts` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.listPrometheusLabelValues` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.listPrometheusRules` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.listPrometheusTargets` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.listSilences` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.queryPrometheus` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `prometheus.queryRangePrometheus` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `resilient` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.acknowledgeAlert` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.addIncidentSubscribers` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.assignIncidentUser` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.cancelIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.createActionItem` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.createIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.createTimelineEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.getAlert` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.getIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.listActionItems` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.listAlerts` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.listIncidents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.listServices` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.listSeverities` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.listTeams` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.mitigateIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.resolveAlert` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.resolveIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.triageIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `rootly.updateIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `salesforce.describe` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `salesforce.download_file` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `salesforce.get_record` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `salesforce.list_records` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `salesforce.query` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `salesforce.search` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `search.rerank` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.assignAlert` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.assignAttack` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.attack-discovery.defaultAlertRetrieval` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.attack-discovery.defaultValidation` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.attack-discovery.generate` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.attack-discovery.persistDiscoveries` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.attack-discovery.run` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.buildAlertEntityGraph` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.buildExceptionEntriesFilter` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.createExceptionListItem` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.createNote` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.createRule` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.createRuleException` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.deleteNote` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.disableRule` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.enableRule` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.getAlertEntities` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.getNotes` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.matchAttackFingerprints` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.patchRule` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.renderAlertNarrative` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.setAlertStatus` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.setAlertTags` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.setAttackStatus` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.setAttackTags` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `security.updateNote` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `sentry.assignIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.bulkUpdateIssues` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.createIssueAlertRule` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.deleteIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.getEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.getIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.ignoreIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.listIssueAlertRules` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.listIssueEvents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.listIssues` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.listProjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.resolveIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.unresolveIssue` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sentry.updateIssueAlertRule` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow-itom.addEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow-itom.getChoices` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow-sir.getChoices` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow-sir.getFields` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow-sir.getIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow-sir.pushToService` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.addComment` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.addWorkNote` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.closeIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.createEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.createIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.createRecord` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.createSecurityIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.deleteRecord` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.describeTable` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.getAttachment` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.getChoices` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.getComments` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.getRecord` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.listKnowledgeBases` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.listRecords` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.listTables` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.queryUsers` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.search` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.updateIncident` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.updateRecord` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.uploadAttachment` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `servicenow_search.whoAmI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.callGraphAPI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.downloadDriveItem` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.downloadItemFromURL` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.getAllSites` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.getDriveItems` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.getSite` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.getSiteDrives` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.getSiteListItems` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.getSiteLists` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.getSitePageContents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.getSitePages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-online.search` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-server.callRestApi` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-server.downloadFile` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-server.getFolderContents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-server.getListItems` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-server.getLists` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-server.getSitePageContents` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-server.getWeb` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sharepoint-server.search` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `shodan.countResults` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `shodan.getHostInfo` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `shodan.getServices` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `shodan.searchHosts` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `significantEvents.classifyDetections` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `significantEvents.resolveModel` | extension | Supported | Supported | G: handler/start/poll/onCancel by-reference contracts; original registered handler remains in Kibana |
| `slack` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.createConversation` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.getConversationHistory` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.getConversationInfo` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.getFileInfo` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.inviteToConversation` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.listChannels` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.listFiles` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.listUserConversations` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.listUsers` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.lookupUserByEmail` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.resolveChannelId` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.searchMessages` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.sendMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.updateMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack2.whoAmI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack_api.postBlockkit` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack_api.postMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `slack_api.validChannelId` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.cancelStatement` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.cortexSearch` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.describeTable` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.describeView` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.executeStatement` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.getStatementStatus` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.listCortexSearchServices` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.listDatabases` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.listSchemas` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.listTables` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.listViews` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `snowflake.runQuery` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `solarwinds_platform.acknowledgeAlert` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `solarwinds_platform.getAlert` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `solarwinds_platform.getNode` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `solarwinds_platform.listActiveAlerts` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `solarwinds_platform.query` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `solarwinds_platform.searchNodes` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sublime_security.getAsaVerdict` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sublime_security.getAttackScore` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sublime_security.getMessage` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sublime_security.getMessageGroup` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sublime_security.getTask` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sublime_security.listMailboxes` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sublime_security.quarantineMessageGroups` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sublime_security.restoreMessageGroups` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sublime_security.searchMessageGroups` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `sublime_security.trashMessageGroups` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `swimlane.pushToService` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `switch` | core | Supported | Supported | R: controls (selected branch, exact loop counts/items, untaken steps absent) |
| `tavily_mcp.callTool` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `tavily_mcp.listTools` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `tavily_mcp.tavilyCrawl` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `tavily_mcp.tavilyExtract` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `tavily_mcp.tavilyMap` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `tavily_mcp.tavilySearch` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `teams` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `thehive.createAlert` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `thehive.pushToService` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.addAttribute` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.addTags` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.createAdversary` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.createEvent` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.createIndicator` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.createObject` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.executePlugin` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.getIndicator` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.getObject` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.getPlugin` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.getRelatedObjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.linkObjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.listIndicatorStatuses` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.listIndicatorTypes` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.listPlugins` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.searchIndicators` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.searchObjects` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `threatq.updateIndicatorStatus` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `tines.run` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `tines.stories` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `tines.test` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `tines.webhooks` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `torq` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.authorizeGuestAccess` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.getCameraSnapshot` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.getClient` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.getDevice` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.getDeviceStatistics` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.getNetworkInfo` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.getNvr` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.getProtectDevice` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.getProtectInfo` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.listClients` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.listDevices` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.listFirewallPolicies` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.listNetworks` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.listProtectDevices` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.listSites` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.listWans` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.movePtzCameraToPreset` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.powerCyclePort` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.restartDevice` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `unifi.unauthorizeGuestAccess` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `urlscan_io.getDom` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `urlscan_io.getQuota` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `urlscan_io.getResult` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `urlscan_io.getScreenshot` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `urlscan_io.scanUrl` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `urlscan_io.scanUrlAndWait` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `urlscan_io.searchScans` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `urlvoid.checkUrl` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `urlvoid.getDomainInfo` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `urlvoid.scanDomain` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `urlvoid.scanDomainStats` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `virustotal.getAnalysisResults` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `virustotal.getIpReport` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `virustotal.scanFileHash` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `virustotal.scanUrl` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `virustotal.submitFile` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `wait` | core | Supported | Supported | R: controls.inline + parallel durable; U: park/resume |
| `waitForApproval` | core | Supported | Supported | R: waitForApproval + delivered HTTP notification + resume; U: resumeInput |
| `waitForInput` | core | Supported | Supported | R: waitForInput + delivered HTTP notification + resume; U: resumeInput |
| `while` | core | Supported | Supported | R: controls (selected branch, exact loop counts/items, untaken steps absent) |
| `workflow.execute` | core | Supported | Supported | R: parent-parked/parent (real child completion + parent resume/output) |
| `workflow.executeAsync` | core | Supported | Supported | R: async-parent (persisted child invocation output) |
| `workflow.fail` | core | Supported | Supported | X: exact existing workflow_output/workflow_fail scenarios + original assertions |
| `workflow.output` | core | Supported | Supported | X: exact existing workflow_output/workflow_fail scenarios + original assertions |
| `xmatters` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `xsoar.getPlaybooks` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `xsoar.run` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zendesk.getTicket` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zendesk.getTicketComments` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zendesk.listTickets` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zendesk.search` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zendesk.whoAmI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zoom.downloadRecordingFile` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zoom.getMeetingDetails` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zoom.getMeetingParticipants` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zoom.getMeetingRecordings` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zoom.getMeetingRegistrants` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zoom.getPastMeetingDetails` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zoom.listMeetings` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zoom.listUserRecordings` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |
| `zoom.whoAmI` | actions/spec connector | Supported | Supported | C: registered action/spec + subaction transport; original ConnectorExecutor |

## Known issues vs validation gaps

Identified runtime known issues: none in this parity phase; no unsupported-core/storage guard remains. This is a PoC, not a production readiness/security/isolation claim. Evidence gaps above remain real gaps: shared generic-contract coverage is weaker than independently executing every external business integration. Third-party credentials, provider availability and disabled-plugin registration are not fabricated as tested outcomes or called impossible. Data-stream placement costs additional coordinator persistence RPC; its exact existing DAL remains coordinator-side. See REPORT for measured seam/idle costs and prior recovery/rollout non-goals.
