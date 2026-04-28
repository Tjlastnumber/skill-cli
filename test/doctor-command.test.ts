import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
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

async function writeConfig(options: {
  homeDir: string;
  storeDir: string;
  globalDir?: string;
  projectDir?: string;
  opencode?: {
    globalDir?: string;
    projectDir?: string;
  };
  codex?: {
    globalDir?: string;
    projectDir?: string;
  };
}) {
  await mkdir(join(options.homeDir, ".config", "skill-cli"), { recursive: true });
  await writeFile(
    join(options.homeDir, ".config", "skill-cli", "config.json"),
    JSON.stringify(
      {
        storeDir: options.storeDir,
        tools: {
          opencode: {
            ...(options.globalDir ? { globalDir: options.globalDir } : {}),
            ...(options.projectDir ? { projectDir: options.projectDir } : {}),
            ...(options.opencode ?? {}),
          },
          codex: {
            ...(options.globalDir ? { globalDir: options.globalDir } : {}),
            ...(options.projectDir ? { projectDir: options.projectDir } : {}),
            ...(options.codex ?? {}),
          },
        },
      },
      null,
      2,
    ),
  );
}

async function writeProjectSource(projectRoot: string, skillNames: string[]) {
  for (const skillName of skillNames) {
    await mkdir(join(projectRoot, "skills-source", skillName), { recursive: true });
    await writeFile(join(projectRoot, "skills-source", skillName, "SKILL.md"), `# ${skillName}\n`);
  }
}

