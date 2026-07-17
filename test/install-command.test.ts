import { mkdtemp, mkdir, readFile, readlink, readdir, rm, symlink, writeFile, lstat } from "node:fs/promises";
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
    await expect(readFile(result.sourceManifestPath, "utf8")).resolves.toContain("skills-source");
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

  it("persists only the selected skill as a managed store entry", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-single-skill-store-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "target", "opencode-project");
    const storeDir = join(base, "store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(sourceRoot, "beta-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n\nAlpha description.\n");
    await writeFile(join(sourceRoot, "beta-skill", "SKILL.md"), "# beta\n\nBeta description.\n");
    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            opencode: {
              projectDir: targetDir,
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
        tool: "opencode",
        target: { type: "dir", dir: targetDir },
        force: false,
        skills: ["alpha-skill"],
      },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(await readdir(join(storeDir, "store"))).toHaveLength(1);
    expect(result.sourceManifestPath.startsWith(join(storeDir, "manifests"))).toBe(true);
    expect(result.sourceManifestPath.startsWith(join(storeDir, "manifests"))).toBe(true);
    await expect(readFile(result.sourceManifestPath, "utf8")).resolves.toContain(
      "alpha-skill",
    );
    await expect(readFile(result.sourceManifestPath, "utf8")).resolves.toContain(
      "beta-skill",
    );
  });

  it("repairs a corrupted pre-existing managed skill store entry on reinstall", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-repair-store-entry-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "tool-target", "codex-global");
    const storeDir = join(base, "skill-store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(sourceRoot, "alpha-skill", "HELPER.txt"), "helper\n");
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
    const storedSkillDir = await readlink(linkPath);
    await rm(join(storedSkillDir, "SKILL.md"), { force: true });
    await rm(linkPath, { force: true });

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const repairedStoredSkillDir = await readlink(linkPath);
    await expect(readFile(join(repairedStoredSkillDir, "SKILL.md"), "utf8")).resolves.toContain("# alpha");
    await expect(readFile(join(repairedStoredSkillDir, "HELPER.txt"), "utf8")).resolves.toContain("helper");
  });

  it("returns a stable sourceManifestPath for multi-skill installs", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-stable-source-result-"));
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

    const result = await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(result.sourceManifestPath.startsWith(join(storeDir, "manifests"))).toBe(true);
    await expect(readFile(result.sourceManifestPath, "utf8")).resolves.toContain(
      "alpha-skill",
    );
  });

  it("writes one shared source manifest per install request across tools", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-shared-manifest-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const storeDir = join(base, "skill-store");
    const opencodeTarget = join(base, "target", "opencode-global");
    const codexTarget = join(base, "target", "codex-global");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            opencode: {
              globalDir: opencodeTarget,
            },
            codex: {
              globalDir: codexTarget,
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
        tool: "all",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const manifestEntries = await readdir(join(storeDir, "manifests"));
    const opencodeStoredPath = await readlink(join(opencodeTarget, "alpha-skill"));
    const codexStoredPath = await readlink(join(codexTarget, "alpha-skill"));
    const opencodeMetadata = JSON.parse(
      await readFile(join(opencodeStoredPath, ".skill-cli-source.json"), "utf8"),
    ) as { sourceManifestPath: string };
    const codexMetadata = JSON.parse(
      await readFile(join(codexStoredPath, ".skill-cli-source.json"), "utf8"),
    ) as { sourceManifestPath: string };

    expect(manifestEntries).toHaveLength(1);
    expect(opencodeMetadata.sourceManifestPath).toBe(codexMetadata.sourceManifestPath);
    expect(opencodeMetadata.sourceManifestPath).toBe(join(storeDir, "manifests", manifestEntries[0]!));
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

  it("heals a broken previously managed symlink without force", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-heal-broken-managed-"));
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
    const firstStoredPath = await readlink(linkPath);
    await rm(firstStoredPath, { recursive: true, force: true });
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

    const healedStoredPath = await readlink(linkPath);
    expect(healedStoredPath).not.toBe(firstStoredPath);
    expect(await readFile(join(healedStoredPath, "SKILL.md"), "utf8")).toContain("v2");
  });

  it("retains and heals a broken same-bundle managed member during selective reinstall", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-heal-broken-same-bundle-selective-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "tool-target", "codex-global");
    const storeDir = join(base, "skill-store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(sourceRoot, "beta-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha v1\n");
    await writeFile(join(sourceRoot, "beta-skill", "SKILL.md"), "# beta v1\n");

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

    const betaLinkPath = join(targetDir, "beta-skill");
    const firstBetaStoredPath = await readlink(betaLinkPath);
    await rm(firstBetaStoredPath, { recursive: true, force: true });
    await writeFile(join(sourceRoot, "beta-skill", "SKILL.md"), "# beta v2\n");

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

    const healedBetaStoredPath = await readlink(betaLinkPath);
    expect(healedBetaStoredPath).not.toBe(firstBetaStoredPath);
    expect(await readFile(join(healedBetaStoredPath, "SKILL.md"), "utf8")).toContain("v2");
    expect((await lstat(join(targetDir, "alpha-skill"))).isSymbolicLink()).toBe(true);
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

    const initialCacheKey = initial.sourceManifestPath.split("/").pop()?.replace(/\.json$/, "");
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
              storedSourceDir: initial.sourceStateDir,
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

  it("removes broken orphaned managed members when a bundle shrinks", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-broken-shrink-"));
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

    const betaLinkPath = join(targetDir, "beta-skill");
    const betaStoredPath = await readlink(betaLinkPath);
    await rm(betaStoredPath, { recursive: true, force: true });
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

    await expect(lstat(betaLinkPath)).rejects.toThrow();
    expect((await lstat(join(targetDir, "alpha-skill"))).isSymbolicLink()).toBe(true);
  });

  it("does not remove broken stale links from another bundle when reinstalling a shrunk bundle", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-multi-bundle-broken-safety-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const bundleARoot = join(cwd, "bundle-a-source");
    const bundleBRoot = join(cwd, "bundle-b-source");
    const targetDir = join(base, "tool-target", "codex-global");
    const storeDir = join(base, "skill-store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(bundleARoot, "alpha-skill"), { recursive: true });
    await mkdir(join(bundleARoot, "beta-skill"), { recursive: true });
    await mkdir(join(bundleBRoot, "gamma-skill"), { recursive: true });
    await writeFile(join(bundleARoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(bundleARoot, "beta-skill", "SKILL.md"), "# beta\n");
    await writeFile(join(bundleBRoot, "gamma-skill", "SKILL.md"), "# gamma\n");

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
        source: "bundle-a-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    await runInstallCommand(
      {
        source: "bundle-b-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const gammaLinkPath = join(targetDir, "gamma-skill");
    const gammaStoredPath = await readlink(gammaLinkPath);
    await rm(gammaStoredPath, { recursive: true, force: true });
    await rm(join(bundleARoot, "beta-skill"), { recursive: true, force: true });

    await runInstallCommand(
      {
        source: "bundle-a-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const gammaLinkStat = await lstat(gammaLinkPath);
    expect(gammaLinkStat.isSymbolicLink()).toBe(true);
    await expect(lstat(join(targetDir, "beta-skill"))).rejects.toThrow();
    expect((await lstat(join(targetDir, "alpha-skill"))).isSymbolicLink()).toBe(true);
  });

  it("does not remove a broken stale link from a different bundle name on the same canonical source", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-broken-canonical-collision-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "tool-target", "codex-global");
    const storeDir = join(base, "skill-store");
    const fakeBrokenStorePath = join(
      storeDir,
      "store",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );

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

    await mkdir(join(storeDir, "manifests"), { recursive: true });
    await writeFile(
      join(storeDir, "manifests", "other-bundle.json"),
      `${JSON.stringify(
        {
          version: 1,
          sourceKind: "local",
          sourceRaw: "skills-source",
          sourceCanonical: sourceRoot,
          sourceRevision: "other-cache-key",
          sourceDisplayName: "other-bundle",
          sourceCacheKey: "other-cache-key",
          skills: [
            {
              skillName: "gamma-skill",
              description: "Other bundle skill.",
              relativeSkillDir: "gamma-skill",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await mkdir(targetDir, { recursive: true });
    await symlink(fakeBrokenStorePath, join(targetDir, "gamma-skill"), "dir");

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    expect((await lstat(join(targetDir, "gamma-skill"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(targetDir, "alpha-skill"))).isSymbolicLink()).toBe(true);
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

      if (command === "git" && args[0] === "clone" && args[1] === "--bare") {
        const barePath = args[args.length - 1];
        if (barePath) {
          await mkdir(barePath, { recursive: true });
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (command === "git" && (args[0] === "remote" || args[0] === "fetch")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (command === "git" && args[0] === "--git-dir") {
        if (args[2] === "rev-parse") {
          return { stdout: `${resolvedCommitSha}\n`, stderr: "", exitCode: 0 };
        }
        if (args[2] === "archive") {
          const outputIndex = args.indexOf("--output");
          const tarPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
          if (tarPath) {
            await writeFile(tarPath, "FAKE_TAR");
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      }

      if (command === "tar") {
        const cIndex = args.indexOf("-C");
        const dest = cIndex >= 0 ? args[cIndex + 1] : undefined;
        if (dest) {
          await mkdir(join(dest, "alpha-skill"), { recursive: true });
          await writeFile(join(dest, "alpha-skill", "SKILL.md"), "# alpha\n");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
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

    expect(first.sourceManifestPath).toBe(second.sourceManifestPath);
    expect(await readdir(join(storeDir, "store"))).toHaveLength(1);

    const firstLinkTarget = await readlink(join(repoA, ".opencode", "skills", "alpha-skill"));
    const secondLinkTarget = await readlink(join(repoB, ".opencode", "skills", "alpha-skill"));
    expect(firstLinkTarget).toBe(secondLinkTarget);
    expect(first.sourceManifestPath.startsWith(join(storeDir, "manifests"))).toBe(true);

    await expect(readFile(join(storeDir, "registry.json"), "utf8")).rejects.toThrow();
    await expect(readFile(first.sourceManifestPath, "utf8")).resolves.toContain("github.com/acme/skills");
  });

  it("does not rewrite shared git metadata when the same commit is installed through a different raw source form", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-install-git-raw-stability-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const storeDir = join(base, "skill-store");
    const repoA = join(base, "workspace", "repo-a");
    const repoB = join(base, "workspace", "repo-b");
    const resolvedCommitSha = "abcdef0123456789abcdef0123456789abcdef01";

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(repoA, ".git"), { recursive: true });
    await mkdir(join(repoB, ".git"), { recursive: true });
    await writeFile(join(homeDir, ".config", "skill-cli", "config.json"), JSON.stringify({ storeDir }, null, 2));

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

      if (command === "git" && args[0] === "clone" && args[1] === "--bare") {
        const barePath = args[args.length - 1];
        if (barePath) {
          await mkdir(barePath, { recursive: true });
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (command === "git" && (args[0] === "remote" || args[0] === "fetch")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (command === "git" && args[0] === "--git-dir") {
        if (args[2] === "rev-parse") {
          return { stdout: `${resolvedCommitSha}\n`, stderr: "", exitCode: 0 };
        }
        if (args[2] === "archive") {
          const outputIndex = args.indexOf("--output");
          const tarPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
          if (tarPath) {
            await writeFile(tarPath, "FAKE_TAR");
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      }

      if (command === "tar") {
        const cIndex = args.indexOf("-C");
        const dest = cIndex >= 0 ? args[cIndex + 1] : undefined;
        if (dest) {
          await mkdir(join(dest, "alpha-skill"), { recursive: true });
          await writeFile(join(dest, "alpha-skill", "SKILL.md"), "# alpha\n");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
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

    const firstLinkTarget = await readlink(join(repoA, ".opencode", "skills", "alpha-skill"));
    const firstSkillMetadata = await readFile(join(firstLinkTarget, ".skill-cli-source.json"), "utf8");
    const firstSourceMetadata = await readFile(first.sourceManifestPath, "utf8");

    const second = await runInstallCommand(
      {
        source: "acme/skills",
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

    const secondLinkTarget = await readlink(join(repoB, ".opencode", "skills", "alpha-skill"));
    const secondSkillMetadata = await readFile(join(secondLinkTarget, ".skill-cli-source.json"), "utf8");
    const secondSourceMetadata = await readFile(second.sourceManifestPath, "utf8");

    expect(firstLinkTarget).toBe(secondLinkTarget);
    expect(first.sourceManifestPath).not.toBe(second.sourceManifestPath);
    expect(firstSkillMetadata).toContain("git@github.com:acme/skills.git");
    expect(secondSkillMetadata).toContain("acme/skills");
    expect(firstSourceMetadata).toContain("git@github.com:acme/skills.git");
    expect(secondSourceMetadata).toContain("acme/skills");
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

      if (command === "git" && args[0] === "clone" && args[1] === "--bare") {
        const barePath = args[args.length - 1];
        if (barePath) {
          await mkdir(barePath, { recursive: true });
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (command === "git" && (args[0] === "remote" || args[0] === "fetch")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (command === "git" && args[0] === "--git-dir") {
        if (args[2] === "rev-parse") {
          return { stdout: `${resolvedCommitSha}\n`, stderr: "", exitCode: 0 };
        }
        if (args[2] === "archive") {
          const outputIndex = args.indexOf("--output");
          const tarPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
          if (tarPath) {
            await writeFile(tarPath, "FAKE_TAR");
          }
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      }

      if (command === "tar") {
        const cIndex = args.indexOf("-C");
        const dest = cIndex >= 0 ? args[cIndex + 1] : undefined;
        if (dest) {
          await mkdir(dest, { recursive: true });
          await writeFile(join(dest, "SKILL.md"), "# Root Skill\n");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
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
