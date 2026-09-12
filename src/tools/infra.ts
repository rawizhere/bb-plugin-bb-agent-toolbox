import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { requireThreadId, type Registrar } from "../lib/toolkit";
import { resolveHost } from "../lib/resolve-host";

// Read-only for now: letting an agent create or pause machines is an easy way to rack up cloud bills.
export function registerInfraTools(bb: BbPluginApi, register: Registrar) {
  register("machines", {
    name: "bbtools_machines_list",
    description:
      "List machines (hosts) enrolled with bb, with their connection and lifecycle status. Use it to see where threads and workspaces can run.",
    parameters: z.object({}),
    execute: async () => {
      const hosts = await bb.sdk.hosts.list();
      if (hosts.length === 0) return "No machines enrolled.";
      return hosts
        .map((h) => {
          const phase = h.lifecycle?.phase ?? "active";
          return `${h.id}\t${h.name}\t[${h.status}] ${h.type}${phase !== "active" ? ` (${phase})` : ""}`;
        })
        .join("\n");
    },
  });

  register("machines", {
    name: "bbtools_environments_list",
    description:
      "List workspaces (environments / worktrees) of a bb project with branch, host, and status. Use it to orient across a project's checkouts before delegating work.",
    parameters: z.object({
      projectId: z.string().optional().describe("Project id (default: the current thread's project)."),
    }),
    execute: async ({ projectId }, ctx) => {
      const list = await bb.sdk.environments.list({ projectId: projectId ?? ctx.projectId ?? undefined });
      if (list.length === 0) return "No environments for this project.";
      return list
        .map(
          (e) =>
            `${e.id}\t${e.name ?? "(unnamed)"}\t[${e.status}]${e.branchName ? ` branch ${e.branchName}` : ""} host ${e.hostId}${e.path ? ` ${e.path}` : ""}`,
        )
        .join("\n");
    },
  });
}
