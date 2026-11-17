export declare enum ExecutionStatus {
    PENDING = "pending",
    WAITING = "waiting",
    WAITING_FOR_INPUT = "waiting_for_input",
    WAITING_FOR_CHILD = "waiting_for_child",
    RUNNING = "running",
    /** Persisted concurrency backlog - does not count toward concurrency max until promoted to pending + scheduled */
    QUEUED = "queued",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELLED = "cancelled",
    TIMED_OUT = "timed_out",
    SKIPPED = "skipped"
}
export type ExecutionStatusUnion = `${ExecutionStatus}`;
export declare const ExecutionStatusValues: ExecutionStatus[];
export declare const TerminalExecutionStatuses: readonly ExecutionStatus[];
export declare const NonTerminalExecutionStatuses: readonly ExecutionStatus[];
/** Workflow executions occupying a concurrency slot (excludes queued backlog). */
export declare const ConcurrencySlotOccupyingExecutionStatuses: readonly ExecutionStatus[];
/** True when an execution cannot be resumed or run again. */
export declare const isTerminalStatus: (status: ExecutionStatus) => boolean;
/** Default iteration guard for workflow loops. */
export declare const DEFAULT_LOOP_MAX_ITERATIONS = 2000;
