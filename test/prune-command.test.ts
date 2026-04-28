import { lstat, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runInstallCommand } from "../src/commands/install.js";
import { runPruneCommand } from "../src/commands/prune.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function quietOutput() {
  return {
    info: (_message: string) => {},
    warn: (_message: string) => {},
    error: (_message: string) => {},
  };
}

describe("runPruneCommand", () => {
  it("removes unreferenced store directories and keeps referenced ones", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "target", "codex-global");
    const storeDir = join(base, "store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            codex: {
              globalDir: targetDir,
            },
          },
        },
        null,
        2,
      ),
    );

    const installResult = await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const usedStoreDir = installResult.storedSourceDir;
    const orphanStoreDir = join(storeDir, "store", "orphan-cache-key");
    await mkdir(orphanStoreDir, { recursive: true });
    await writeFile(join(orphanStoreDir, "ORPHAN.txt"), "unused\n");

    const result = await runPruneCommand({}, { cwd, homeDir, output: quietOutput() });

    expect(result.removedStoreEntries).toBe(1);
    expect(result.reclaimedBytes).toBeGreaterThan(0);

    await expect(lstat(orphanStoreDir)).rejects.toThrow();
    expect((await lstat(usedStoreDir)).isDirectory()).toBe(true);
  });

  it("keeps store entries referenced by explicit custom directories", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-custom-dir-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const customDir = join(base, "custom-skills");
    const storeDir = join(base, "store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
        },
        null,
        2,
      ),
    );

    const installResult = await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "dir", dir: customDir },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const orphanStoreDir = join(storeDir, "store", "orphan-cache-key");
    await mkdir(orphanStoreDir, { recursive: true });

    const result = await runPruneCommand({ dirs: [customDir] }, { cwd, homeDir, output: quietOutput() });

    expect(result.removedStoreEntries).toBe(1);
    expect((await lstat(installResult.storedSourceDir)).isDirectory()).toBe(true);
  });
});
