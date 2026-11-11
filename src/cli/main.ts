// `triage`: the dashboard's answers in a terminal, and an MCP server for coding agents. It talks to the
// running Triage server (the app, pnpm start or the LaunchAgent), which re-scans before every stop.
// Built to dist/triage.mjs (`pnpm build`).
import { createInterface } from "node:readline/promises";
import { attentionItems } from "@/lib/attention";
import { formatMem } from "@/lib/format";
import { findConflicts, groupByProject } from "@/lib/grouping";
import { type PortReport, portReports, stopPlan, whoIs } from "@/lib/report";
import { DEFAULT_URL, triageClient } from "@/lib/server-client";
import pkg from "../../package.json";
import { serveMcp } from "./mcp";

const HELP = `triage ${pkg.version}: what runs on this Mac, from a terminal or a coding agent

  triage                       what needs attention, and each project's ports
  triage ports [--all]         listening ports; --all adds system services
  triage who <port>            what is on a port, who started it, what a stop takes down
  triage stop <port>           stop it after showing what else goes down
        [--yes] [--force]      --yes skips the question, --force sends SIGKILL
  triage mcp                   MCP server on stdio, for coding agents

  --json        machine-readable output (status, ports, who)
  --remote      status: also probe the remote hosts (slower)
  TRIAGE_URL    where Triage runs (default ${DEFAULT_URL})`;

const LEVEL = { error: "✗", warn: "!", info: "·" };

/** Columns padded to their widest cell; the last one is never padded. */
function table(rows: string[][]) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((cell, i) => (i < r.length - 1 ? cell.padEnd(widths[i]) : cell)).join("  ").trimEnd()).join("\n");
}

const portLine = (p: PortReport) => [
  `:${p.port}`,
  p.protocol ?? "",
  p.project ?? "",
  p.owner.length > 60 ? `${p.owner.slice(0, 59)}…` : p.owner,
  String(p.pid),
  [p.startedBy, p.detached && "launcher gone", p.exposed && "open to network"].filter(Boolean).join(", "),
];

async function main(argv: string[]) {
  const flags = new Set(argv.filter((a) => a.startsWith("-")));
  const [command = "status", arg] = argv.filter((a) => !a.startsWith("-"));
  const json = flags.has("--json");
  const print = (data: unknown, text: () => string) => console.log(json ? JSON.stringify(data, null, 2) : text());
  const api = triageClient(process.env.TRIAGE_URL ?? DEFAULT_URL);

  if (flags.has("--help") || flags.has("-h") || command === "help") return console.log(HELP);
  if (flags.has("--version")) return console.log(pkg.version);
  if (command === "mcp") return serveMcp(api, pkg.version);

  if (command === "status") {
    const [snap, remote] = await Promise.all([api.snapshot(), flags.has("--remote") ? api.remote() : undefined]);
    const items = attentionItems(snap, remote, findConflicts(snap.ports));
    const projects = groupByProject(snap, false).filter((g) => !g.key.startsWith("~~"));
    return print({ attention: items, projects: projects.map((g) => ({ title: g.title, ports: g.ports.map((p) => p.port), usage: g.usage })) }, () =>
      [
        items.length ? "Needs attention" : "Nothing needs attention",
        ...items.map((i) => `  ${LEVEL[i.level]} ${i.machine === snap.machine.hostname ? "" : `${i.machine}: `}${i.text}${i.detail ? `  (${i.detail})` : ""}`),
        "",
        projects.length ? "Projects" : "No dev servers running",
        table(
          projects.map((g) => [
            `  ${g.title}`,
            [...new Set([...g.ports.map((p) => p.port), ...g.containers.flatMap((c) => c.ports.map((p) => p.hostPort))])]
              .sort((a, b) => a - b)
              .map((p) => `:${p}`)
              .join(" "),
            `${formatMem(g.usage.memMB)} · ${g.usage.cpu}% CPU`,
          ]),
        ),
      ].join("\n"),
    );
  }

  if (command === "ports") {
    const ports = portReports(await api.snapshot(), flags.has("--all"));
    return print(ports, () => (ports.length ? table([["PORT", "PROTOCOL", "PROJECT", "OWNER", "PID", "STARTED BY"], ...ports.map(portLine)]) : "No ports listening"));
  }

  const port = Number(arg);
  if ((command === "who" || command === "stop") && !(Number.isInteger(port) && port > 0 && port < 65536)) {
    throw new Error(`Usage: triage ${command} <port>`);
  }

  if (command === "who") {
    const who = whoIs(await api.snapshot(), port);
    return print(who, () =>
      who.listeners.length === 0
        ? `Nothing is listening on :${port}`
        : [
            ...who.listeners.map((p) =>
              [
                `:${p.port} on ${p.address}${p.protocol ? `, ${p.protocol}` : ""}${p.exposed ? " (open to your network)" : ""}`,
                p.kind === "docker" ? `  docker   ${p.owner}` : `  command  ${p.command ?? p.owner}`,
                // a container's port is held by the Docker or OrbStack proxy, whose pid says nothing
                p.kind !== "docker" && `  pid      ${p.pid}`,
                p.project && `  project  ${p.project}${p.branch ? ` (${p.branch})` : ""}`,
                p.folder && `  folder   ${p.folder}`,
                p.startedBy && `  started  ${p.startedBy}${p.detached ? ", launcher gone" : ""}`,
              ]
                .filter(Boolean)
                .join("\n"),
            ),
            "",
            who.stop.target ? `triage stop ${port}: ${who.stop.action}` : `Can't stop: ${who.stop.error}`,
            ...who.stop.alsoGoesDown.map((l) => `  also goes down: ${l}`),
          ].join("\n"),
    );
  }

  if (command === "stop") {
    const plan = stopPlan(await api.snapshot(), port);
    if (!plan.target) throw new Error(plan.error);
    console.log(`${plan.title}\n${plan.action}`);
    if (plan.alsoGoesDown.length) console.log(`Also goes down:\n${plan.alsoGoesDown.map((l) => `  • ${l}`).join("\n")}`);
    if (!flags.has("--yes")) {
      if (!process.stdin.isTTY) throw new Error("Not stopped: add --yes to stop without the question");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question("Stop it? [y/N] ");
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim())) return console.log("Not stopped");
    }
    if ("pid" in plan.target) await api.stopProcess(plan.target.pid, flags.has("--force"));
    else await api.stopContainers(plan.target.containerIds);
    return console.log("Stopped");
  }

  throw new Error(`Unknown command ${command}. Run triage --help.`);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
