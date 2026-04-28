import { lstat, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runInstallCommand } from "../src/commands/install.js";
import { runRemoveCommand } from "../src/commands/remove.js";

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

describe("runRemoveCommand", () => {
  it("removes a live managed bundle without registry lookups", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-remove-"));
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

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const linkPath = join(targetDir, "alpha-skill");
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);

    const result = await runRemoveCommand(
      {
        bundleName: "skills-source",
        tool: "codex",
        target: { type: "global" },
      },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(result.removedBundles).toBe(1);
    expect(result.removedLinkPaths).toHaveLength(1);
    await expect(lstat(linkPath)).rejects.toThrow();
  });

  it("does not remove discovered bundles that only match by derived bundle name", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-remove-discovered-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetDir = join(base, "target", "codex-global");
    const externalBundleRoot = join(base, "external", "skills-source");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(targetDir), { recursive: true });
    await mkdir(join(externalBundleRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(externalBundleRoot, "beta-skill"), { recursive: true });
    await writeFile(join(externalBundleRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(externalBundleRoot, "beta-skill", "SKILL.md"), "# beta\n");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir: join(base, "store"),
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

    await symlink(join(externalBundleRoot, "alpha-skill"), join(targetDir, "alpha-skill"), "dir");
    await symlink(join(externalBundleRoot, "beta-skill"), join(targetDir, "beta-skill"), "dir");

    const result = await runRemoveCommand(
      {
        bundleName: "skills-source",
        tool: "codex",
        target: { type: "global" },
      },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(result.removedBundles).toBe(0);
    expect(result.removedLinkPaths).toHaveLength(0);
    expect((await lstat(join(targetDir, "alpha-skill"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(targetDir, "beta-skill"))).isSymbolicLink()).toBe(true);
  });
});