describe("runDoctorCommand", () => {
  it("reports discovered skills without suggesting register", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-discovered-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const targetRoot = join(cwd, ".opencode", "skills");
    const storeDir = join(base, "store");
    const sourceSkillDir = join(base, "unmanaged-source", "using-superpowers");

    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(sourceSkillDir, { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    await writeFile(join(sourceSkillDir, "SKILL.md"), "# using-superpowers\n");
    await symlink(sourceSkillDir, join(targetRoot, "using-superpowers"), "dir");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills" });

    const capture = captureOutput();
    const result = await runDoctorCommand({ tool: "opencode" }, { cwd, homeDir, output: capture.output });

    expect(result.managedCount).toBe(0);
    expect(result.discoveredCount).toBe(1);
    expect(capture.logs.some((line) => line.includes("discovered=1"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("register"))).toBe(false);
  });

  it("warns when skills-lock.yaml declares project skills that are not currently installed", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-project-drift-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const storeDir = join(base, "store");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(projectRoot, "skills-source", "alpha-skill"), { recursive: true });
    await writeFile(join(projectRoot, "skills-source", "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({
      homeDir,
      storeDir,
      projectDir: ".opencode/skills",
      globalDir: join(base, "global"),
    });
    await writeFile(
      join(projectRoot, "skills-lock.yaml"),
      "version: 2\nskills:\n  - source: ./skills-source\n    name: alpha-skill\n  - source: ./skills-source\n    name: beta-skill\n",
    );

    await runInstallCommand(
      { source: "./skills-source", tool: "opencode", target: { type: "project" }, force: false },
      { cwd: projectRoot, homeDir, output: captureOutput().output },
    );

    const capture = captureOutput();
    const result = await runDoctorCommand({ tool: "opencode" }, { cwd: projectRoot, homeDir, output: capture.output });

    expect(result.projectDriftCount).toBeGreaterThan(0);
    expect(capture.logs.some((line) => line.includes("project drift"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("skill install --project"))).toBe(true);
  });

  it("warns when project installs contain skills missing from skills-lock.yaml", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-installed-only-drift-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const storeDir = join(base, "store");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await writeProjectSource(projectRoot, ["alpha-skill", "beta-skill"]);
    await writeConfig({
      homeDir,
      storeDir,
      projectDir: ".opencode/skills",
      globalDir: join(base, "global"),
    });
    await writeFile(
      join(projectRoot, "skills-lock.yaml"),
      "version: 2\nskills:\n  - source: ./skills-source\n    name: alpha-skill\n",
    );

    await runInstallCommand(
      { source: "./skills-source", tool: "opencode", target: { type: "project" }, force: false },
      { cwd: projectRoot, homeDir, output: captureOutput().output },
    );

    const capture = captureOutput();
    const result = await runDoctorCommand({ tool: "opencode" }, { cwd: projectRoot, homeDir, output: capture.output });

    expect(result.projectDriftCount).toBeGreaterThan(0);
    expect(capture.logs.some((line) => line.includes("skill lock"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("skill install --project"))).toBe(false);
  });

  it("suggests both install and lock when project drift is mixed", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-mixed-drift-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const storeDir = join(base, "store");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await writeProjectSource(projectRoot, ["alpha-skill", "beta-skill"]);
    await writeConfig({
      homeDir,
      storeDir,
      projectDir: ".opencode/skills",
      globalDir: join(base, "global"),
    });
    await writeFile(
      join(projectRoot, "skills-lock.yaml"),
      "version: 2\nskills:\n  - source: ./skills-source\n    name: alpha-skill\n  - source: ./skills-source\n    name: gamma-skill\n",
    );

    await runInstallCommand(
      { source: "./skills-source", tool: "opencode", target: { type: "project" }, force: false },
      { cwd: projectRoot, homeDir, output: captureOutput().output },
    );

    const capture = captureOutput();
    const result = await runDoctorCommand({ tool: "opencode" }, { cwd: projectRoot, homeDir, output: capture.output });

    expect(result.projectDriftCount).toBe(2);
    expect(capture.logs.some((line) => line.includes("skill install --project") && line.includes("skill lock"))).toBe(true);
  });

  it("reports cross-tool conflicting project selections instead of aborting", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-cross-tool-drift-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const storeDir = join(base, "store");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await writeProjectSource(projectRoot, ["alpha-skill", "beta-skill"]);
    await writeConfig({
      homeDir,
      storeDir,
      opencode: { projectDir: ".opencode/skills" },
      codex: { projectDir: ".codex/skills" },
      globalDir: join(base, "global"),
    });
    await writeFile(
      join(projectRoot, "skills-lock.yaml"),
      "version: 2\nskills:\n  - source: ./skills-source\n    name: alpha-skill\n  - source: ./skills-source\n    name: beta-skill\n",
    );

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
        skills: ["alpha-skill"],
      },
      { cwd: projectRoot, homeDir, output: captureOutput().output },
    );
    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "codex",
        target: { type: "project" },
        force: false,
        skills: ["beta-skill"],
      },
      { cwd: projectRoot, homeDir, output: captureOutput().output },
    );

    const capture = captureOutput();
    const result = await runDoctorCommand({ tool: "all" }, { cwd: projectRoot, homeDir, output: capture.output });

    expect(result.projectDriftCount).toBeGreaterThan(0);
    expect(capture.logs.some((line) => line.includes("project drift"))).toBe(true);
  });

  it("reports missing source provenance for store-backed project bundles instead of throwing", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-missing-project-provenance-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const storeDir = join(base, "store");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await writeProjectSource(projectRoot, ["alpha-skill"]);
    await writeConfig({
      homeDir,
      storeDir,
      projectDir: ".opencode/skills",
      globalDir: join(base, "global"),
    });
    await writeFile(
      join(projectRoot, "skills-lock.yaml"),
      "version: 2\nskills:\n  - source: ./skills-source\n    name: alpha-skill\n",
    );

    const installResult = await runInstallCommand(
      { source: "./skills-source", tool: "opencode", target: { type: "project" }, force: false },
      { cwd: projectRoot, homeDir, output: captureOutput().output },
    );

    await rm(join(installResult.storedSourceDir, ".skill-cli-source.json"), { force: true });

    const capture = captureOutput();
    const result = await runDoctorCommand({ tool: "opencode" }, { cwd: projectRoot, homeDir, output: capture.output });

    expect(result.projectDriftCount).toBeGreaterThan(0);
    expect(capture.logs.some((line) => line.toLowerCase().includes("provenance"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("skill install --project"))).toBe(true);
  });

  it("does not report managed custom dir installs as discovered", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-dir-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetRoot = join(base, "custom-skills");
    const storeDir = join(base, "store");

    await writeConfig({ homeDir, storeDir });
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
    const result = await runDoctorCommand({ tool: "codex", dir: targetRoot }, { cwd, homeDir, output: capture.output });

    expect(result.managedCount).toBe(1);
    expect(result.discoveredCount).toBe(0);
    expect(capture.logs.some((line) => line.includes("managed=1"))).toBe(true);
  });

  it("reports broken symlinks instead of treating them as healthy installs", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-broken-link-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetRoot = join(base, "target", "codex-global");
    const storeDir = join(base, "store");

    await writeConfig({ homeDir, storeDir, globalDir: targetRoot });
    await mkdir(join(cwd, "skills-source", "alpha-skill"), { recursive: true });
    await writeFile(join(cwd, "skills-source", "alpha-skill", "SKILL.md"), "# alpha\n");

    const installResult = await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await rm(join(targetRoot, "alpha-skill"), { recursive: true, force: true });
    await symlink(join(installResult.storedSourceDir, "missing-skill"), join(targetRoot, "alpha-skill"), "dir");

    const capture = captureOutput();
    const result = await runDoctorCommand({ tool: "codex" }, { cwd, homeDir, output: capture.output });

    expect(result.brokenCount).toBe(1);
    expect(capture.logs.some((line) => line.toLowerCase().includes("broken"))).toBe(true);
  });

  it("reports broken custom-dir symlinks even when they are not store-managed", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-doctor-broken-custom-dir-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetRoot = join(base, "custom-skills");
    const storeDir = join(base, "store");

    await writeConfig({ homeDir, storeDir });
    await mkdir(targetRoot, { recursive: true });
    await symlink(join(base, "missing-skill"), join(targetRoot, "using-superpowers"), "dir");

    const capture = captureOutput();
    const result = await runDoctorCommand({ tool: "opencode", dir: targetRoot }, { cwd, homeDir, output: capture.output });

    expect(result.brokenCount).toBe(1);
    expect(capture.logs.some((line) => line.toLowerCase().includes("broken"))).toBe(true);
  });
});
