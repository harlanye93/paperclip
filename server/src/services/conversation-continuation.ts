import { execFile } from "node:child_process";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { environmentLeases, heartbeatRunEvents, heartbeatRuns, issueRecoveryActions, type Db } from "@paperclipai/db";
import { readProcessStartedAt } from "./hot-restart.js";

// These adapters accept a conversation turn. Retrying a process or webhook can
// replay the action itself, so those adapters retain their recovery contract.
export const CONVERSATION_ADAPTER_TYPES = [
  "claude_local", "codex_local", "cursor", "gemini_local", "opencode_local",
  "pi_local", "grok_local", "kimi_local", "hermes_local",
] as const;

export function isConversationAdapter(adapterType: string): boolean {
  return (CONVERSATION_ADAPTER_TYPES as readonly string[]).includes(adapterType);
}

export const CONVERSATION_CONTINUATION_POLICY = "continue_conversation_v1";

export function hasConversationContinuationPolicy(result: Record<string, unknown> | null | undefined): boolean {
  return result?.workspaceRestoreFailure !== "restore_unsafe_archive" && result?.conversationContinuation === CONVERSATION_CONTINUATION_POLICY;
}

/** Persisted by the server when it claims the run, before remote provisioning. */
export function claimedAdapterType(run: Pick<typeof heartbeatRuns.$inferSelect, "runnerProfileJson">): string | null {
  const dispatch = run.runnerProfileJson?.adapterDispatch as Record<string, unknown> | undefined;
  return typeof dispatch?.adapterType === "string" ? dispatch.adapterType : null;
}

function conversationRunPredicate() {
  return or(
    inArray(sql`${heartbeatRuns.runnerProfileJson}->'adapterDispatch'->>'adapterType'`, [...CONVERSATION_ADAPTER_TYPES]),
    sql`${heartbeatRuns.resultJson}->>'conversationContinuation' = ${CONVERSATION_CONTINUATION_POLICY}`,
    sql`exists (
      select 1 from ${heartbeatRunEvents}
      where ${heartbeatRunEvents.companyId} = ${heartbeatRuns.companyId}
        and ${heartbeatRunEvents.runId} = ${heartbeatRuns.id}
        and ${heartbeatRunEvents.eventType} = 'adapter.invoke'
        and ${inArray(sql`${heartbeatRunEvents.payload}->>'adapterType'`, [...CONVERSATION_ADAPTER_TYPES])}
    )`,
  );
}

/** Recovery must not infer the old adapter from the agent's mutable settings. */
export async function historicalAdapterType(db: Db, run: typeof heartbeatRuns.$inferSelect): Promise<string | null> {
  const selected = claimedAdapterType(run);
  if (selected) return selected;
  const [invocation] = await db.select({ payload: heartbeatRunEvents.payload }).from(heartbeatRunEvents)
    .where(and(eq(heartbeatRunEvents.companyId, run.companyId), eq(heartbeatRunEvents.runId, run.id),
      eq(heartbeatRunEvents.eventType, "adapter.invoke")))
    .orderBy(desc(heartbeatRunEvents.seq)).limit(1);
  const adapterType = invocation?.payload?.adapterType;
  return typeof adapterType === "string" ? adapterType : null;
}

export async function runUsedConversationAdapter(db: Db, run: typeof heartbeatRuns.$inferSelect): Promise<boolean> {
  if (run.resultJson?.workspaceRestoreFailure === "restore_unsafe_archive") return false;
  if (hasConversationContinuationPolicy(run.resultJson)) return true;
  const adapterType = await historicalAdapterType(db, run);
  return adapterType !== null && isConversationAdapter(adapterType);
}

/** Only immutable run evidence can retire a historical conversation hold.
 * An agent's current adapter can differ from the one that executed this run.
 * Missing evidence retains the hold; the current agent is never a fallback.
 */
