export type ProjectInfo = {
  root: string;
  name: string;
  /** app folder inside a monorepo, relative to root */
  subpath?: string;
  branch?: string;
  /** cwd no longer exists on disk */
  missing?: boolean;
  /** true when the folder is a linked git worktree, not the main checkout */
  isWorktree: boolean;
  /** main checkout folder when isWorktree */
  mainRepo?: string;
};

/** What a port speaks, as collect/protocol.ts tells. */
export type Protocol = "http" | "https" | "postgres" | "mysql" | "redis" | "mongodb" | "ssh" | "smtp" | "pop3" | "imap" | "socks" | "tls" | "tcp";

export type ListenAddr = { address: string; port: number };

/** Who started a listening process (see collect/origin.ts). */
export type Origin = {
  /** app, terminal multiplexer or service manager it was launched from: "Zed", "herdr", "tmux", "launchd"… */
  app?: string;
  /** terminal emulator, when it isn't the app itself */
  terminal?: string;
  /** coding agent that ran it: "Claude Code", "Codex"… */
  agent?: string;
  /** its launcher is gone: nothing that started it is still attached */
  detached: boolean;
};

/** The process a stop signals and everything below it: what the stop ends, and what it costs right now. */
export type ProcessTree = { pids: number[]; cpu: number; memMB: number };

export type LocalProcess = {
  pid: number;
  ppid: number;
  name: string;
  command: string;
  parentCommand?: string;
  cwd?: string;
  elapsed: string;
  cpu: number;
  memMB: number;
  listens: ListenAddr[];
  tech?: string;
  system: boolean;
  project?: ProjectInfo;
  /** pid to signal to stop this server: the dev CLI parent (e.g. `next dev`) rather than its worker */
  stopPid: number;
  /** `stopPid` and its descendants (the dev CLI, the server, its workers and watchers) */
  stopTree: ProcessTree;
  origin?: Origin;
};

export type ContainerAction = "start" | "stop" | "restart";

export type ContainerPort = {
  hostIp: string;
  hostPort: number;
  containerPort: number;
  proto: string;
  /** what the published port speaks, from its PortRow (this Mac only) */
  protocol?: Protocol;
};

export type Container = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  health?: string;
  startedAt?: string;
  /** when a stopped container exited */
  stoppedAt?: string;
  ports: ContainerPort[];
  /** compose project / supabase project id */
  group?: string;
  kind: "supabase" | "compose" | "container";
  workdir?: string;
  project?: ProjectInfo;
  /** from `docker stats`, refreshed in the background; undefined until the first sample or when stopped */
  cpu?: number;
  memMB?: number;
};

/** One line of `docker logs --timestamps`: when it was written, when docker says so, and the text. */
export type LogLine = { at?: string; text: string };

/** What the local Docker tab and a remote host both show (and stop) for a container. */
export type ContainerSummary = Pick<
  Container,
  "id" | "name" | "image" | "state" | "status" | "health" | "ports" | "group" | "kind" | "workdir" | "project" | "stoppedAt"
>;

/** An ssh port forward, as written (`spec`) and taken apart (see parseForward in collect/ssh.ts). */
export type Forward = {
  kind: "L" | "R" | "D";
  spec: string;
  /** -L, -D: the port opened on this Mac */
  localPort?: number;
  /** -R: the port opened on the ssh host */
  remotePort?: number;
  /** address the opened port binds to, when given */
  bind?: string;
  /** -L: where the ssh host connects ("localhost" = the host itself); -R: where on this Mac */
  destHost?: string;
  destPort?: number;
};

export type SshConnection = {
  pid: number;
  target: string;
  user?: string;
  hostname?: string;
  port?: string;
  role: "tunnel" | "session" | "multiplexed";
  managedBy?: string;
  forwards: Forward[];
  listens: ListenAddr[];
  elapsed: string;
  command: string;
  /** autossh supervisor when present, otherwise the ssh pid; killing only the child would just reconnect */
  stopPid: number;
};

