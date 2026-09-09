import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { type BbContext, type JsonValue } from "@get-bb/plugin-sdk";
import { type Flags, makeRegistrar, requireProjectId, requireThreadId, sleep, threadTitle, tool } from "../lib/toolkit";
import { resolveHost } from "../lib/resolve-host";

// Loose shape of the interactions the SDK returns; formatting stays defensive
// because the union differs across providers.
type InteractionRow = {
  id: string;
  status: string;
  payload: {
    kind?: string;
    reason?: string | null;
    availableDecisions?: string[];
    subject?: { kind?: string; command?: string; name?: string; path?: string | null };
    questions?: { id: string; prompt: string; multiSelect?: boolean; allowFreeText?: boolean; options?: { label: string; value: string }[] }[];
    title?: string;
  };
};

function describeInteraction(item: InteractionRow): string {
  const p = item.payload;
  const lines: string[] = [`id: ${item.id}`, `status: ${item.status}`];
  if (p.kind === "approval") {
    const s = p.subject ?? {};
    const what = s.command ?? s.name ?? s.path ?? "";
    lines.push(`kind: approval ${s.kind ?? ""} ${what}`.trimEnd());
    if (p.reason) lines.push(`reason: ${p.reason}`);
    if (p.availableDecisions) lines.push(`decisions: ${p.availableDecisions.join(", ")}`);
  } else if (p.kind === "user_question") {
    for (const q of p.questions ?? []) {
      lines.push(`question ${q.id}: ${q.prompt}`);
      for (const o of q.options ?? []) lines.push(`  option: ${o.value} (${o.label})`);
      if (q.multiSelect) lines.push("  multi-select: yes");
      if (q.allowFreeText) lines.push("  free text allowed");
    }
  } else if (p.title) {
    lines.push(`kind: ${p.kind ?? "plugin"}`, `title: ${p.title}`);
  } else {
    lines.push(`kind: ${p.kind ?? "unknown"}`);
  }
  return lines.join("\n");
}

// Accept an ISO date string or epoch milliseconds; return epoch ms or null.
export function parseWhen(input: string): number | null {
  if (/^\d{10,14}$/.test(input)) return Number(input);
  const t = Date.parse(input);
  return Number.isNaN(t) ? null : t;
}

