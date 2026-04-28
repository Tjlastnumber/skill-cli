import { lstat, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runAutoSyncProjectLockfile } from "../src/commands/auto-sync-project-lockfile.js";
import { runInstallCommand } from "../src/commands/install.js";
import { runRemoveCommand } from "../src/commands/remove.js";
import { ExitCode } from "../src/core/errors.js";
import { loadSkillsLockfile } from "../src/core/lockfile/load.js";
import { syncProjectLockfile } from "../src/core/lockfile/sync-project-lockfile.js";

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
  projectDir?: string;
  globalDir?: string;
  tools?: Record<string, { projectDir: string; globalDir: string }>;
}) {
  const tools =
    options.tools ??
    (options.projectDir && options.globalDir
      ? {
          opencode: {
            projectDir: options.projectDir,
            globalDir: options.globalDir,
          },
        }
      : undefined);

  await mkdir(join(options.homeDir, ".config", "skill-cli"), { recursive: true });
  await writeFile(
    join(options.homeDir, ".config", "skill-cli", "config.json"),
    JSON.stringify(
      {
        storeDir: options.storeDir,
        tools: Object.fromEntries(
          Object.entries(tools ?? {}).map(([toolName, tool]) => [
            toolName,
            {
              globalDir: tool.globalDir,
              projectDir: tool.projectDir,
              entryPattern: "**/SKILL.md",
              nameStrategy: "parentDir",
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
}

async function expectAutoAndManualLockfilesToMatch(options: {
  cwd: string;
  homeDir: string;
  expectedLockfile: {
    version: 2;
    skills: Array<{ source: string; name: string }>;
  };
}) {
  const autoOutputPath = join(options.cwd, "skills-lock.yaml");
  const manualOutputPath = join(options.cwd, "skills-lock.manual.yaml");

  await expect(loadSkillsLockfile(autoOutputPath)).resolves.toEqual(options.expectedLockfile);

  await syncProjectLockfile(
    {
      tool: "all",
      mode: "manual",
      outputPath: manualOutputPath,
      force: true,
    },
    { cwd: options.cwd, homeDir: options.homeDir, output: captureOutput().output },
  );

  await expect(loadSkillsLockfile(manualOutputPath)).resolves.toEqual(options.expectedLockfile);
}

describe("syncProjectLockfile", () => {
  it("writes a manual lockfile to a custom output path", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-manual-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const outputPath = join(projectRoot, "custom-lock.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await syncProjectLockfile(
      {
        tool: "all",
        mode: "manual",
        outputPath,
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(loadSkillsLockfile(outputPath)).resolves.toEqual({
      version: 2,
      skills: [{ source: "./skills-source", name: "*" }],
    });
  });

  it("writes skills-lock.yaml from live managed project bundles without registry.json", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-live-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const storeDir = join(base, "store");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(projectRoot, "skills-source", "alpha-skill"), { recursive: true });
    await writeFile(join(projectRoot, "skills-source", "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir: join(base, "global") });

    await runInstallCommand(
      { source: "./skills-source", tool: "opencode", target: { type: "project" }, force: false },
      { cwd: projectRoot, homeDir, output: captureOutput().output },
    );

    await rm(join(storeDir, "registry.json"), { force: true });
    await expect(lstat(join(storeDir, "registry.json"))).rejects.toThrow();

    await syncProjectLockfile(
      { tool: "all", mode: "manual", force: true },
      { cwd: projectRoot, homeDir, output: captureOutput().output },
    );

    await expect(loadSkillsLockfile(join(projectRoot, "skills-lock.yaml"))).resolves.toEqual({
      version: 2,
      skills: [{ source: "./skills-source", name: "*" }],
    });
  });

  it("fails manual sync when a store-backed project bundle has unresolvable source provenance", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-missing-source-metadata-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });

    const installResult = await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await rm(join(installResult.storedSourceDir, ".skill-cli-source.json"), { force: true });

    await expect(
      syncProjectLockfile(
        { tool: "all", mode: "manual", force: true },
        { cwd: projectRoot, homeDir, output: captureOutput().output },
      ),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/provenance|unresolvable/i),
    });

    await expect(lstat(join(projectRoot, "skills-lock.yaml"))).rejects.toThrow();
  });

  it("preserves the existing default lockfile in auto mode when project bundle provenance is unresolvable", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-auto-missing-source-metadata-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const outputPath = join(projectRoot, "skills-lock.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });

    const installResult = await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await writeFile(outputPath, "version: 2\nskills:\n  - source: ./skills-source\n    name: '*'\n");
    await rm(join(installResult.storedSourceDir, ".skill-cli-source.json"), { force: true });

    await expect(
      syncProjectLockfile(
        {
          tool: "all",
          mode: "auto",
          force: false,
        },
        { cwd, homeDir, output: captureOutput().output },
      ),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/provenance|unresolvable/i),
    });

    await expect(loadSkillsLockfile(outputPath)).resolves.toEqual({
      version: 2,
      skills: [{ source: "./skills-source", name: "*" }],
    });
  });

  it("returns bundleCount matching the written lockfile entries for partial selections", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-bundle-count-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(sourceRoot, "beta-skill"), { recursive: true });
    await mkdir(join(sourceRoot, "gamma-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(sourceRoot, "beta-skill", "SKILL.md"), "# beta\n");
    await writeFile(join(sourceRoot, "gamma-skill", "SKILL.md"), "# gamma\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
        skills: ["alpha-skill", "beta-skill"],
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(
      syncProjectLockfile(
        {
          tool: "all",
          mode: "manual",
          force: true,
        },
        { cwd, homeDir, output: captureOutput().output },
      ),
    ).resolves.toMatchObject({
      outputPath: join(projectRoot, "skills-lock.yaml"),
      bundleCount: 2,
    });

    await expect(loadSkillsLockfile(join(projectRoot, "skills-lock.yaml"))).resolves.toEqual({
      version: 2,
      skills: [
        { source: "./skills-source", name: "alpha-skill" },
        { source: "./skills-source", name: "beta-skill" },
      ],
    });
  });

  it("overwrites a manual lockfile when force is enabled", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-force-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const outputPath = join(projectRoot, "custom-lock.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });
    await writeFile(outputPath, "stale\n", "utf8");

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await syncProjectLockfile(
      {
        tool: "all",
        mode: "manual",
        outputPath,
        force: true,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(loadSkillsLockfile(outputPath)).resolves.toEqual({
      version: 2,
      skills: [{ source: "./skills-source", name: "*" }],
    });
  });

  it("replaces a live manual output symlink when force is enabled", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-force-live-symlink-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const outputPath = join(projectRoot, "custom-lock.yaml");
    const targetPath = join(projectRoot, "shared-lockfile.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });
    await writeFile(targetPath, "sentinel\n", "utf8");
    await symlink(targetPath, outputPath);

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await syncProjectLockfile(
      {
        tool: "all",
        mode: "manual",
        outputPath,
        force: true,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(loadSkillsLockfile(outputPath)).resolves.toEqual({
      version: 2,
      skills: [{ source: "./skills-source", name: "*" }],
    });
    await expect(loadSkillsLockfile(targetPath)).rejects.toThrow();
    expect((await lstat(outputPath)).isSymbolicLink()).toBe(false);
    await expect(writeFile(targetPath, "sentinel\n", "utf8")).resolves.toBeUndefined();
  });

  it("rejects manual overwrite without force when the lockfile contents are otherwise valid", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-manual-existing-valid-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const outputPath = join(projectRoot, "custom-lock.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });
    await writeFile(outputPath, "version: 2\nskills:\n  - source: ./skills-source\n    name: '*'\n", "utf8");

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(
      syncProjectLockfile(
        {
          tool: "all",
          mode: "manual",
          outputPath,
          force: false,
        },
        { cwd, homeDir, output: captureOutput().output },
      ),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/Lockfile already exists/),
      suggestion: expect.stringMatching(/--force/),
    });
  });

  it("reports an invalid tool before checking an existing manual output path", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-manual-invalid-tool-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const outputPath = join(projectRoot, "custom-lock.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });
    await writeFile(outputPath, "version: 2\n", "utf8");

    await expect(
      syncProjectLockfile(
        {
          tool: "missing-tool",
          mode: "manual",
          outputPath,
          force: false,
        },
        { cwd, homeDir, output: captureOutput().output },
      ),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/Unknown tool: missing-tool/),
    });
  });

  it("reports missing eligible bundles before checking an existing manual output path", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-manual-empty-existing-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const outputPath = join(projectRoot, "custom-lock.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });
    await writeFile(outputPath, "version: 2\n", "utf8");

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(
      syncProjectLockfile(
        {
          tool: "all",
          mode: "manual",
          outputPath,
          force: false,
        },
        { cwd, homeDir, output: captureOutput().output },
      ),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/No eligible managed project bundles/),
    });
  });

  it("errors in manual mode when no eligible managed project bundles exist", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-manual-empty-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(
      syncProjectLockfile(
        {
          tool: "all",
          mode: "manual",
          force: false,
        },
        { cwd, homeDir, output: captureOutput().output },
      ),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/No eligible managed project bundles/),
    });
  });

  it("deletes the default lockfile in auto mode when no eligible managed project bundles remain", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-auto-delete-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const outputPath = join(projectRoot, "skills-lock.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });
    await writeFile(outputPath, "version: 2\nskills:\n  - source: ./stale\n    name: '*'\n", "utf8");

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(
      syncProjectLockfile(
        {
          tool: "all",
          mode: "auto",
          force: false,
        },
        { cwd, homeDir, output: captureOutput().output },
      ),
    ).resolves.toMatchObject({
      outputPath,
      bundleCount: 0,
    });

    await expect(lstat(outputPath)).rejects.toThrow();
  });

  it("ignores a caller-provided output path in auto mode and writes the default project lockfile", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-auto-default-path-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const defaultOutputPath = join(projectRoot, "skills-lock.yaml");
    const customOutputPath = join(projectRoot, "custom-lock.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(
      syncProjectLockfile(
        {
          tool: "all",
          mode: "auto",
          outputPath: customOutputPath,
          force: false,
        },
        { cwd, homeDir, output: captureOutput().output },
      ),
    ).resolves.toMatchObject({
      outputPath: defaultOutputPath,
      bundleCount: 1,
    });

    await expect(loadSkillsLockfile(defaultOutputPath)).resolves.toEqual({
      version: 2,
      skills: [{ source: "./skills-source", name: "*" }],
    });
    await expect(lstat(customOutputPath)).rejects.toThrow();
  });

  it("install-side multi-tool auto-sync preserves bundle sources from other configured project tools", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-auto-install-multitool-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const opencodeSourceRoot = join(projectRoot, "opencode-source");
    const codexSourceRoot = join(projectRoot, "codex-source");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(opencodeSourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(codexSourceRoot, "beta-skill"), { recursive: true });
    await writeFile(join(opencodeSourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(codexSourceRoot, "beta-skill", "SKILL.md"), "# beta\n");
    await writeConfig({
      homeDir,
      storeDir,
      tools: {
        opencode: { projectDir: ".opencode/skills", globalDir },
        codex: { projectDir: ".codex/skills", globalDir },
      },
    });

    await runInstallCommand(
      {
        source: "./opencode-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );
    await runInstallCommand(
      {
        source: "./codex-source",
        tool: "codex",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await runAutoSyncProjectLockfile({
      action: "install",
      tool: "all",
      cwd,
      homeDir,
      output: captureOutput().output,
    });

    await expectAutoAndManualLockfilesToMatch({
      cwd,
      homeDir,
      expectedLockfile: {
        version: 2,
        skills: [
          { source: "./codex-source", name: "*" },
          { source: "./opencode-source", name: "*" },
        ],
      },
    });
  });

  it("remove-side auto-sync does not delete the lockfile while another tool still has eligible managed project bundles", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-auto-remove-multitool-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const outputPath = join(projectRoot, "skills-lock.yaml");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const opencodeSourceRoot = join(projectRoot, "opencode-source");
    const codexSourceRoot = join(projectRoot, "codex-source");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(opencodeSourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(codexSourceRoot, "beta-skill"), { recursive: true });
    await writeFile(join(opencodeSourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(codexSourceRoot, "beta-skill", "SKILL.md"), "# beta\n");
    await writeConfig({
      homeDir,
      storeDir,
      tools: {
        opencode: { projectDir: ".opencode/skills", globalDir },
        codex: { projectDir: ".codex/skills", globalDir },
      },
    });

    await runInstallCommand(
      {
        source: "./opencode-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );
    await runInstallCommand(
      {
        source: "./codex-source",
        tool: "codex",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );
    await runAutoSyncProjectLockfile({
      action: "install",
      tool: "all",
      cwd,
      homeDir,
      output: captureOutput().output,
    });

    await runRemoveCommand(
      {
        bundleName: "codex-source",
        tool: "codex",
        target: { type: "project" },
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await runAutoSyncProjectLockfile({
      action: "remove",
      tool: "all",
      cwd,
      homeDir,
      output: captureOutput().output,
    });

    await expect(loadSkillsLockfile(outputPath)).resolves.toEqual({
      version: 2,
      skills: [{ source: "./opencode-source", name: "*" }],
    });
    await expectAutoAndManualLockfilesToMatch({
      cwd,
      homeDir,
      expectedLockfile: {
        version: 2,
        skills: [{ source: "./opencode-source", name: "*" }],
      },
    });
  });

  it("does nothing in auto mode when no eligible managed project bundles exist and no default lockfile is present", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-lockfile-auto-noop-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const outputPath = join(projectRoot, "skills-lock.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(
      syncProjectLockfile(
        {
          tool: "all",
          mode: "auto",
          force: false,
        },
        { cwd, homeDir, output: captureOutput().output },
      ),
    ).resolves.toMatchObject({
      outputPath,
      bundleCount: 0,
    });
  });
});
