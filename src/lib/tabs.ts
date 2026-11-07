/** The dashboard's tabs, in order. Each has its own URL path (/projects, …); "/" is the overview. */
export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "projects", label: "Projects" },
  { id: "ports", label: "Ports" },
  { id: "docker", label: "Docker" },
  { id: "ssh", label: "SSH & Tunnels" },
  { id: "remote", label: "Remote" },
] as const;

export type Tab = (typeof TABS)[number]["id"];

export function tabFromPath(pathname: string): Tab {
  const id = pathname.split("/")[1];
  return TABS.find((t) => t.id === id)?.id ?? "overview";
}
