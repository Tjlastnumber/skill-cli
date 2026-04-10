import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

async function hasGitMarker(dir: string): Promise<boolean> {
  const marker = join(dir, ".git");

  try {
    await access(marker);
    return true;
  } catch {
    return false;
  }
}

export async function findProjectRoot(cwd: string): Promise<string> {
  const start = resolve(cwd);
  let current = start;

  while (true) {
    if (await hasGitMarker(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return start;
    }

    current = parent;
  }
}
