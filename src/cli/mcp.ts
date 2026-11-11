// `triage mcp`: an MCP server on stdio, so a coding agent can ask what runs on a port and stop it safely.
// The protocol subset a tools-only server needs (initialize, ping, tools/list, tools/call) is small enough
// to speak directly: newline-delimited JSON-RPC 2.0, stdout for messages only, logs on stderr.
import { createInterface } from "node:readline";
import { attentionItems } from "@/lib/attention";
import { findConflicts } from "@/lib/grouping";
import { portReports, stopPlan, whoIs } from "@/lib/report";
import type { triageClient } from "@/lib/server-client";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const TOOLS = [
  {
    name: "list_ports",
    title: "List listening ports",
    description:
      "Every TCP port listening on this Mac: the dev server, container or ssh tunnel behind it, its project folder and git branch, " +
      "and which agent, app or terminal started it. Use it before starting a server to pick a free port, or to find a server you started earlier.",
    inputSchema: {
      type: "object",
      properties: { all: { type: "boolean", description: "Include system services and apps (default false)" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "who_is_on_port",
    title: "Who is on a port",
    description: "What listens on one port: process or container, command, folder, who started it, and what stopping it would take down.",
    inputSchema: {
      type: "object",
      properties: { port: { type: "integer", minimum: 1, maximum: 65535 } },
      required: ["port"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "needs_attention",
    title: "What needs attention",
    description:
      "Problems Triage sees: a port bound twice, servers whose launcher is gone, servers left idle for a day, unhealthy containers, a full disk. " +
      "With remote: true it also probes the remote hosts added in Triage over ssh, which takes a few seconds.",
    inputSchema: {
      type: "object",
      properties: { remote: { type: "boolean", description: "Include remote hosts (default false)" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "stop_port",
    title: "Stop what is on a port",
    description:
      "Stops the dev server (through the CLI that started it, such as next dev), ssh tunnel or container on a port. " +
      "Without confirm it only returns what would stop and what else goes down with it; show that to the user, then call again with confirm: true. " +
      "System services and ports shared by two owners are refused.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "integer", minimum: 1, maximum: 65535 },
        confirm: { type: "boolean", description: "true to really stop it (default false: preview only)" },
        force: { type: "boolean", description: "SIGKILL instead of SIGTERM, for a process that ignores SIGTERM (default false)" },
      },
      required: ["port"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
];

type Args = Record<string, unknown>;
type Client = ReturnType<typeof triageClient>;

/** A tool's result as data; thrown errors become an error result the agent can read. */
async function callTool(api: Client, name: string, args: Args): Promise<unknown> {
  const port = Number(args.port);
  if ((name === "who_is_on_port" || name === "stop_port") && !(Number.isInteger(port) && port > 0 && port < 65536)) {
    throw new Error("port must be a whole number from 1 to 65535");
  }
  if (name === "list_ports") return portReports(await api.snapshot(), args.all === true);
  if (name === "who_is_on_port") return whoIs(await api.snapshot(), port);
  if (name === "needs_attention") {
    const [snap, remote] = await Promise.all([api.snapshot(), args.remote === true ? api.remote() : undefined]);
    // key and tab are the dashboard's own bookkeeping
    return attentionItems(snap, remote, findConflicts(snap.ports)).map((i) => ({
      level: i.level,
      machine: i.machine,
      text: i.text,
      detail: i.detail,
      stopPid: i.stopPid,
    }));
  }
  if (name === "stop_port") {
    const plan = stopPlan(await api.snapshot(), port);
    if (!plan.target) throw new Error(plan.error);
    if (args.confirm !== true) return { stopped: false, ...plan, next: "Call stop_port again with confirm: true to stop it." };
    if ("pid" in plan.target) await api.stopProcess(plan.target.pid, args.force === true);
    else await api.stopContainers(plan.target.containerIds);
    return { stopped: true, title: plan.title, alsoWentDown: plan.alsoGoesDown };
  }
  throw new Error(`Unknown tool ${name}`);
}

export function serveMcp(api: Client, version: string) {
  const send = (msg: object) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);

  async function handle(msg: { id?: string | number | null; method?: string; params?: Args }) {
    const { id, method, params = {} } = msg;
    // a notification (no id) never gets a reply
    if (id === undefined) return;
    if (method === "initialize") {
      const asked = String(params.protocolVersion ?? "");
      return send({
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "triage", title: "Triage", version },
          instructions:
            "Triage watches this Mac's listening ports, dev servers, Docker containers and ssh tunnels. Ask it before you pick a port, " +
            "and use stop_port (preview first) instead of kill or lsof when a port is taken.",
        },
      });
    }
    if (method === "ping") return send({ id, result: {} });
    if (method === "tools/list") return send({ id, result: { tools: TOOLS } });
    if (method === "tools/call") {
      try {
        const data = await callTool(api, String(params.name), (params.arguments ?? {}) as Args);
        return send({ id, result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] } });
      } catch (e) {
        return send({ id, result: { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true } });
      }
    }
    send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }

  createInterface({ input: process.stdin }).on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ id: null, error: { code: -32700, message: "Parse error" } });
    }
    void handle(msg);
  });
  console.error(`Triage MCP server ${version} on stdio`);
}
