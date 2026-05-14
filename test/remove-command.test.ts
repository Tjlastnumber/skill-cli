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
  it("removes exactly one managed skill when --skill matches a single candidate", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-remove-skill-"));
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
    expect((await lstat(alphaLinkPath)).isSymbolicLink()).toBe(true);
    expect((await lstat(betaLinkPath)).isSymbolicLink()).toBe(true);

    const result = await runRemoveCommand(
      {
        skillName: "alpha-skill",
        tool: "codex",
        target: { type: "global" },
      },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(result.removedBundles).toBe(0);
    expect(result.removedLinkPaths).toEqual([alphaLinkPath]);
    await expect(lstat(alphaLinkPath)).rejects.toThrow();
    expect((await lstat(betaLinkPath)).isSymbolicLink()).toBe(true);
  });

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

  it("removes only the selected duplicate-name managed skill candidate", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-remove-duplicate-skill-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const alphaSourceRoot = join(cwd, "alpha-source");
    const betaSourceRoot = join(cwd, "beta-source");
    const targetDir = join(base, "target", "codex-global");
    const storeDir = join(base, "store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(alphaSourceRoot, "shared-skill"), { recursive: true });
    await mkdir(join(betaSourceRoot, "shared-skill"), { recursive: true });
    await writeFile(join(alphaSourceRoot, "shared-skill", "SKILL.md"), "# alpha shared\n");
    await writeFile(join(betaSourceRoot, "shared-skill", "SKILL.md"), "# beta shared\n");

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
        source: "alpha-source/shared-skill",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );
    await runInstallCommand(
      {
        source: "beta-source/shared-skill",
        tool: "codex",
        target: { type: "dir", dir: join(base, "second-target") },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const globalLinkPath = join(targetDir, "shared-skill");
    const secondTargetLinkPath = join(base, "second-target", "shared-skill");
    expect((await lstat(globalLinkPath)).isSymbolicLink()).toBe(true);
    expect((await lstat(secondTargetLinkPath)).isSymbolicLink()).toBe(true);

    const result = await runRemoveCommand(
      {
        skillName: "shared-skill",
        tool: "codex",
        target: { type: "global" },
      },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(result.removedBundles).toBe(0);
    expect(result.removedLinkPaths).toEqual([globalLinkPath]);
    await expect(lstat(globalLinkPath)).rejects.toThrow();
    expect((await lstat(secondTargetLinkPath)).isSymbolicLink()).toBe(true);
  });
});
