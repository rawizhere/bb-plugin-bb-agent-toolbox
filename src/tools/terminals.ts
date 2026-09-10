import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { requireThreadId, type Registrar } from "../lib/toolkit";

export function registerTerminalTools(bb: BbPluginApi, register: Registrar) {
  register("terminals", {
    name: "bbtools_terminals_list",
    description:
      "List bb terminal sessions in the current thread: id, title, status, cwd. Use it to see running shells and their scope.",
    parameters: z.object({}),
    execute: async (_params, ctx) => {
      const res = await bb.sdk.terminals.list({
        scope: { kind: "thread", threadId: requireThreadId(ctx) },
      });
      if (res.sessions.length === 0) return "No terminal sessions in this thread.";
      return res.sessions
        .map(
          (s) =>
            `${s.id}\t[${s.status}] ${s.title} (thread: ${s.threadId ?? "-"}, cwd: ${s.initialCwd})`,
        )
        .join("\n");
    },
  });

  register("terminals", {
    name: "bbtools_terminal_create",
    description:
      "Create a bb terminal session attached to the current thread. Use it to run a shell the user can watch live in the bb UI, or start a long-running command in a visible terminal.",
    parameters: z.object({
      title: z.string().optional().describe("Optional terminal title."),
      command: z.string().optional().describe("Initial command to run; omit for an interactive shell."),
    }),
    execute: async ({ title, command }, ctx) => {
      const session = await bb.sdk.terminals.create({
        cols: 120,
        rows: 30,
        scope: { kind: "thread", threadId: requireThreadId(ctx) },
        ...(title ? { title } : {}),
        start: command ? { mode: "command", command } : { mode: "shell" },
      });
      return `Created terminal ${session.id}${title ? ` ("${title}")` : ""}. Use bbtools_terminal_output / bbtools_terminal_input with this id.`;
    },
  });

  register("terminals", {
    name: "bbtools_terminal_output",
    description:
      "Read recent output of a bb terminal session (decoded text tail). Use it after bbtools_terminal_input or bbtools_terminal_create to see what the shell printed.",
    parameters: z.object({
      terminalId: z.string().describe("Terminal session id (from bbtools_terminals_list or bbtools_terminal_create)."),
      tailBytes: z.number().int().min(200).max(200000).optional().describe("Max bytes of tail to read (default 8000)."),
    }),
    execute: async ({ terminalId, tailBytes }) => {
      const res = await bb.sdk.terminals.output({
        terminalId,
        ...(tailBytes ? { tailBytes } : { tailBytes: 8000 }),
      });
      const text = res.chunks
        .map((c) => Buffer.from(c.dataBase64, "base64").toString("utf8"))
        .join("");
      const cleaned = text.replace(/\r\n/g, "\n").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
      return cleaned.trim().length === 0
        ? "(no output yet)"
        : `${res.truncated ? "(truncated)\n" : ""}${cleaned.trim()}`;
    },
  });

  register("terminals", {
    name: "bbtools_terminal_input",
    description:
      "Type text into a bb terminal session (as if the user typed it). Use it to run commands or answer prompts in a terminal the user can watch.",
    parameters: z.object({
      terminalId: z.string().describe("Terminal session id."),
      text: z.string().min(1).describe("Text to type into the terminal."),
      pressEnter: z.boolean().optional().describe("Append a newline to execute the command (default true)."),
    }),
    execute: async ({ terminalId, text, pressEnter }) => {
      const data = text + (pressEnter ?? true ? "\n" : "");
      await bb.sdk.terminals.input({
        terminalId,
        dataBase64: Buffer.from(data, "utf8").toString("base64"),
      });
      return `Typed into terminal ${terminalId}. Use bbtools_terminal_output to read the result.`;
    },
  });

  register("terminals", {
    name: "bbtools_terminal_close",
    description:
      "Close a bb terminal session. Use it to clean up terminals you created.",
    parameters: z.object({
      terminalId: z.string().describe("Terminal session id."),
      force: z.boolean().optional().describe("Force-close even if a process is running (default: only close when clean)."),
    }),
    execute: async ({ terminalId, force }) => {
      await bb.sdk.terminals.close({
        terminalId,
        mode: force ? "force" : "if-clean",
      });
      return `Closed terminal ${terminalId}.`;
    },
  });
}
