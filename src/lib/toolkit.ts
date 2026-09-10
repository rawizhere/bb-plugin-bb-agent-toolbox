import { type BbContext, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z, type ZodObject, type ZodRawShape } from "zod";

// Tool groups; each maps to a plugin-settings flag checked live at call time.
export type ToolGroup = "threads" | "workspace" | "terminals";
export type Flags = Record<string, boolean>;

const OUTPUT_LIMIT = 16_000;

// Tool output goes into the model context, so cap it and say by how much.
export function truncateOutput(text: string, limit = OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n... [truncated ${text.length - limit} chars]`;
}

export type Tool<S extends ZodRawShape> = {
  name: string;
  description: string;
  parameters: ZodObject<S>;
  execute: (params: z.output<ZodObject<S>>, ctx: BbContext) => Promise<string>;
};

// Generic on the registrar itself, so tools register as plain object literals.
export type Registrar = <S extends ZodRawShape>(group: ToolGroup, def: Tool<S>) => void;

export type RegisteredTool = { name: string; group: ToolGroup };
export type GroupFlags = Record<ToolGroup, keyof Flags>;

// Register once, gate on the live flag at execute time; toggles apply without a reload.
export function makeRegistrar(bb: BbPluginApi, flags: Flags, groupFlags: GroupFlags): { register: Registrar; registry: RegisteredTool[] } {
  const registry: RegisteredTool[] = [];
  const register: Registrar = (group, def) => {
    registry.push({ name: def.name, group });
    bb.agents.registerTool({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
      execute: async (params, ctx) => {
        if (!flags[groupFlags[group]])
          return `This tool group (${group}) is disabled in the bb-agent-toolbox plugin settings.`;
        try {
          return truncateOutput(await def.execute(params, ctx));
        } catch (err) {
          return `Error: ${(err as Error).message}`;
        }
      },
    });
  };
  return { register, registry };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function threadTitle(t: { title?: string | null; titleFallback?: string | null; id: string }): string {
  return t.title ?? t.titleFallback ?? "(untitled)";
}

export function requireThreadId(ctx: BbContext): string {
  if (!ctx.threadId) throw new Error("No thread context; this tool must run inside a thread.");
  return ctx.threadId;
}

export function requireProjectId(ctx: BbContext): string {
  if (!ctx.projectId) throw new Error("No project context; this tool must run inside a project thread.");
  return ctx.projectId;
}
