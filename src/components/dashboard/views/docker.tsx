import type { Snapshot } from "@/lib/collect/types";
import { ContainerTable } from "../container-table";

/** Running containers on this machine, one group per compose / Supabase project. */
export function DockerView({ snap }: { snap: Snapshot }) {
  return <ContainerTable scope="docker" containers={snap.containers} empty="No running containers." />;
}
