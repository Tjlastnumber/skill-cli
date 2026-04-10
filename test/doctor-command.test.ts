import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runDoctorCommand } from "../src/commands/doctor.js";
import { runInstallCommand } from "../src/commands/install.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function captureOutput() {
  const logs: string[] = [];
  return {
    output: {
      info: (message: string) => logs.push(`INFO:${message}`),
      warn: (message: string) => logs.push(`WARN:${message}`),
      error: (message: string) => logs.push(`ERROR:${message}`),
    },
    logs,
  };
}

describe("runDoctorCommand", () => {
  const fakeCacheKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("reports discovered skills and suggests register", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-discovered-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const projectRoot = join(base, "workspace", "repo");
    const targetRoot = join(projectRoot, ".opencode", "skills");
    const storeDir = join(base, "store");
    const sourceSkillDir = join(storeDir, "store", fakeCacheKey, "skills", "using-superpowers");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(sourceSkillDir, { recursive: true });
    await mkdir(targetRoot, { recursive: true });

    await writeFile(join(sourceSkillDir, "SKILL.md"), "# using-superpowers\n");
    await symlink(sourceSkillDir, join(targetRoot, "using-superpowers"), "dir");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            opencode: {
              projectDir: ".opencode/skills",
            },
          },
        },
        null,
        2,
      ),
    );

    const capture = captureOutput();
    const result = await runDoctorCommand(
      { tool: "opencode", repairRegistry: false },
      { cwd, homeDir, output: capture.output },
    );

    expect(result.discoveredCount).toBe(1);
    expect(capture.logs.some((line) => line.includes("discovered=1"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("skill register --tool opencode"))).toBe(true);
  });

  it("repairs registry when repair flag is enabled", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-repair-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const projectRoot = join(base, "workspace", "repo");
    const targetRoot = join(projectRoot, ".opencode", "skills");
    const storeDir = join(base, "store");
    const sourceSkillDir = join(storeDir, "store", fakeCacheKey, "skills", "using-superpowers");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(sourceSkillDir, { recursive: true });
    await mkdir(targetRoot, { recursive: true });

    await writeFile(join(sourceSkillDir, "SKILL.md"), "# using-superpowers\n");
    await symlink(sourceSkillDir, join(targetRoot, "using-superpowers"), "dir");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            opencode: {
              projectDir: ".opencode/skills",
            },
          },
        },
        null,
        2,
      ),
    );

    const capture = captureOutput();
    const result = await runDoctorCommand(
      { tool: "opencode", repairRegistry: true },
      { cwd, homeDir, output: capture.output },
    );

    expect(result.repairedCount).toBe(1);

    const registryRaw = await readFile(join(storeDir, "registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as { bundles: Array<{ bundleName: string }> };
    expect(registry.bundles).toHaveLength(1);
    expect(registry.bundles[0]?.bundleName).toBe("using-superpowers");
  });

  it("does not report managed custom dir installs as stale", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-dir-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetRoot = join(base, "custom-skills");
    const storeDir = join(base, "store");

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

    await mkdir(join(cwd, "skills-source", "alpha-skill"), { recursive: true });
    await writeFile(join(cwd, "skills-source", "alpha-skill", "SKILL.md"), "# alpha\n");

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "dir", dir: targetRoot },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    const capture = captureOutput();
    const result = await runDoctorCommand(
      { tool: "codex", repairRegistry: false },
      { cwd, homeDir, output: capture.output },
    );

    expect(result.staleCount).toBe(0);
    expect(capture.logs.some((line) => line.includes("stale=0"))).toBe(true);
  });

  it("reports broken symlinks instead of treating them as healthy installs", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-broken-link-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetRoot = join(base, "target", "codex-global");
    const storeDir = join(base, "store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            codex: {
              globalDir: targetRoot,
            },
          },
        },
        null,
        2,
      ),
    );

    await mkdir(join(cwd, "skills-source", "alpha-skill"), { recursive: true });
    await writeFile(join(cwd, "skills-source", "alpha-skill", "SKILL.md"), "# alpha\n");

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    const registryRaw = await readFile(join(storeDir, "registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as {
      bundles: Array<{ cacheKey: string; members: Array<{ linkPath: string }> }>;
    };
    const cacheKey = registry.bundles[0]?.cacheKey;
    const linkPath = registry.bundles[0]?.members[0]?.linkPath;

    if (!cacheKey || !linkPath) {
      throw new Error("expected installed registry entry");
    }

    await rm(linkPath, { recursive: true, force: true });
    await symlink(join(storeDir, "store", cacheKey, "missing-skill"), linkPath, "dir");
    expect(await readlink(linkPath)).toContain(cacheKey);

    const capture = captureOutput();
    const result = await runDoctorCommand(
      { tool: "codex", repairRegistry: false },
      { cwd, homeDir, output: capture.output },
    );

    expect(result.staleCount).toBe(1);
    expect(capture.logs.some((line) => line.toLowerCase().includes("broken"))).toBe(true);
  });

  it("reports broken custom-dir symlinks even when they are not yet in registry", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-broken-custom-dir-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetRoot = join(base, "custom-skills");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    await symlink(join(base, "missing-skill"), join(targetRoot, "using-superpowers"), "dir");

    const capture = captureOutput();
    const result = await runDoctorCommand(
      { tool: "opencode", dir: targetRoot, repairRegistry: false },
      { cwd, homeDir, output: capture.output },
    );

    expect(result.brokenCount).toBe(1);
    expect(capture.logs.some((line) => line.toLowerCase().includes("broken"))).toBe(true);
  });

  it("includes --dir in the repair suggestion for custom directory scans", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-dir-suggestion-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetRoot = join(base, "custom-skills");
    const storeDir = join(base, "store");
    const sourceSkillDir = join(storeDir, "store", fakeCacheKey, "skills", "using-superpowers");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(join(sourceSkillDir, "SKILL.md"), "# using-superpowers\n");
    await symlink(sourceSkillDir, join(targetRoot, "using-superpowers"), "dir");

    const capture = captureOutput();
    await runDoctorCommand(
      { tool: "opencode", dir: targetRoot, repairRegistry: false },
      { cwd, homeDir, output: capture.output },
    );

    expect(
      capture.logs.some(
        (line) =>
          line.includes("skill register --tool opencode") && line.includes(`--dir ${targetRoot}`),
      ),
    ).toBe(true);
  });

  it("reports a bundle as stale when one managed member is missing", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-missing-member-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetRoot = join(base, "target", "codex-global");
    const storeDir = join(base, "store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            codex: {
              globalDir: targetRoot,
            },
          },
        },
        null,
        2,
      ),
    );

    await mkdir(join(cwd, "skills-source", "alpha-skill"), { recursive: true });
    await mkdir(join(cwd, "skills-source", "beta-skill"), { recursive: true });
    await writeFile(join(cwd, "skills-source", "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(cwd, "skills-source", "beta-skill", "SKILL.md"), "# beta\n");

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await rm(join(targetRoot, "beta-skill"), { recursive: true, force: true });

    const capture = captureOutput();
    const result = await runDoctorCommand(
      { tool: "codex", repairRegistry: false },
      { cwd, homeDir, output: capture.output },
    );

    expect(result.staleCount).toBe(1);
    expect(capture.logs.some((line) => line.includes("stale=1"))).toBe(true);
  });

  it("removes fully stale registry bundles when repair mode is enabled", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-repair-stale-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetRoot = join(base, "target", "codex-global");
    const storeDir = join(base, "store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            codex: {
              globalDir: targetRoot,
            },
          },
        },
        null,
        2,
      ),
    );

    await mkdir(join(cwd, "skills-source", "alpha-skill"), { recursive: true });
    await writeFile(join(cwd, "skills-source", "alpha-skill", "SKILL.md"), "# alpha\n");

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await rm(join(targetRoot, "alpha-skill"), { recursive: true, force: true });

    const capture = captureOutput();
    const result = await runDoctorCommand(
      { tool: "codex", repairRegistry: true },
      { cwd, homeDir, output: capture.output },
    );

    expect(result.repairedCount).toBe(1);

    const registryRaw = await readFile(join(storeDir, "registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as { bundles: Array<unknown> };
    expect(registry.bundles).toHaveLength(0);
  });
});
