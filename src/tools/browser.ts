import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { requireThreadId, type Registrar } from "../lib/toolkit";
import { absolutePath, resolveHost } from "../lib/resolve-host";

// Tab management and screenshots only; clicking and typing in pages needs a CDP client, which the built-in Browser Automation plugin already covers.
export function registerBrowserTools(bb: BbPluginApi, register: Registrar) {
  const browsers = bb.sdk.experimental_desktopBrowsers;
  if (!browsers) return; // host predates the 0.43 browser API; skip quietly

  // One desktop browser per host; first instance is the default target.
  async function pickInstance(threadId: string, instanceId?: string) {
    const { hostId } = await resolveHost(bb, threadId);
    const { instances } = await browsers.listInstances({ hostId });
    if (instances.length === 0) return { hostId, instance: null };
    const instance = instanceId
      ? (instances.find((i) => i.instanceId === instanceId) ?? null)
      : instances[0];
    return { hostId, instance };
  }

  register("browser", {
    name: "bbtools_browser_list",
    description:
      "List bb's desktop browser instances and their open tabs (id, title, url). Use it before bbtools_browser_open / close / capture.",
    parameters: z.object({}),
    execute: async (_params, ctx) => {
      const threadId = requireThreadId(ctx);
      const { hostId, instance } = await pickInstance(threadId);
      if (!instance) return `No bb desktop browser instance on host ${hostId}.`;
      const res = await browsers.listTabs({
        generation: instance.generation,
        hostId,
        instanceId: instance.instanceId,
        threadId,
      });
      const lines: string[] = [`instance ${instance.instanceId} (${instance.label}) on ${hostId}:`];
      for (const tab of res.tabs) {
        lines.push(`  ${tab.tabId}\t${tab.title}\t${tab.url}${tab.control ? `\t(controlled by ${tab.control.controllerLabel})` : ""}`);
      }
      return lines.join("\n");
    },
  });

  register("browser", {
    name: "bbtools_browser_open",
    description:
      "Open a URL in a new tab of bb's desktop browser. The tab belongs to the current thread and the user can watch or take it over.",
    parameters: z.object({
      url: z.string().describe("URL to open (http/https)."),
      hidden: z.boolean().optional().describe("Open without focusing the tab (default false)."),
      instanceId: z.string().optional().describe("Browser instance id from bbtools_browser_list (default: first instance)."),
    }),
    execute: async ({ url, hidden, instanceId }, ctx) => {
      const threadId = requireThreadId(ctx);
      const { hostId, instance } = await pickInstance(threadId, instanceId);
      if (!instance) return `No bb desktop browser instance on host ${hostId}.`;
      const res = await browsers.createTab({
        generation: instance.generation,
        hostId,
        instanceId: instance.instanceId,
        threadId,
        url,
        presentation: hidden ? "hidden" : "reveal",
      });
      return `Opened ${url} in tab ${res.tab.tabId} (instance ${instance.instanceId})${hidden ? ", hidden" : ""}. Use bbtools_browser_capture to screenshot it.`;
    },
  });

  register("browser", {
    name: "bbtools_browser_close",
    description: "Close a tab in bb's desktop browser.",
    parameters: z.object({
      tabId: z.string().describe("Tab id from bbtools_browser_list."),
      instanceId: z.string().optional().describe("Browser instance id (default: first instance)."),
    }),
    execute: async ({ tabId, instanceId }, ctx) => {
      const threadId = requireThreadId(ctx);
      const { hostId, instance } = await pickInstance(threadId, instanceId);
      if (!instance) return `No bb desktop browser instance on host ${hostId}.`;
      await browsers.closeTab({ generation: instance.generation, hostId, instanceId: instance.instanceId, tabId, threadId });
      return `Closed tab ${tabId}.`;
    },
  });

  register("browser", {
    name: "bbtools_browser_capture",
    description:
      "Screenshot a tab of bb's desktop browser and save it as a JPEG into the project workspace. Attach the file to view it.",
    parameters: z.object({
      tabId: z.string().describe("Tab id from bbtools_browser_list."),
      path: z.string().optional().describe("Workspace-relative .jpg path (default: .bb-agent-toolbox/capture-<n>.jpg)."),
      instanceId: z.string().optional().describe("Browser instance id (default: first instance)."),
    }),
    execute: async ({ tabId, path, instanceId }, ctx) => {
      const threadId = requireThreadId(ctx);
      const { hostId, rootPath } = await resolveHost(bb, threadId);
      const { instance } = await pickInstance(threadId, instanceId);
      if (!instance) return `No bb desktop browser instance on host ${hostId}.`;
      const shot = await browsers.captureTab({
        generation: instance.generation,
        hostId,
        instanceId: instance.instanceId,
        tabId,
        threadId,
      });
      const rel = path ?? `.bb-agent-toolbox/capture-${Date.now()}.jpg`;
      await bb.sdk.files.write({
        hostId,
        path: absolutePath(rootPath, rel),
        rootPath,
        content: shot.base64,
        contentEncoding: "base64",
        createParents: true,
      });
      return `Saved screenshot of tab ${tabId} to ${rel} (${shot.width}x${shot.height}). Attach the file to your message to view it.`;
    },
  });
}
