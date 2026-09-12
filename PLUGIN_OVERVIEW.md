# BB Agent Toolbox

Provider-independent bb surfaces as agent tools for any coding agent in bb.

## What it does

Registers agent tools (`bbtools_*`) via the bb SDK so any provider — opencode,
Prime Agent (ACP), Google Antigravity, or any OpenRouter model — can act inside
bb: coordinate, message, spawn, wait for, retry, stop, outline, and archive
threads; see and answer threads' pending interactions; read and write the
current project's workspace files; and create, watch, and drive terminal
sessions the user can see live in the bb UI.

## How it works

Pure server-side: the plugin only wraps bb SDK areas (`threads` incl.
`interactions`, `files`, `terminals`, `projects`, `hosts`/`environments`,
`experimental_desktopBrowsers`) as agent tools plus thread instructions. It
never touches provider transports. Tool groups can be toggled live in the
plugin settings — no reload needed. Responding to other threads'
interactions is a separate default-off setting.

## Links

- Repository: https://github.com/rawizhere/bb-plugin-bb-agent-toolbox
- bb: https://github.com/get-bb/bb
