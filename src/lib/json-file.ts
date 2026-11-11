// The small JSON files Triage keeps in ~/.config/triage (hosts, port settings): read with a fallback,
// written atomically, and one write at a time so two quick changes can't overwrite each other.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJson<T>(file: string, missing: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return missing;
    throw e;
  }
}

/** `update(fn)` reads the file, applies `fn` and writes the result; `fn` returning null leaves it as is (resolves false). */
export function jsonFile<T>(file: string, missing: T) {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    read: () => readJson(file, missing),
    update(fn: (value: T) => T | null): Promise<boolean> {
      const next = queue.then(async () => {
        const value = fn(await readJson(file, missing));
        if (value === null) return false;
        await mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
        await rename(tmp, file);
        return true;
      });
      queue = next.catch(() => {});
      return next;
    },
  };
}
