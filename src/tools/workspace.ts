import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { requireThreadId, type Registrar } from "../lib/toolkit";
import { absolutePath, resolveHost } from "../lib/resolve-host";

export function registerWorkspaceTools(bb: BbPluginApi, register: Registrar) {
  register("workspace", {
    name: "bbtools_projects_list",
    description:
      "List bb projects with their ids and names. Use it to orient yourself across workspaces.",
    parameters: z.object({}),
    execute: async () => {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      if (projects.length === 0) return "No projects.";
      return projects
        .map(
          (p) =>
            `${(p as { id: string }).id}\t${(p as { name?: string }).name ?? "(unnamed)"}`,
        )
        .join("\n");
    },
  });

  register("workspace", {
    name: "bbtools_workspace_list",
    description:
      "List files and directories under a path in the current project's workspace. Use it to see what exists before reading files.",
    parameters: z.object({
      path: z.string().describe("Workspace-relative directory path ('' or '/' for root)."),
      includeFiles: z.boolean().optional().describe("Include files (default true)."),
      includeDirectories: z.boolean().optional().describe("Include directories (default true)."),
      limit: z.number().int().min(1).max(500).optional().describe("Max entries (default 200)."),
    }),
    execute: async ({ path, includeFiles, includeDirectories, limit }, ctx) => {
      const { hostId, rootPath } = await resolveHost(bb, requireThreadId(ctx));
      const res = await bb.sdk.files.listPaths({
        hostId,
        path: absolutePath(rootPath, path || ""),
        includeFiles: includeFiles ?? true,
        includeDirectories: includeDirectories ?? true,
        limit: limit ?? 200,
      });
      if (res.paths.length === 0) return `(empty) ${path || "/"}`;
      return res.paths
        .map((p) => `${p.kind === "directory" ? "[d]" : "   "} ${p.name}  ${p.path}`)
        .join("\n");
    },
  });

  register("workspace", {
    name: "bbtools_workspace_read",
    description:
      "Read a file's content from the current project's workspace. Use it to load files into context even if your own workspace access is limited.",
    parameters: z.object({
      path: z.string().describe("Workspace-relative file path."),
    }),
    execute: async ({ path }, ctx) => {
      const { hostId, rootPath } = await resolveHost(bb, requireThreadId(ctx));
      const res = await bb.sdk.files.read({
        hostId,
        path: absolutePath(rootPath, path),
        rootPath,
      });
      const content =
        res.contentEncoding === "base64"
          ? Buffer.from(res.content, "base64").toString("utf8")
          : res.content;
      return `${path} (${res.sizeBytes} bytes)\n\n${content}`;
    },
  });

  register("workspace", {
    name: "bbtools_workspace_write",
    description:
      "Write or overwrite a file in the current project's workspace, creating parent directories as needed. Use it to create/update files from bb context.",
    parameters: z.object({
      path: z.string().describe("Workspace-relative file path."),
      content: z.string().describe("The full file content."),
    }),
    execute: async ({ path, content }, ctx) => {
      const { hostId, rootPath } = await resolveHost(bb, requireThreadId(ctx));
      await bb.sdk.files.write({
        hostId,
        path: absolutePath(rootPath, path),
        rootPath,
        content,
        createParents: true,
      });
      return `Wrote ${path}.`;
    },
  });

  register("workspace", {
    name: "bbtools_workspace_mkdir",
    description:
      "Create a directory in the current project's workspace (recursively). Use it to ensure a folder exists before writing files.",
    parameters: z.object({
      path: z.string().describe("Workspace-relative directory path."),
    }),
    execute: async ({ path }, ctx) => {
      const { hostId, rootPath } = await resolveHost(bb, requireThreadId(ctx));
      await bb.sdk.files.mkdir({
        hostId,
        path: absolutePath(rootPath, path),
        rootPath,
        recursive: true,
      });
      return `Ensured directory ${path}.`;
    },
  });
}
