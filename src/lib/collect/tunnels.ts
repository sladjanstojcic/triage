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

async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500), cache: "no-store" });
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
    const hit = TUNNEL_BINARIES.find(([re]) => re.test(exe));
    if (!hit) continue;
    const kind = hit[1];
    const ports = listening.find((p) => p.pid === r.pid)?.listens.map((l) => l.port) ?? [];
    const t: Tunnel = { kind, pid: r.pid, detail: r.command.split(" ").slice(1).join(" "), command: r.command };

    if (kind === "cloudflared") {
      t.target = argAfter(r.command, "--url");
      // quick tunnels expose their public hostname on the metrics server
      for (const port of ports) {
        const q = await getJson<{ hostname?: string }>(`http://127.0.0.1:${port}/quicktunnel`);
        if (q?.hostname) t.publicUrl = `https://${q.hostname}`;
      }
      tunnels.push(t);
    } else if (kind === "ngrok") {
      let found = false;
      for (const port of ports) {
        const api = await getJson<{ tunnels: { public_url: string; config: { addr: string } }[] }>(
          `http://127.0.0.1:${port}/api/tunnels`,
        );
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

/** Tailscale serve/funnel mappings, plus the tailnet peers (often where the VPS lives). */
export async function collectTailscale(): Promise<{ tunnels: Tunnel[]; status?: { self: string; peers: TailscalePeer[] } }> {
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
