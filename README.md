# BB Agent Toolbox

Exposes bb SDK surfaces to agents as **provider-independent agent tools** via
`bb.agents.registerTool` + `bb.agents.contributeInstructions`. The tools are
injected into the sessions of **any** provider (opencode, Prime Agent's ACP
provider, etc.), so an agent can act inside bb: threads, interactions,
projects, workspace files, and terminals.

The transport between bb and a provider is untouched — this plugin only adds
bb surfaces as tools. Disable or remove it and agents return to stock
behaviour.

## Tools

- **Threads** (`bbtools_threads_list` / `bbtools_thread_get` / `bbtools_thread_outline` / `bbtools_thread_send` / `bbtools_thread_spawn` / `bbtools_thread_wait` / `bbtools_thread_interactions_list` / `bbtools_thread_interaction_respond` / `bbtools_thread_retry` / `bbtools_thread_stop` / `bbtools_thread_archive` / `bbtools_thread_clear_context` / `bbtools_thread_compact` / `bbtools_thread_search`)
  — inspect, message, create, wait for, retry, stop, archive, and read bb
  threads to coordinate, delegate, or hand off work between agents.
  `bbtools_thread_send` accepts a future `sendAt` to schedule the message.
  `bbtools_thread_get` and `bbtools_thread_interactions_list` surface what a
  thread waits for: permission approvals, user questions, plugin prompts.
- **Projects & workspace** (`bbtools_projects_list` / `bbtools_workspace_list` / `bbtools_workspace_read` / `bbtools_workspace_write` / `bbtools_workspace_mkdir`)
  — orient across projects and read/write workspace files (confined to the
  thread's workspace root).
- **Terminals** (`bbtools_terminals_list` / `bbtools_terminal_create` / `bbtools_terminal_output` / `bbtools_terminal_input` / `bbtools_terminal_close`)
  — create, watch (read output), drive (type commands), and close bb terminal
  sessions the user can watch live in the bb UI.

> Shared memory is intentionally **not** included: the built-in Memory plugin
> already provides durable `bb_memory_*` agent tools (plus a CLI and UI). This
> toolbox stays focused on what is otherwise missing.

## Settings

Each tool group can be toggled with `bb plugin config bb-agent-toolbox`:

- `enableThreads` (default `true`)
- `enableWorkspace` (default `true`)
- `enableTerminals` (default `true`)
- `enableInteractionRespond` (default `false`) — answering another thread's
  pending interactions lets an agent approve or deny another agent's
  permission requests, so it is off by default

Toggles apply to new tool calls without reloading the plugin.

## CLI

```bash
bb bb-agent-toolbox status   # tool groups + enabled state (+ --json)
```

## Design notes

- Names use a `bbtools_` prefix to avoid colliding with other plugins' agent
  tools (e.g. the built-in Memory plugin's `bb_memory_*`).
- Workspace tools resolve the current thread's host and workspace root at
  call time and pass `rootPath` to confine reads/writes to the project.
- Agent-tool output is truncated to a bounded length before it reaches the
  model context.
- Errors are caught and returned as text so the agent sees them instead of the
  call failing.

## Development

```bash
npm install
npm test              # smoke test against the SDK fake host
bb plugin build .
bb plugin install . --yes
```
