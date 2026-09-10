// Exposes bb SDK surfaces (threads, workspace, terminals) to any provider's agent sessions as agent tools.
// Shared memory is not here on purpose; the built-in Memory plugin already covers it.
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { type Flags, makeRegistrar, type ToolGroup } from "./src/lib/toolkit";
import { registerThreadTools } from "./src/tools/threads";
import { registerWorkspaceTools } from "./src/tools/workspace";
import { registerTerminalTools } from "./src/tools/terminals";

const GROUP_BLURBS: Record<ToolGroup, string> = {
  threads:
    "inspect, message, create, wait for, retry, stop, archive, and read other bb threads directly to coordinate, delegate, or hand off work",
  workspace: "orient across projects and read/write workspace files",
  terminals: "run and drive bb terminal sessions the user can watch live",
};

const GROUP_FLAGS: Record<ToolGroup, keyof Flags> = {
  threads: "enableThreads",
  workspace: "enableWorkspace",
  terminals: "enableTerminals",
};

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  // Group toggles control what agents can touch; enableInteractionRespond (default off) gates approvals.
  const settings = bb.settings.define({
    enableThreads: {
      type: "boolean",
      label: "Expose thread coordination tools to agents",
      default: true,
    },
    enableWorkspace: {
      type: "boolean",
      label: "Expose workspace tools to agents",
      default: true,
    },
    enableTerminals: {
      type: "boolean",
      label: "Expose terminal tools to agents",
      default: true,
    },
    enableInteractionRespond: {
      type: "boolean",
      label: "Allow agents to respond to other threads' interactions (approvals and questions)",
      default: false,
    },
  });
  const flags: Flags = {
    enableThreads: true,
    enableWorkspace: true,
    enableTerminals: true,
    enableInteractionRespond: false,
  };
  void settings.get().then((values) => Object.assign(flags, values));
  settings.onChange((next) => Object.assign(flags, next));

  // Register tools; the registrar gates on the live flag, catches errors, and truncates output.
  const { register, registry } = makeRegistrar(bb, flags, GROUP_FLAGS);
  registerThreadTools(bb, flags, register);
  registerWorkspaceTools(bb, register);
  registerTerminalTools(bb, register);

  // Instructions appended to thread sessions; reads live flags, so it follows settings changes.
  bb.agents.contributeInstructions(() => {
    const lines: string[] = ["You have bb integration tools available:"];
    for (const group of ["threads", "workspace", "terminals"] as ToolGroup[]) {
      const names = registry.filter((t) => t.group === group && flags[GROUP_FLAGS[group]]).map((t) => t.name);
      if (names.length === 0) continue;
      lines.push(`- ${names.join(" / ")}: ${GROUP_BLURBS[group]}.`);
    }
    if (flags.enableThreads && !flags.enableInteractionRespond) {
      lines.push(
        "- bbtools_thread_interaction_respond is disabled by the enableInteractionRespond plugin setting; you can list other threads' pending interactions but not answer them.",
      );
    }
    lines.push(
      "After spawning or messaging another thread, prefer bbtools_thread_wait over repeated bbtools_thread_get polling.",
    );
    lines.push(
      "Prefer these over guessing when you need cross-thread state or bb project context.",
    );
    return lines.join("\n");
  });

  // CLI to inspect the tool groups and their enabled state.
  bb.cli.register({
    name: "bb-agent-toolbox",
    summary: "Inspect the BB Agent Toolbox plugin's tool groups",
    commands: [
      {
        name: "status",
        summary: "Show the plugin's tool groups and their enabled state",
        usage: "bb bb-agent-toolbox status [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const groups: ToolGroup[] = ["threads", "workspace", "terminals"];
      const tools = registry.filter((t) => flags[GROUP_FLAGS[t.group]]).map((t) => t.name);
      const enabledGroups = groups.filter((g) => flags[GROUP_FLAGS[g]]);
      const summary = Object.fromEntries(enabledGroups.map((g) => [g, true]));
      const text = [
        ...groups.map((g) => `${g.padEnd(10)} ${flags[GROUP_FLAGS[g]] ? "on" : "off"}`),
        `respond to interactions: ${flags.enableInteractionRespond ? "on" : "off"}`,
        `tools (${tools.length}): ${tools.join(", ")}`,
      ].join("\n");
      return {
        exitCode: 0,
        stdout: json ? JSON.stringify({ ...summary, enableInteractionRespond: flags.enableInteractionRespond, tools }) : text,
        stderr: "",
      };
    },
  });
}