export type Tunnel = {
  kind: string;
  pid?: number;
  detail: string;
  publicUrl?: string;
  target?: string;
  command?: string;
};

export type TailscalePeer = { name: string; dnsName: string; ip: string; os: string; online: boolean };

export type PortOwnerKind = "process" | "docker" | "ssh";

export type PortRow = {
  port: number;
  address: string;
  ownerKind: PortOwnerKind;
  pid: number;
  processName: string;
  /** what's actually behind the port: container name, ssh forward target, or process command */
  owner: string;
  /** for ssh forwards: the ssh target as typed (alias or user@host) */
  sshTarget?: string;
  /** for ssh forwards: resolved ssh hostname and the port it reaches on that host's loopback */
  sshHost?: string;
  remotePort?: number;
  folder?: string;
  project?: ProjectInfo;
  tech?: string;
  system: boolean;
  /** set when this port can be stopped from the UI (process or ssh tunnel, never system) */
  stopPid?: number;
  /** docker-owned ports: the container behind it (pid is only the Docker/OrbStack port proxy) */
  containerId?: string;
  /** what it speaks (collect/protocol.ts); undefined for system ports and until the first look finishes */
  protocol?: Protocol;
};

/** What you set on a port number (port-prefs.ts): pinned to the top, hidden from the lists, a note. */
export type PortPref = { pinned?: boolean; hidden?: boolean; note?: string };

/** Used and total of a resource, in bytes (memory, swap, disk). */
export type Usage = { used: number; total: number };

/** The machine itself: what it is and how loaded it is. Same shape for this Mac and remote hosts. */
export type MachineInfo = {
  hostname: string;
  /** "macOS 15.7.7", "Ubuntu 24.04.4 LTS" */
  os?: string;
  cpu?: string;
  cores?: number;
  bootedAt?: string;
  /** 1, 5 and 15 minute load averages */
  load?: [number, number, number];
  memory?: Usage;
  swap?: Usage;
  /** the volume user data lives on */
  disk?: Usage & { mount: string };
  battery?: { percent: number; charging: boolean; remaining?: string };
  /** connected VPNs by the name macOS shows (Tailscale, ProtonVPN, a WireGuard tunnel…) */
  vpn?: string[];
};

/** One row of `docker system df`: images, containers, local volumes or build cache, sizes in bytes. */
export type DockerDiskRow = { type: string; count: number; active: number; size: number; reclaimable: number };

export type Snapshot = {
  at: string;
  hostname: string;
  ports: PortRow[];
  processes: LocalProcess[];
  containers: Container[];
  ssh: SshConnection[];
  tunnels: Tunnel[];
  tailscale?: { self: string; peers: TailscalePeer[] };
  machine: MachineInfo;
  /** refreshed every couple of minutes; undefined until the first run, or without docker */
  dockerDisk?: DockerDiskRow[];
  /** your pins, hidden ports and notes, by port number */
  portPrefs?: Record<string, PortPref>;
  errors: string[];
};

export type RemoteListener = {
  address: string;
  port: number;
  process?: string;
  pid?: number;
  cwd?: string;
  command?: string;
  container?: string;
  /** OS service (sshd, systemd-resolved, tailscaled…), hidden unless "Show hidden" is on */
  system: boolean;
  origin?: Origin;
  /** set when it can be stopped from the dashboard: the dev CLI that started it (`next dev`) or the pid itself */
  stopPid?: number;
};

export type RemoteSnapshot = {
  id: number;
  name: string;
  sshTarget: string;
  /** HostName from ssh config, used to match local ssh tunnels to this host */
  resolvedHost?: string;
  ok: boolean;
  error?: string;
  hostname?: string;
  uptime?: string;
  /** probe ran with passwordless sudo, so every process is visible */
  rootView?: boolean;
  listeners: RemoteListener[];
  containers: ContainerSummary[];
  machine?: MachineInfo;
  dockerDisk?: DockerDiskRow[];
  at: string;
};
