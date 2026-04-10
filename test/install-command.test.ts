import { mkdtemp, mkdir, readFile, readlink, rm, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runInstallCommand } from "../src/commands/install.js";

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

describe("runInstallCommand", () => {
  it("installs local source skill into global target via symlink", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-global-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });

    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");

    const targetDir = join(base, "tool-target", "codex-global");
    const storeDir = join(base, "skill-store");

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
      {
        cwd,
        homeDir,
        output: quietOutput(),
      },
    );

    const linkPath = join(targetDir, "alpha-skill");

    const linkStat = await lstat(linkPath);
    expect(linkStat.isSymbolicLink()).toBe(true);

    const linkTarget = await readlink(linkPath);
    expect(linkTarget.startsWith(join(storeDir, "store"))).toBe(true);

    const storedContent = await readFile(join(linkTarget, "SKILL.md"), "utf8");
    expect(storedContent).toContain("# alpha");

    const registryRaw = await readFile(join(storeDir, "registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as {
      bundles: Array<{
        tool: string;
        bundleName: string;
        members: Array<{ skillName: string }>;
      }>;
    };
    expect(registry.bundles).toHaveLength(1);
    expect(registry.bundles[0]).toMatchObject({
      tool: "codex",
      bundleName: "skills-source",
    });
    expect(registry.bundles[0]?.members).toHaveLength(1);
    expect(registry.bundles[0]?.members[0]).toMatchObject({
      skillName: "alpha-skill",
    });
  });

  it("fails on existing target when force is false", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-conflict-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");

    const targetDir = join(base, "tool-target", "codex-global");
    const conflictPath = join(targetDir, "alpha-skill");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(conflictPath, { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir: join(base, "skill-store"),
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

    await expect(
      runInstallCommand(
        {
          source: "skills-source",
          tool: "codex",
          target: { type: "global" },
          force: false,
        },
        { cwd, homeDir, output: quietOutput() },
      ),
    ).rejects.toThrow(/already exists/);
  });

  it("replaces existing target when force is true", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-force-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");

    const targetDir = join(base, "tool-target", "codex-global");
    const conflictPath = join(targetDir, "alpha-skill");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(conflictPath, { recursive: true });
    await writeFile(join(conflictPath, "OLD.txt"), "old");

    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir: join(base, "skill-store"),
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
        force: true,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const linkStat = await lstat(conflictPath);
    expect(linkStat.isSymbolicLink()).toBe(true);
  });

  it("refreshes managed local installs when source content changes", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-refresh-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "tool-target", "codex-global");
    const storeDir = join(base, "skill-store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha v1\n");

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
    const firstLinkTarget = await readlink(linkPath);
    expect(await readFile(join(firstLinkTarget, "SKILL.md"), "utf8")).toContain("v1");

    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha v2\n");

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const secondLinkTarget = await readlink(linkPath);
    expect(secondLinkTarget).not.toBe(firstLinkTarget);
    expect(await readFile(join(secondLinkTarget, "SKILL.md"), "utf8")).toContain("v2");

    const registryRaw = await readFile(join(storeDir, "registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as { bundles: Array<{ bundleName: string }> };
    expect(registry.bundles).toHaveLength(1);
    expect(registry.bundles[0]?.bundleName).toBe("skills-source");
  });

  it("rolls back earlier links when a later member install fails", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-rollback-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "tool-target", "codex-global");
    const storeDir = join(base, "skill-store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(sourceRoot, "beta-skill"), { recursive: true });
    await mkdir(join(targetDir, "beta-skill"), { recursive: true });
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

    await expect(
      runInstallCommand(
        {
          source: "skills-source",
          tool: "codex",
          target: { type: "global" },
          force: false,
        },
        { cwd, homeDir, output: quietOutput() },
      ),
    ).rejects.toThrow(/already exists/);

    await expect(lstat(join(targetDir, "alpha-skill"))).rejects.toThrow();
    await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
  });

  it("does not overwrite user-modified targets during managed refresh without force", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-user-modified-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "tool-target", "codex-global");
    const storeDir = join(base, "skill-store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha v1\n");

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
    await rm(linkPath, { recursive: true, force: true });
    await mkdir(linkPath, { recursive: true });
    await writeFile(join(linkPath, "USER.txt"), "keep me\n");
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha v2\n");

    await expect(
      runInstallCommand(
        {
          source: "skills-source",
          tool: "codex",
          target: { type: "global" },
          force: false,
        },
        { cwd, homeDir, output: quietOutput() },
      ),
    ).rejects.toThrow(/already exists/);

    expect((await lstat(linkPath)).isDirectory()).toBe(true);
    expect(await readFile(join(linkPath, "USER.txt"), "utf8")).toContain("keep me");
  });

  it("refreshes installs after migrating a legacy registry entry without sourceSkillDir", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-legacy-refresh-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "tool-target", "codex-global");
    const storeDir = join(base, "skill-store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha v1\n");

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

    const initial = await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const initialCacheKey = initial.storedSourceDir.split("/").pop();
    const linkPath = join(targetDir, "alpha-skill");
    const initialLinkTarget = await readlink(linkPath);

    if (!initialCacheKey) {
      throw new Error("expected initial cache key");
    }

    await writeFile(
      join(storeDir, "registry.json"),
      JSON.stringify(
        {
          version: 1,
          installs: [
            {
              skillName: "alpha-skill",
              tool: "codex",
              targetType: "global",
              targetRoot: targetDir,
              linkPath,
              sourceRaw: "skills-source",
              sourceKind: "local",
              cacheKey: initialCacheKey,
              storedSourceDir: initial.storedSourceDir,
              installedAt: "2026-04-10T00:00:00.000Z",
              updatedAt: "2026-04-10T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    );

    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha v2\n");

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const refreshedLinkTarget = await readlink(linkPath);
    expect(refreshedLinkTarget).not.toBe(initialLinkTarget);
    expect(await readFile(join(refreshedLinkTarget, "SKILL.md"), "utf8")).toContain("v2");
  });

  it("removes orphaned managed members when a bundle shrinks", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-shrink-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "tool-target", "codex-global");
    const storeDir = join(base, "skill-store");

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

    await rm(join(sourceRoot, "beta-skill"), { recursive: true, force: true });

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    await expect(lstat(join(targetDir, "beta-skill"))).rejects.toThrow();

    const registryRaw = await readFile(join(storeDir, "registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as {
      bundles: Array<{ members: Array<{ skillName: string }> }>;
    };
    expect(registry.bundles[0]?.members).toHaveLength(1);
    expect(registry.bundles[0]?.members[0]?.skillName).toBe("alpha-skill");
  });
});
