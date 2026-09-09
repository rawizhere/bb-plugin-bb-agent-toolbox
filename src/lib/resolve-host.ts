import { type BbPluginApi } from "@get-bb/plugin-sdk";

// Resolve the current thread's host + workspace root so tools can address the
// project's files with proper confinement.
export async function resolveHost(
  bb: BbPluginApi,
  threadId: string,
): Promise<{ hostId: string; rootPath: string | undefined; environmentId?: string }> {
  const thread = await bb.sdk.threads.get({ threadId, include: "environment" });
  const hostId = "environment" in thread ? thread.environment?.hostId : undefined;
  const rootPath = "environment" in thread ? (thread.environment?.path ?? undefined) : undefined;
  const environmentId = "environment" in thread ? (thread.environment?.id ?? undefined) : undefined;
  if (!hostId && !environmentId) throw new Error(`No environment available for thread ${threadId}`);
  return { hostId: hostId ?? "", rootPath, environmentId };
}

export function absolutePath(rootPath: string | undefined, rel: string): string {
  return rootPath && rel
    ? `${rootPath.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`
    : (rel || rootPath || "");
}