export function registerThreadTools(
  bb: BbPluginApi,
  flags: Flags,
  register: ReturnType<typeof makeRegistrar>["register"],
) {
  register("threads", tool({
    name: "bbtools_threads_list",
    description:
      "List bb threads in the current project: id, title, status, provider, and activity. Use it to discover threads you can read or message.",
    parameters: z.object({
      limit: z.number().int().min(1).max(100).optional().describe("Max threads (default 25)."),
    }),
    execute: async ({ limit }, ctx) => {
      const threads = await bb.sdk.threads.list({
        projectId: requireProjectId(ctx),
        limit: limit ?? 25,
      });
      if (threads.length === 0) return "No threads in this project.";
      return threads
        .map((t) => `${t.id}\t[${t.status}] ${threadTitle(t)} (provider: ${t.providerId})`)
        .join("\n");
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_get",
    description:
      "Read a bb thread's status, its latest assistant output, and any pending interaction. Use it to check what another thread (agent) is doing, produced, or waits for.",
    parameters: z.object({
      threadId: z.string().describe("The target thread id."),
    }),
    execute: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId, include: "environment" });
      let output = "";
      try {
        const res = await bb.sdk.threads.output({ threadId });
        if (res.output) output = `\n--- output ---\n${res.output}`;
      } catch {
        // output is not always available; the status line still is
      }
      const env =
        "environment" in thread && thread.environment?.name
          ? `\nworkspace: ${thread.environment.name}${thread.environment.path ? ` (${thread.environment.path})` : ""}`
          : "";
      let pending = "";
      try {
        const interactions = (await bb.sdk.threads.interactions.list({ threadId })) as unknown as InteractionRow[];
        const open = interactions.filter((i) => i.status === "pending");
        if (open.length > 0)
          pending = `\n--- pending interaction ---\n${open.map(describeInteraction).join("\n")}\nAnswer with bbtools_thread_interaction_respond.`;
      } catch {
        // interaction listing is best-effort here; the dedicated tool reports errors
      }
      return `id: ${thread.id}\nstatus: ${thread.status}\ntitle: ${threadTitle(thread)}\nprovider: ${thread.providerId}${env}${output}${pending}`;
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_outline",
    description:
      "Read a compact conversation outline of a bb thread: turn-by-turn role and preview. Use it to see what another thread (e.g. a child you spawned) discussed or concluded without pulling the full transcript.",
    parameters: z.object({
      threadId: z.string().describe("The target thread id."),
    }),
    execute: async ({ threadId }) => {
      const outline = await bb.sdk.threads.conversationOutline({ threadId });
      if (outline.items.length === 0) return "No conversation yet.";
      return outline.items
        .map((item) => {
          const attachments =
            item.attachmentSummary &&
            (item.attachmentSummary.fileCount > 0 || item.attachmentSummary.imageCount > 0)
              ? ` [attachments: ${item.attachmentSummary.fileCount} files, ${item.attachmentSummary.imageCount} images]`
              : "";
          return `[${item.role}] ${item.preview.replace(/\s+/g, " ").slice(0, 400)}${attachments}`;
        })
        .join("\n");
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_send",
    description:
      "Send a text message to an existing bb thread. Use it to message another agent/thread directly to coordinate work, request an update, or hand off a result. A future sendAt queues the message instead of dispatching it now.",
    parameters: z.object({
      threadId: z.string().describe("The target thread id."),
      text: z.string().min(1).describe("The message text to send."),
      sendAt: z.string().optional().describe("ISO date or epoch ms in the future to schedule the send."),
    }),
    execute: async ({ threadId, text, sendAt }) => {
      let sendAtMs: number | undefined;
      if (sendAt) {
        const parsed = parseWhen(sendAt);
        if (parsed === null) return `Error: cannot parse sendAt value "${sendAt}".`;
        if (parsed <= Date.now()) return "Error: sendAt must be in the future.";
        sendAtMs = parsed;
      }
      const res = await bb.sdk.threads.send({
        threadId,
        mode: "auto",
        input: [{ type: "text", text, mentions: [] }],
        ...(sendAtMs ? { sendAt: sendAtMs } : {}),
      });
      if (res.delivery === "queued") {
        const at = "queuedMessage" in res && res.queuedMessage?.sendAt ? new Date(res.queuedMessage.sendAt).toISOString() : "scheduled time";
        return `Queued message for thread ${threadId}, scheduled for ${at}.`;
      }
      return `Sent message to thread ${threadId}.`;
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_spawn",
    description:
      "Create a new bb thread (child of the current one). Use it to delegate parallel or background work to another agent thread. Defaults to the current thread's provider and environment; pass providerId/model to override.",
    parameters: z.object({
      prompt: z.string().min(1).describe("The initial prompt for the new thread."),
      providerId: z.string().optional().describe("Provider id (defaults to the current thread's)."),
      model: z.string().optional().describe("Model id (defaults to the provider default)."),
      reasoningLevel: z
        .enum(["none", "low", "medium", "high", "xhigh", "max"])
        .optional()
        .describe("Reasoning level (provider-dependent)."),
      permissionMode: z
        .enum(["accept-edits", "auto", "full"])
        .optional()
        .describe("Permission mode (default: full)."),
    }),
    execute: async ({ prompt, providerId, model, reasoningLevel, permissionMode }, ctx) => {
      const threadId = requireThreadId(ctx);
      const projectId = requireProjectId(ctx);
      const current = await bb.sdk.threads.get({ threadId });
      const resolvedProvider = providerId ?? current.providerId;
      if (!resolvedProvider) return "Error: no provider on the current thread; pass providerId.";
      const environment = await (async () => {
        try {
          const { environmentId } = await resolveHost(bb, threadId);
          return environmentId
            ? ({ type: "reuse", environmentId } as const)
            : ({ type: "project-default" } as const);
        } catch {
          return { type: "project-default" } as const;
        }
      })();
      const thread = await bb.sdk.threads.spawn({
        projectId,
        providerId: resolvedProvider,
        ...(model ? { model } : {}),
        ...(reasoningLevel ? { reasoningLevel } : {}),
        permissionMode: permissionMode ?? "full",
        environment,
        parentThreadId: threadId,
        input: [{ type: "text", text: prompt, mentions: [] }],
        origin: "plugin",
      });
      return `Spawned thread ${thread.id} in project ${ctx.projectId}. Use bbtools_thread_wait to wait for it to finish.`;
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_wait",
    description:
      "Wait until a bb thread reaches a target status (by default idle or error). Use it after spawning or messaging a thread instead of polling bbtools_thread_get repeatedly.",
    parameters: z.object({
      threadId: z.string().describe("The target thread id."),
      waitFor: z
        .enum(["idle", "error", "idle_or_error"])
        .optional()
        .describe("Target status (default idle_or_error)."),
      timeoutMs: z
        .number()
        .int()
        .min(1000)
        .max(900_000)
        .optional()
        .describe("Give up after this long (default 120000, max 900000)."),
      pollIntervalMs: z
        .number()
        .int()
        .min(500)
        .max(30_000)
        .optional()
        .describe("Status poll interval (default 2000)."),
    }),
    execute: async ({ threadId, waitFor, timeoutMs, pollIntervalMs }) => {
      const targets = waitFor === "idle" ? ["idle"] : waitFor === "error" ? ["error"] : ["idle", "error"];
      const limit = timeoutMs ?? 120_000;
      const interval = pollIntervalMs ?? 2_000;
      const start = Date.now();
      for (;;) {
        const thread = await bb.sdk.threads.get({ threadId });
        const elapsedS = Math.round((Date.now() - start) / 1000);
        if (targets.includes(thread.status)) {
          return `Thread ${thread.id} (${threadTitle(thread)}) reached status ${thread.status} after ${elapsedS}s. Use bbtools_thread_get or bbtools_thread_outline to read the result.`;
        }
        if (Date.now() - start >= limit)
          return `Timed out after ${Math.round(limit / 1000)}s; thread ${threadId} is still ${thread.status}.`;
        await sleep(Math.min(interval, start + limit - Date.now()));
      }
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_interactions_list",
    description:
      "List a bb thread's pending interactions: permission approvals, user questions, and plugin prompts. Use it to see what another thread waits for before answering with bbtools_thread_interaction_respond.",
    parameters: z.object({
      threadId: z.string().describe("The target thread id."),
    }),
    execute: async ({ threadId }) => {
      const list = (await bb.sdk.threads.interactions.list({ threadId })) as unknown as InteractionRow[];
      if (list.length === 0) return "No interactions on this thread.";
      const open = list.filter((i) => i.status === "pending");
      if (open.length === 0) return "No pending interactions on this thread.";
      return open.map(describeInteraction).join("\n\n");
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_interaction_respond",
    description:
      "Respond to a pending interaction on another bb thread: approve or deny a permission approval, answer a user question, or submit a value. Listing first with bbtools_thread_interactions_list is expected. This tool is disabled unless the plugin setting enableInteractionRespond is on.",
    parameters: z.object({
      threadId: z.string().describe("The target thread id."),
      interactionId: z.string().describe("The interaction id from bbtools_thread_interactions_list."),
      decision: z
        .enum(["allow_once", "allow_for_session", "deny"])
        .optional()
        .describe("Answer for a permission approval."),
      answers: z
        .record(
          z.string(),
          z.object({
            selected: z.array(z.string()).optional().describe("Selected option values."),
            freeText: z.string().optional().describe("Free-text answer when no option fits."),
          }),
        )
        .optional()
        .describe("Answers for a user question, keyed by question id."),
      value: z.unknown().optional().describe("Raw value for a request-style interaction."),
    }),
    execute: async ({ threadId, interactionId, decision, answers, value }) => {
      if (!flags.enableInteractionRespond)
        return "Responding to interactions is disabled in the bb-agent-toolbox plugin settings (enableInteractionRespond).";
      const given = [decision !== undefined, answers !== undefined, value !== undefined].filter(Boolean).length;
      if (given !== 1)
        return "Error: provide exactly one of decision, answers, or value.";
      let response: unknown;
      if (decision) response = decision === "deny" ? { decision } : { decision, grantedPermissions: null };
      else if (answers)
        response = {
          kind: "user_answer",
          answers: Object.fromEntries(
            Object.entries(answers).map(([qid, a]) => [qid, { selected: a.selected ?? [], ...(a.freeText ? { freeText: a.freeText } : {}) }]),
          ),
        };
      else response = { kind: "request_answer", value };
      await bb.sdk.threads.interactions.respond({ threadId, interactionId, value: response as JsonValue });
      return `Responded to interaction ${interactionId} on thread ${threadId}.`;
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_retry",
    description:
      "Re-submit the failed turn of a bb thread that is in error status. Use it to restart work after fixing the cause of a failure.",
    parameters: z.object({
      threadId: z.string().describe("The target thread id."),
      turnRequestId: z
        .string()
        .optional()
        .describe("The failed turn to re-submit; omit for the thread's most recent turn."),
      reason: z.string().optional().describe("Why the turn is retried, shown on the queued row."),
    }),
    execute: async ({ threadId, turnRequestId, reason }) => {
      const res = await bb.sdk.threads.retry({
        threadId,
        ...(turnRequestId ? { turnRequestId } : {}),
        ...(reason ? { reason } : {}),
      });
      if (res.delivery === "queued") return `Retry of thread ${threadId} queued (turn ${res.turnRequestId}).`;
      return `Retry of thread ${threadId} dispatched (turn ${res.turnRequestId}).`;
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_stop",
    description:
      "Stop a running bb thread (cancels its active turn). Use it to stop work you delegated to another thread, e.g. a runaway or no-longer-needed child thread.",
    parameters: z.object({
      threadId: z.string().describe("The target thread id."),
    }),
    execute: async ({ threadId }) => {
      await bb.sdk.threads.stop({ threadId });
      return `Stopped thread ${threadId}.`;
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_archive",
    description:
      "Archive a bb thread (hides it from the active list; reversible via unarchive). Use it to clean up finished child threads you spawned.",
    parameters: z.object({
      threadId: z.string().describe("The target thread id."),
    }),
    execute: async ({ threadId }) => {
      await bb.sdk.threads.archive({ threadId });
      return `Archived thread ${threadId}.`;
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_clear_context",
    description:
      "Reset a bb thread's agent context while keeping its workspace and history. Use it on an idle thread that drifted off course before sending a fresh, focused prompt.",
    parameters: z.object({
      threadId: z.string().describe("The target thread id."),
    }),
    execute: async ({ threadId }) => {
      await bb.sdk.threads.clearContext({ threadId });
      return `Cleared context of thread ${threadId}.`;
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_compact",
    description:
      "Compact a bb thread's conversation to shrink its context window. Use it on a long-running thread that is still useful but heavy.",
    parameters: z.object({
      threadId: z.string().describe("The target thread id."),
    }),
    execute: async ({ threadId }) => {
      await bb.sdk.threads.compact({ threadId });
      return `Compacted thread ${threadId}.`;
    },
  }));

  register("threads", tool({
    name: "bbtools_thread_search",
    description:
      "Search across bb threads and messages for text. Use it to find past discussions instead of reading whole threads.",
    parameters: z.object({
      query: z.string().min(1).describe("Text to search for."),
      limitPerGroup: z.number().int().min(1).max(20).optional().describe("Results per group."),
    }),
    execute: async ({ query, limitPerGroup }) => {
      const res = await bb.sdk.threads.search({
        query,
        ...(limitPerGroup ? { limitPerGroup: String(limitPerGroup) } : {}),
      });
      const out: string[] = [];
      for (const group of [res.active, res.archived]) {
        for (const r of group.results) {
          const title = threadTitle(r.thread);
          for (const m of r.matches.slice(0, 3)) {
            out.push(`${title}\t${m.sourceKind}: ${m.text.slice(0, 200)}`);
          }
        }
      }
      return out.length === 0 ? "No matches." : out.join("\n");
    },
  }));
}
