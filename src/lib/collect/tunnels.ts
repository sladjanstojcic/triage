import { run } from "@/lib/exec";
import type { PsRow } from "./local";
import type { LocalProcess, TailscalePeer, Tunnel } from "./types";

const TUNNEL_BINARIES: [RegExp, string][] = [
  [/(^|\/)cloudflared$/, "cloudflared"],
  [/(^|\/)ngrok$/, "ngrok"],
  [/(^|\/)(lt|localtunnel)$/, "localtunnel"],
  [/(^|\/)bore$/, "bore"],
  [/(^|\/)zrok$/, "zrok"],
  [/(^|\/)frpc$/, "frp"],
  [/(^|\/)devtunnel$/, "devtunnel"],
  [/(^|\/)expose$/, "expose"],
];

/** What `kubectl port-forward` reaches: the resource, its namespace and context, and local → remote ports. */
export type PortForward = { resource: string; namespace?: string; context?: string; forwards: { local?: number; remote: number }[] };

// flags of kubectl port-forward (and kubectl's global ones) that take a value
const KUBECTL_VALUE_FLAGS = new Set(["-n", "--namespace", "--context", "--address", "--pod-running-timeout", "--kubeconfig", "--cluster", "--user", "-s", "--server"]);

/** `kubectl [-n ns] port-forward svc/web 8080:80 :9090` → svc/web, ns, [8080→80, ?→9090]; undefined if it isn't one. */
export function parsePortForward(command: string): PortForward | undefined {
  const tokens = command.split(/\s+/);
  if (!/(^|\/)kubectl$/.test(tokens[0] ?? "") || !tokens.includes("port-forward")) return undefined;
  const out: PortForward = { resource: "", forwards: [] };
  let after = false;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const [flag, inline] = t.startsWith("-") ? t.split(/=(.*)/s) : [t];
    if (t.startsWith("-")) {
      const value = inline ?? (KUBECTL_VALUE_FLAGS.has(flag) ? tokens[++i] : undefined);
      if (flag === "-n" || flag === "--namespace") out.namespace = value;
      if (flag === "--context") out.context = value;
      continue;
    }
    // the resource and ports come after the subcommand; before it there are only kubectl's own flags
    if (t === "port-forward") after = true;
    if (!after || t === "port-forward") continue;
    const ports = t.match(/^(\d*):(\d+)$/) ?? t.match(/^()(\d+)$/);
    if (out.resource && ports) {
      const remote = Number(ports[2]);
      // "8080" forwards 8080 to 8080; ":80" lets kubectl pick the local port
      out.forwards.push({ local: ports[1] === "" ? (t.includes(":") ? undefined : remote) : Number(ports[1]), remote });
    } else if (!out.resource) {
      out.resource = t.includes("/") ? t : `pod/${t}`;
    }
  }
  return out.resource ? out : undefined;
}

async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

function argAfter(cmd: string, flag: string) {
  const m = cmd.match(new RegExp(`${flag}[ =](\\S+)`));
  return m?.[1];
}

export async function collectTunnels(ps: Map<number, PsRow>, listening: LocalProcess[]): Promise<Tunnel[]> {
  const tunnels: Tunnel[] = [];

  for (const r of ps.values()) {
    const exe = r.command.split(" ")[0];
    const pf = parsePortForward(r.command);
    if (pf) {
      const local = listening.find((p) => p.pid === r.pid)?.listens.map((l) => l.port) ?? [];
      const where = [pf.namespace && `namespace ${pf.namespace}`, pf.context && `context ${pf.context}`].filter(Boolean).join(", ");
      tunnels.push({
        kind: "kubectl",
        pid: r.pid,
        command: r.command,
        target: `${pf.resource}${where ? ` (${where})` : ""}`,
        // a random local port (":80") shows up only once kubectl listens
        detail: pf.forwards.map((f, i) => `:${f.local ?? local[i] ?? "?"} → ${pf.resource}:${f.remote}`).join(", "),
      });
      continue;
    }
    const hit = TUNNEL_BINARIES.find(([re]) => re.test(exe));
    if (!hit) continue;
    const kind = hit[1];
    const ports = listening.find((p) => p.pid === r.pid)?.listens.map((l) => l.port) ?? [];
    const t: Tunnel = { kind, pid: r.pid, detail: r.command.split(" ").slice(1).join(" "), command: r.command };

    if (kind === "cloudflared") {
      t.target = argAfter(r.command, "--url");
      // quick tunnels expose their public hostname on the metrics server
      const answers = await Promise.all(ports.map((port) => getJson<{ hostname?: string }>(`http://127.0.0.1:${port}/quicktunnel`)));
      for (const q of answers) if (q?.hostname) t.publicUrl = `https://${q.hostname}`;
      tunnels.push(t);
    } else if (kind === "ngrok") {
      let found = false;
      const apis = await Promise.all(
        ports.map((port) =>
          getJson<{ tunnels: { public_url: string; config: { addr: string } }[] }>(`http://127.0.0.1:${port}/api/tunnels`),
        ),
      );
      for (const api of apis) {
        for (const nt of api?.tunnels ?? []) {
          found = true;
          tunnels.push({ ...t, publicUrl: nt.public_url, target: nt.config.addr });
        }
      }
      if (!found) tunnels.push(t);
    } else {
      t.target = argAfter(r.command, "--port") ?? argAfter(r.command, "local");
      tunnels.push(t);
    }
  }
  return tunnels;
}