export function conversationRecoveryActionPredicate() {
  return and(
    eq(issueRecoveryActions.cause, "legacy_execution_requires_reconciliation"),
    sql`exists (
      select 1 from ${heartbeatRuns}
      where ${heartbeatRuns.companyId} = ${issueRecoveryActions.companyId}
        and ${heartbeatRuns.id}::text = ${issueRecoveryActions.evidence}->>'runId'
        and coalesce(${heartbeatRuns.nativeIssueId}::text, ${heartbeatRuns.contextSnapshot}->>'issueId') = ${issueRecoveryActions.sourceIssueId}::text
        and ${heartbeatRuns.runtimeMode} = 'legacy'
        and coalesce(${heartbeatRuns.resultJson}->>'workspaceRestoreFailure', '') <> 'restore_unsafe_archive'
        and ${inArray(heartbeatRuns.status, ['failed', 'timed_out', 'interrupted', 'cancelled'])}
        and ${conversationRunPredicate()}
        and ${or(
          sql`${heartbeatRuns.resultJson}->>'conversationContinuation' = ${CONVERSATION_CONTINUATION_POLICY}`,
          eq(heartbeatRuns.status, "interrupted"),
          inArray(heartbeatRuns.errorCode, ["process_lost", "server_shutdown_interrupted", "execution_reconciliation_required"]),
          and(eq(heartbeatRuns.status, "cancelled"), sql`${heartbeatRuns.resultJson}->'executionCancellation'->>'state' = 'acknowledged'`),
        )}
    )`,
  );
}

export type ProcessTableReader = () => Promise<string>;

function readProcessTable(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("ps", ["-A", "-o", "pid=,pgid=,stat="], { encoding: "utf8", timeout: 1_500, windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

/** OS liveness probes do not signal or stop the process. Unknown ownership holds.
 * A zombie has exited and only waits to be reaped, so it cannot own execution.
 * macOS reports kill(-pgid, 0) as EPERM when a group holds only zombies, and
 * kill(pid, 0) succeeds for a zombie PID; the process table resolves both.
 */
export async function processMayBeAlive(
  target: { pid: number } | { processGroupId: number },
  options: { platform?: NodeJS.Platform; readTable?: ProcessTableReader } = {},
): Promise<boolean> {
  const byGroup = "processGroupId" in target;
  const id = byGroup ? target.processGroupId : target.pid;
  try {
    process.kill(byGroup ? -id : id, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
  }
  if ((options.platform ?? process.platform) === "win32") return true;
  const table = await (options.readTable ?? readProcessTable)().catch(() => null);
  if (table === null) return true;
  return table.split("\n").some(line => {
    const [pid, pgid, stat] = line.trim().split(/\s+/);
    return Number(byGroup ? pgid : pid) === id && typeof stat === "string" && !stat.startsWith("Z");
  });
}

/** A terminal conversation row does not prove that its execution authority ended.
 * Other adapters keep their existing bootstrap and ownership protocols.
 */
export async function getConversationOwnershipBlocker(db: Db, companyId: string, issueId: string) {
  const activeLease = sql`exists (select 1 from ${environmentLeases}
    where ${environmentLeases.companyId} = "heartbeat_runs"."company_id"
      and ${environmentLeases.heartbeatRunId} = "heartbeat_runs"."id"
      and (${environmentLeases.releasedAt} is null
        or ${environmentLeases.status} = 'pending_cleanup'
        or ${environmentLeases.cleanupStatus} = 'failed'))`;
  const candidates = await db.select({ run: heartbeatRuns, activeLease }).from(heartbeatRuns)
    .where(and(
      eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.runtimeMode, "legacy"),
      conversationRunPredicate(),
      sql`coalesce(${heartbeatRuns.nativeIssueId}::text, ${heartbeatRuns.contextSnapshot}->>'issueId') = ${issueId}`,
      inArray(heartbeatRuns.status, ["failed", "timed_out", "interrupted", "cancelled"]),
      or(isNotNull(heartbeatRuns.processPid), isNotNull(heartbeatRuns.processGroupId), activeLease),
    )).orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id));
  for (const { run, activeLease: leaseHeld } of candidates) {
    let pidAlive = run.processPid !== null && await processMayBeAlive({ pid: run.processPid });
    if (pidAlive && run.processStartedAt) {
      // A recycled PID cannot keep an old task blocked. An unreadable identity
      // stays conservative; the original process may still own execution.
      const observed = await readProcessStartedAt(run.processPid!).catch(() => null);
      if (observed && new Date(observed).getTime() !== run.processStartedAt.getTime()) pidAlive = false;
    }
    const groupAlive = run.processGroupId !== null && await processMayBeAlive({ processGroupId: run.processGroupId });
    if (pidAlive || groupAlive || leaseHeld) {
      return {
        runId: run.id,
        agentId: run.agentId,
        cause: "execution_owner_active",
        nextAction: pidAlive || groupAlive
          ? "The previous provider process is still running. Stop it before continuing this task."
          : "The previous execution has not released its environment lease. Wait for cleanup before continuing this task.",
      };
    }
  }
  return null;
}
