import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runRegisterCommand } from "../src/commands/register.js";

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

describe("runRegisterCommand", () => {
  const fakeCacheKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("registers already-installed symlink skills into registry", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-register-"));
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

    const result = await runRegisterCommand(
      { tool: "opencode" },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(result.addedBundles).toBe(1);
    expect(result.scannedMembers).toBe(1);

    const registryRaw = await readFile(join(storeDir, "registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as {
      bundles: Array<{ tool: string; bundleName: string; sourceKind: string }>;
    };

    expect(registry.bundles).toHaveLength(1);
    expect(registry.bundles[0]).toMatchObject({
      tool: "opencode",
      bundleName: "using-superpowers",
      sourceKind: "unknown",
    });
  });

  it("registers custom dir installs and ignores non-symlink junk entries", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-register-dir-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const targetRoot = join(base, "custom-skills");
    const storeDir = join(base, "store");
    const sourceSkillDir = join(storeDir, "store", fakeCacheKey, "skills", "using-superpowers");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(sourceSkillDir, { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    await mkdir(join(targetRoot, "notes"), { recursive: true });

    await writeFile(join(sourceSkillDir, "SKILL.md"), "# using-superpowers\n");
    await writeFile(join(targetRoot, "notes", "README.md"), "not a skill\n");
    await writeFile(join(targetRoot, "README.md"), "still not a skill\n");
    await symlink(sourceSkillDir, join(targetRoot, "using-superpowers"), "dir");

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

    const result = await runRegisterCommand(
      { tool: "opencode", dir: targetRoot },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(result.addedBundles).toBe(1);
    expect(result.scannedMembers).toBe(1);

    const registryRaw = await readFile(join(storeDir, "registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as {
      bundles: Array<{ tool: string; bundleName: string; targetType: string }>;
    };

    expect(registry.bundles).toHaveLength(1);
    expect(registry.bundles[0]).toMatchObject({
      tool: "opencode",
      bundleName: "using-superpowers",
      targetType: "dir",
    });
  });

  it("scans custom dir targets even when the target root is a symlink", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-register-dir-symlink-root-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const realTargetRoot = join(base, "real-custom-skills");
    const linkedTargetRoot = join(base, "linked-custom-skills");
    const storeDir = join(base, "store");
    const sourceSkillDir = join(storeDir, "store", fakeCacheKey, "skills", "using-superpowers");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(sourceSkillDir, { recursive: true });
    await mkdir(realTargetRoot, { recursive: true });

    await writeFile(join(sourceSkillDir, "SKILL.md"), "# using-superpowers\n");
    await symlink(realTargetRoot, linkedTargetRoot, "dir");
    await symlink(sourceSkillDir, join(realTargetRoot, "using-superpowers"), "dir");

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

    const result = await runRegisterCommand(
      { tool: "opencode", dir: linkedTargetRoot },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(result.scannedMembers).toBe(1);
    expect(result.addedBundles).toBe(1);
  });

  it("groups multiple unmanaged external skills from the same bundle root together", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-register-external-bundle-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetRoot = join(base, "custom-skills");
    const storeDir = join(base, "store");
    const externalBundleRoot = join(base, "external-bundle");
    const alphaDir = join(externalBundleRoot, "alpha-skill");
    const betaDir = join(externalBundleRoot, "beta-skill");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    await mkdir(alphaDir, { recursive: true });
    await mkdir(betaDir, { recursive: true });
    await writeFile(join(alphaDir, "SKILL.md"), "# alpha\n");
    await writeFile(join(betaDir, "SKILL.md"), "# beta\n");
    await symlink(alphaDir, join(targetRoot, "alpha-skill"), "dir");
    await symlink(betaDir, join(targetRoot, "beta-skill"), "dir");

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

    const result = await runRegisterCommand(
      { tool: "opencode", dir: targetRoot },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(result.scannedMembers).toBe(2);
    expect(result.touchedBundles).toBe(1);

    const registryRaw = await readFile(join(storeDir, "registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as {
      bundles: Array<{ bundleName: string; members: Array<{ skillName: string }> }>;
    };

    expect(registry.bundles).toHaveLength(1);
    expect(registry.bundles[0]?.bundleName).toBe("external-bundle");
    expect(registry.bundles[0]?.members).toHaveLength(2);
  });

  it("deduplicates scans when --dir points at the configured global directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-register-dedup-scan-root-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetRoot = join(base, "shared-target");
    const storeDir = join(base, "store");
    const sourceSkillDir = join(storeDir, "store", fakeCacheKey, "skills", "using-superpowers");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(join(sourceSkillDir, "SKILL.md"), "# using-superpowers\n");
    await symlink(sourceSkillDir, join(targetRoot, "using-superpowers"), "dir");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            opencode: {
              globalDir: targetRoot,
            },
          },
        },
        null,
        2,
      ),
    );

    const result = await runRegisterCommand(
      { tool: "opencode", dir: targetRoot },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(result.scannedMembers).toBe(1);
    expect(result.touchedBundles).toBe(1);
    expect(result.addedBundles).toBe(1);
  });
});