type TsServe = {
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string; Path?: string; Text?: string }> }>;
  TCP?: Record<string, { TCPForward?: string }>;
  AllowFunnel?: Record<string, boolean>;
};

type TsStatus = {
  Self?: { DNSName: string };
  Peer?: Record<string, { HostName: string; DNSName: string; TailscaleIPs: string[]; OS: string; Online: boolean }>;
};

// The two tailscale CLI calls cost ~300 ms together, and serve config and peers rarely change.
const TAILSCALE_TTL_MS = 15_000;
let tailscale: { at: number; result: ReturnType<typeof readTailscale> } | undefined;

/** Tailscale serve/funnel mappings, plus the tailnet peers (often where the VPS lives); at most 15 s old. */
export function collectTailscale() {
  if (!tailscale || Date.now() - tailscale.at >= TAILSCALE_TTL_MS) tailscale = { at: Date.now(), result: readTailscale() };
  return tailscale.result;
}

async function readTailscale(): Promise<{ tunnels: Tunnel[]; status?: { self: string; peers: TailscalePeer[] } }> {
  const [statusRes, serveRes] = await Promise.all([
    run("tailscale", ["status", "--json"], 3000),
    run("tailscale", ["serve", "status", "--json"], 3000),
  ]);
  if (!statusRes.stdout.trim().startsWith("{")) return { tunnels: [] };

  const tunnels: Tunnel[] = [];
  try {
    const serve = JSON.parse(serveRes.stdout || "{}") as TsServe;
    for (const [hostPort, web] of Object.entries(serve.Web ?? {})) {
      const funnel = serve.AllowFunnel?.[hostPort];
      for (const [p, h] of Object.entries(web.Handlers ?? {})) {
        tunnels.push({
          kind: funnel ? "tailscale funnel" : "tailscale serve",
          detail: funnel ? "public internet" : "tailnet only",
          publicUrl: `https://${hostPort.replace(/:443$/, "")}${p}`,
          target: h.Proxy ?? h.Path ?? h.Text,
        });
      }
    }
    for (const [port, tcp] of Object.entries(serve.TCP ?? {})) {
      if (tcp.TCPForward) tunnels.push({ kind: "tailscale serve", detail: `tcp :${port}`, target: tcp.TCPForward });
    }
  } catch {
    /* serve status not available on this tailscale version */
  }

  let status: { self: string; peers: TailscalePeer[] } | undefined;
  try {
    const s = JSON.parse(statusRes.stdout) as TsStatus;
    status = {
      self: s.Self?.DNSName.replace(/\.$/, "") ?? "",
      peers: Object.values(s.Peer ?? {})
        .map((p) => {
          const dnsName = p.DNSName.replace(/\.$/, "");
          // The MagicDNS label is the name the Tailscale app shows; HostName is what the OS reports
          // ("localhost" on iOS).
          const name = dnsName.split(".")[0] || p.HostName;
          return { name, dnsName, ip: p.TailscaleIPs[0], os: p.OS, online: p.Online };
        })
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
    };
  } catch {
    /* ignore */
  }
  return { tunnels, status };
}
