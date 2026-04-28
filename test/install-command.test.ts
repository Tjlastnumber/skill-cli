import { mkdtemp, mkdir, readFile, readlink, readdir, rm, writeFile, lstat } from "node:fs/promises";
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

    const result = await runInstallCommand(
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

    await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(result.storedSourceDir, ".skill-cli-source.json"), "utf8")).resolves.toContain(
      "skills-source",
    );
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

    await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
  });

  it("accumulates managed installs across repeated skill selections", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-selective-"));
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

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
        skills: ["alpha-skill"],
      },
      { cwd, homeDir, output: quietOutput() },
    );

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
        skills: ["beta-skill"],
      },
      { cwd, homeDir, output: quietOutput() },
    );

    expect((await lstat(join(targetDir, "alpha-skill"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(targetDir, "beta-skill"))).isSymbolicLink()).toBe(true);

    const alphaTarget = await readlink(join(targetDir, "alpha-skill"));
    const betaTarget = await readlink(join(targetDir, "beta-skill"));
    expect(alphaTarget.startsWith(join(storeDir, "store"))).toBe(true);
    expect(betaTarget.startsWith(join(storeDir, "store"))).toBe(true);
    await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
  });

  it("adds the remaining skills when later installing the full source", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-selective-expand-"));
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
        skills: ["alpha-skill"],
      },
      { cwd, homeDir, output: quietOutput() },
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

    expect((await lstat(join(targetDir, "alpha-skill"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(targetDir, "beta-skill"))).isSymbolicLink()).toBe(true);

    await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
  });

  it("retains surviving managed links when only part of a prior full install remains", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-partial-survivor-"));
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

    await rm(join(targetDir, "beta-skill"), { recursive: true, force: true });

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
        skills: ["beta-skill"],
      },
      { cwd, homeDir, output: quietOutput() },
    );

    expect((await lstat(join(targetDir, "alpha-skill"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(targetDir, "beta-skill"))).isSymbolicLink()).toBe(true);

    await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
  });

  it("does not restore previously full-installed project skills after the project links were deleted", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-project-reseed-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const storeDir = join(base, "skill-store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(sourceRoot, "beta-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(sourceRoot, "beta-skill", "SKILL.md"), "# beta\n");
    await writeFile(join(homeDir, ".config", "skill-cli", "config.json"), JSON.stringify({ storeDir }, null, 2));

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
        skills: ["*"],
      },
      { cwd, homeDir, output: quietOutput() },
    );

    await rm(join(cwd, ".opencode", "skills"), { recursive: true, force: true });
    await rm(join(cwd, "skills-lock.yaml"), { recursive: true, force: true });

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
        skills: ["alpha-skill"],
      },
      { cwd, homeDir, output: quietOutput() },
    );

    expect((await lstat(join(cwd, ".opencode", "skills", "alpha-skill"))).isSymbolicLink()).toBe(true);
    await expect(lstat(join(cwd, ".opencode", "skills", "beta-skill"))).rejects.toThrow();

    await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
  });

  it("fails when a requested skill name is not found", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-missing-selection-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir: join(base, "skill-store"),
          tools: {
            codex: {
              globalDir: join(base, "tool-target", "codex-global"),
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
          skills: ["beta-skill"],
        },
        { cwd, homeDir, output: quietOutput() },
      ),
    ).rejects.toThrow(/beta-skill/);
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

  it("leaves user content alone when a stale member is no longer live-managed", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-stale-user-content-"));
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

    const stalePath = join(targetDir, "beta-skill");
    await rm(stalePath, { recursive: true, force: true });
    await mkdir(stalePath, { recursive: true });
    await writeFile(join(stalePath, "USER.txt"), "keep me\n");

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
        skills: ["alpha-skill"],
      },
      { cwd, homeDir, output: quietOutput() },
    );

    expect((await lstat(stalePath)).isDirectory()).toBe(true);
    expect(await readFile(join(stalePath, "USER.txt"), "utf8")).toContain("keep me");
    expect((await lstat(join(targetDir, "alpha-skill"))).isSymbolicLink()).toBe(true);

    await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
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

    expect((await lstat(join(targetDir, "alpha-skill"))).isSymbolicLink()).toBe(true);
    await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
  });

  it("reuses one stored git source across different project installs of the same default HEAD", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-git-project-reuse-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const storeDir = join(base, "skill-store");
    const repoA = join(base, "workspace", "repo-a");
    const repoB = join(base, "workspace", "repo-b");
    const resolvedCommitSha = "abcdef0123456789abcdef0123456789abcdef01";

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(repoA, ".git"), { recursive: true });
    await mkdir(join(repoB, ".git"), { recursive: true });

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

    let cloneCount = 0;
    const runner = async (
      command: string,
      args: string[],
      options?: { cwd?: string },
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      if (command === "git" && args[0] === "ls-remote") {
        return {
          stdout: `ref: refs/heads/main\tHEAD\n${resolvedCommitSha}\tHEAD\n`,
          stderr: "",
          exitCode: 0,
        };
      }

      if (command === "git" && args[0] === "clone") {
        cloneCount += 1;
        const targetDir = args[args.length - 1];
        if (targetDir) {
          await mkdir(join(targetDir, ".git"), { recursive: true });
          await mkdir(join(targetDir, "alpha-skill"), { recursive: true });
          await writeFile(join(targetDir, "alpha-skill", "SKILL.md"), "# alpha\n");
          await writeFile(join(targetDir, ".git", "clone-id"), `${cloneCount}\n`);
        }

        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (command === "git" && args[0] === "rev-parse") {
        return {
          stdout: `${resolvedCommitSha}\n`,
          stderr: "",
          exitCode: 0,
        };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")} cwd=${options?.cwd ?? ""}`);
    };

    const first = await runInstallCommand(
      {
        source: "git@github.com:acme/skills.git",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      {
        cwd: repoA,
        homeDir,
        output: quietOutput(),
        runCommand: runner,
      },
    );

    const second = await runInstallCommand(
      {
        source: "git@github.com:acme/skills.git",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      {
        cwd: repoB,
        homeDir,
        output: quietOutput(),
        runCommand: runner,
      },
    );

    expect(first.storedSourceDir).toBe(second.storedSourceDir);
    expect(await readdir(join(storeDir, "store"))).toHaveLength(1);

    const firstLinkTarget = await readlink(join(repoA, ".opencode", "skills", "alpha-skill"));
    const secondLinkTarget = await readlink(join(repoB, ".opencode", "skills", "alpha-skill"));
    expect(firstLinkTarget).toBe(secondLinkTarget);
    expect(firstLinkTarget).toBe(first.storedSourceDir + "/alpha-skill");

    await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
    await expect(readFile(join(first.storedSourceDir, ".skill-cli-source.json"), "utf8")).resolves.toContain(
      "github.com/acme/skills",
    );
  });

  it("uses the bundle name for a root git SKILL.md member", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-git-root-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const storeDir = join(base, "skill-store");
    const resolvedCommitSha = "abcdef0123456789abcdef0123456789abcdef01";

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(cwd, ".git"), { recursive: true });
    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify({ storeDir }, null, 2),
    );

    const runner = async (
      command: string,
      args: string[],
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      if (command === "git" && args[0] === "ls-remote") {
        return {
          stdout: `ref: refs/heads/main\tHEAD\n${resolvedCommitSha}\tHEAD\n`,
          stderr: "",
          exitCode: 0,
        };
      }

      if (command === "git" && args[0] === "clone") {
        const targetDir = args[args.length - 1];
        if (targetDir) {
          await mkdir(join(targetDir, ".git"), { recursive: true });
          await writeFile(join(targetDir, "SKILL.md"), "# Root Skill\n");
        }

        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (command === "git" && args[0] === "rev-parse") {
        return {
          stdout: `${resolvedCommitSha}\n`,
          stderr: "",
          exitCode: 0,
        };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    };

    await runInstallCommand(
      {
        source: "git@github.com:acme/skills.git",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      {
        cwd,
        homeDir,
        output: quietOutput(),
        runCommand: runner,
      },
    );

    expect((await lstat(join(cwd, ".opencode", "skills", "skills"))).isSymbolicLink()).toBe(true);
  });
});
