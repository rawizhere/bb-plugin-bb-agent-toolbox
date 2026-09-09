
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../dist/server.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// deterministic thread fixture
const thread = (over = {}) => ({
  id: over.id ?? "thr_child",
  status: over.status ?? "idle",
  title: over.title ?? null,
  titleFallback: over.titleFallback ?? "child thread",
  providerId: over.providerId ?? "prime-agent-acp",
  projectId: "proj_personal",
});

let host = createFakePluginHost({
  pluginId: "bb-agent-toolbox",
  sdk: {
    threads: {
      list: async () => [thread({ id: "thr_a" })],
      get: async (args) => ({
        ...thread({ id: args.threadId, status: "idle" }),
        ...(args.include === "environment"
          ? { environment: { id: "env_1", hostId: "host_local", name: "personal", path: "/tmp/ws" } }
          : {}),
      }),
      conversationOutline: async () => ({ items: [{ role: "assistant", preview: "done work" }] }),
      send: async (args) => (args.sendAt ? { delivery: "queued", ok: true, queuedMessage: { sendAt: args.sendAt } } : { delivery: "sent", ok: true }),
      retry: async () => ({ ok: true, delivery: "sent", attempt: 1, turnRequestId: "turn_1" }),
      stop: async () => ({ ok: true }),
      archive: async () => ({ ok: true }),
      clearContext: async () => ({ ok: true }),
      compact: async () => ({ ok: true }),
      search: async () => ({ active: { results: [] }, archived: { results: [] } }),
      output: async () => ({ output: "hello from child" }),
      interactions: {
        list: async () => [
          {
            id: "ia_1",
            status: "pending",
            payload: {
              kind: "approval",
              reason: "run tests",
              availableDecisions: ["allow_once", "allow_for_session", "deny"],
              subject: { kind: "command", command: "npm test" },
            },
          },
          {
            id: "ia_2",
            status: "pending",
            payload: {
              kind: "user_question",
              questions: [{ id: "q1", prompt: "Deploy now?", options: [{ label: "Yes", value: "yes" }], multiSelect: false, allowFreeText: true }],
            },
          },
        ],
        respond: async (args) => ({ id: args.interactionId, status: "resolved" }),
      },
      spawn: async () => thread({ id: "thr_new" }),
    },
    projects: { list: async () => [{ id: "proj_personal", name: "personal" }] },
    files: {
      listPaths: async () => ({ paths: [{ kind: "directory", name: "src", path: "src" }] }),
      read: async (a) => ({ content: "file body", sizeBytes: 9 }),
      write: async () => ({}),
      mkdir: async () => ({}),
    },
    terminals: {
      list: async () => ({ sessions: [] }),
      create: async () => ({ id: "term_1" }),
      output: async () => ({ chunks: [{ dataBase64: Buffer.from("ok").toString("base64") }], truncated: false }),
      input: async () => ({}),
      close: async () => ({}),
    },
  },
});
host = await host.harness.lifecycle.reload(plugin);

const tools = new Map(host.harness.registrations.agentTools.map((t) => [t.name, t]));
const ctx = { threadId: "thr_self", projectId: "proj_personal", signal: new AbortController().signal };
const results = {};
const run = async (name, params) => { results[name] = await tools.get(name).execute(params, ctx); };

await run("bbtools_threads_list", {});
await run("bbtools_thread_get", { threadId: "thr_child" });
await run("bbtools_thread_outline", { threadId: "thr_child" });
const sentNow = await tools.get("bbtools_thread_send").execute({ threadId: "thr_child", text: "hi" }, ctx);
const sentLater = await tools.get("bbtools_thread_send").execute({ threadId: "thr_child", text: "hi", sendAt: new Date(Date.now() + 3600_000).toISOString() }, ctx);
const sentBad = await tools.get("bbtools_thread_send").execute({ threadId: "thr_child", text: "hi", sendAt: "not-a-date" }, ctx);
results["bbtools_thread_send"] = [sentNow, sentLater, sentBad].join(" || ");
await run("bbtools_thread_spawn", { prompt: "do it" });
await run("bbtools_thread_wait", { threadId: "thr_child", timeoutMs: 5000, pollIntervalMs: 500 });
await run("bbtools_thread_interactions_list", { threadId: "thr_child" });
await run("bbtools_thread_interaction_respond", { threadId: "thr_child", interactionId: "ia_1", decision: "deny" });
await run("bbtools_thread_interaction_respond", { threadId: "thr_child", interactionId: "ia_2", answers: { q1: { selected: ["yes"] } } });
await run("bbtools_thread_interaction_respond", { threadId: "thr_child", interactionId: "ia_1" });
await run("bbtools_thread_retry", { threadId: "thr_child" });
await run("bbtools_thread_clear_context", { threadId: "thr_child" });
await run("bbtools_thread_compact", { threadId: "thr_child" });
await run("bbtools_thread_search", { query: "x" });
await run("bbtools_projects_list", {});
await run("bbtools_workspace_list", { path: "" });
await run("bbtools_workspace_read", { path: "a.txt" });
await run("bbtools_workspace_write", { path: "a.txt", content: "x" });
await run("bbtools_workspace_mkdir", { path: "d" });
await run("bbtools_terminals_list", {});
await run("bbtools_terminal_create", { title: "t" });
await run("bbtools_terminal_output", { terminalId: "term_1" });
await run("bbtools_terminal_input", { terminalId: "term_1", text: "ls" });
await run("bbtools_terminal_close", { terminalId: "term_1" });

for (const [name, value] of Object.entries(results)) {
  const v = String(value).replace(/\n/g, " | ");
  console.log(`OK  ${name}: ${v.length > 160 ? v.slice(0, 160) + "..." : v}`);
}

// respond must be blocked while enableInteractionRespond is off
const blocked = results["bbtools_thread_interaction_respond"];
console.log(blocked.includes("disabled") ? "GATE OK (default off)" : "GATE FAIL: " + blocked);

// with the setting on, both response kinds must go through
await host.harness.setSettings({ enableInteractionRespond: true });
const approved = await tools.get("bbtools_thread_interaction_respond").execute({ threadId: "thr_child", interactionId: "ia_1", decision: "allow_for_session" }, ctx);
const answered = await tools.get("bbtools_thread_interaction_respond").execute({ threadId: "thr_child", interactionId: "ia_2", answers: { q1: { selected: ["yes"], freeText: "go" } } }, ctx);
console.log("RESPOND approval:", approved);
console.log("RESPOND answers:", answered);
const respondCalls = host.harness.sdk.callsTo("threads.interactions.respond");
console.log("respond payloads:", JSON.stringify(respondCalls.map((c) => c[0].value)));
console.log("WS after env fix:", results["bbtools_workspace_list"]);
console.log("instructions:\n" + host.harness.registrations.instructionProvider({ threadId: "t", projectId: "p" }));
