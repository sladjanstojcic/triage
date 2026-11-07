import type { Snapshot } from "@/lib/collect/types";
import { ContainerTable } from "../container-table";

/** Containers on this machine (running, plus recently stopped ones), one group per compose / Supabase project. */
export function DockerView({ snap }: { snap: Snapshot }) {
  return <ContainerTable scope="docker" containers={snap.containers} empty="No containers." />;
}
