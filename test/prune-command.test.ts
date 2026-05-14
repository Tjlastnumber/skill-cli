import { lstat, mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
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

async function readSourceManifestPath(storedSkillDir: string): Promise<string> {
  const raw = await readFile(join(storedSkillDir, ".skill-cli-source.json"), "utf8");
  const parsed = JSON.parse(raw) as { sourceManifestPath?: string };

  if (!parsed.sourceManifestPath) {
    throw new Error(`Missing sourceManifestPath for ${storedSkillDir}`);
  }

  return parsed.sourceManifestPath;
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

    const usedStoreDir = await readlink(join(targetDir, "alpha-skill"));
    const liveManifestPath = await readSourceManifestPath(usedStoreDir);
    const orphanStoreDir = join(storeDir, "store", "a".repeat(64));
    const orphanManifestPath = join(storeDir, "manifests", `${"b".repeat(64)}.json`);
    await mkdir(orphanStoreDir, { recursive: true });
    await writeFile(join(orphanStoreDir, "ORPHAN.txt"), "unused\n");
    await writeFile(orphanManifestPath, "{}\n");

    const result = await runPruneCommand({}, { cwd, homeDir, output: quietOutput() });

    expect(result.removedStoreEntries).toBe(1);
    expect(result.reclaimedBytes).toBeGreaterThan(0);

    await expect(lstat(orphanStoreDir)).rejects.toThrow();
    await expect(lstat(orphanManifestPath)).rejects.toThrow();
    expect((await lstat(usedStoreDir)).isDirectory()).toBe(true);
    expect((await lstat(liveManifestPath)).isFile()).toBe(true);
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

    const usedStoreDir = await readlink(join(customDir, "alpha-skill"));
    const liveManifestPath = await readSourceManifestPath(usedStoreDir);
    const orphanStoreDir = join(storeDir, "store", "c".repeat(64));
    const orphanManifestPath = join(storeDir, "manifests", `${"d".repeat(64)}.json`);
    await mkdir(orphanStoreDir, { recursive: true });
    await writeFile(orphanManifestPath, "{}\n");

    const result = await runPruneCommand({ dirs: [customDir] }, { cwd, homeDir, output: quietOutput() });

    expect(result.removedStoreEntries).toBe(1);
    await expect(lstat(orphanManifestPath)).rejects.toThrow();
    expect((await lstat(usedStoreDir)).isDirectory()).toBe(true);
    expect((await lstat(liveManifestPath)).isFile()).toBe(true);
  });

  it("keeps shared manifests while any live managed skill still references them", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-shared-manifest-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "target", "codex-global");
    const storeDir = join(base, "store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(sourceRoot, "beta-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(sourceRoot, "beta-skill", "SKILL.md"), "# beta\n");

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

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const alphaLinkPath = join(targetDir, "alpha-skill");
    const betaLinkPath = join(targetDir, "beta-skill");
    const alphaStoreDir = await readlink(alphaLinkPath);
    const sharedManifestPath = await readSourceManifestPath(alphaStoreDir);

    await rm(betaLinkPath, { force: true });

    const result = await runPruneCommand({}, { cwd, homeDir, output: quietOutput() });

    expect(result.removedStoreEntries).toBe(1);
    expect((await lstat(alphaLinkPath)).isSymbolicLink()).toBe(true);
    expect((await lstat(sharedManifestPath)).isFile()).toBe(true);
  });

  it("prunes orphan manifests when the store has no store entry directory left", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-manifests-only-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const storeDir = join(base, "store");
    const orphanManifestPath = join(storeDir, "manifests", `${"e".repeat(64)}.json`);

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
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
    await mkdir(join(storeDir, "manifests"), { recursive: true });
    await writeFile(orphanManifestPath, "{}\n");

    const result = await runPruneCommand({}, { cwd, homeDir, output: quietOutput() });

    expect(result.removedStoreEntries).toBe(0);
    await expect(lstat(orphanManifestPath)).rejects.toThrow();
  });
});
