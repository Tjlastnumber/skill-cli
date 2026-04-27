import { describe, expect, it, vi } from "vitest";

import * as installCommandModule from "../src/commands/install.js";
import { runInstallFromLockfileCommand } from "../src/commands/install-from-lockfile.js";
import { ExitCode, FilesystemError, SkillCliError } from "../src/core/errors.js";
import * as loadLockfileModule from "../src/core/lockfile/load.js";
import * as lockfilePathModule from "../src/core/lockfile/path.js";

describe("runInstallFromLockfileCommand", () => {
  it("groups skill entries by source before installing from skills-lock.yaml", async () => {
    const resolveProjectSkillsLockfilePathSpy = vi
      .spyOn(lockfilePathModule, "resolveProjectSkillsLockfilePath")
      .mockResolvedValue("/workspace/skills-lock.yaml");
    const loadSkillsLockfileSpy = vi.spyOn(loadLockfileModule, "loadSkillsLockfile").mockResolvedValue({
      version: 2,
      skills: [
        { source: "npm:@acme/alpha", name: "*" },
        { source: "./skills/beta", name: "browser" },
        { source: "./skills/beta", name: "debugger" },
      ],
    });
    const runInstallCommandSpy = vi.spyOn(installCommandModule, "runInstallCommand").mockResolvedValue({
      storedSourceDir: "/store/bundle",
      installedByTool: { codex: ["alpha"] },
    });

    await expect(
      runInstallFromLockfileCommand({ tool: "codex", target: { type: "project" }, force: true }, { cwd: "/workspace" }),
    ).resolves.toEqual({
      installedSources: ["npm:@acme/alpha", "./skills/beta"],
      lockfilePath: "/workspace/skills-lock.yaml",
    });

    expect(resolveProjectSkillsLockfilePathSpy).toHaveBeenCalledWith("/workspace");
    expect(loadSkillsLockfileSpy).toHaveBeenCalledWith("/workspace/skills-lock.yaml");
    expect(runInstallCommandSpy).toHaveBeenNthCalledWith(
      1,
      {
        source: "npm:@acme/alpha",
        tool: "codex",
        target: { type: "project" },
        force: true,
        skills: ["*"],
      },
      expect.objectContaining({ cwd: "/workspace" }),
    );
    expect(runInstallCommandSpy).toHaveBeenNthCalledWith(
      2,
      {
        source: "/workspace/skills/beta",
        tool: "codex",
        target: { type: "project" },
        force: true,
        skills: ["browser", "debugger"],
      },
      expect.objectContaining({ cwd: "/workspace" }),
    );
  });

  it("resolves relative lockfile sources from the project root when invoked from a nested cwd", async () => {
    vi.spyOn(lockfilePathModule, "resolveProjectSkillsLockfilePath").mockResolvedValue("/workspace/skills-lock.yaml");
    vi.spyOn(loadLockfileModule, "loadSkillsLockfile").mockResolvedValue({
      version: 2,
      skills: [{ source: "./skills/beta", name: "*" }],
    });
    const runInstallCommandSpy = vi.spyOn(installCommandModule, "runInstallCommand").mockResolvedValue({
      storedSourceDir: "/store/beta",
      installedByTool: { codex: ["beta"] },
    });

    await runInstallFromLockfileCommand(
      { tool: "codex", target: { type: "project" }, force: false },
      { cwd: "/workspace/packages/app" },
    );

    expect(runInstallCommandSpy).toHaveBeenCalledWith(
      {
        source: "/workspace/skills/beta",
        tool: "codex",
        target: { type: "project" },
        force: false,
        skills: ["*"],
      },
      expect.objectContaining({ cwd: "/workspace/packages/app" }),
    );
  });

  it("preserves relative custom target dirs against the user's original cwd", async () => {
    vi.spyOn(lockfilePathModule, "resolveProjectSkillsLockfilePath").mockResolvedValue("/workspace/skills-lock.yaml");
    vi.spyOn(loadLockfileModule, "loadSkillsLockfile").mockResolvedValue({
      version: 2,
      skills: [{ source: "./skills/beta", name: "*" }],
    });
    const runInstallCommandSpy = vi.spyOn(installCommandModule, "runInstallCommand").mockResolvedValue({
      storedSourceDir: "/store/beta",
      installedByTool: { codex: ["beta"] },
    });

    await runInstallFromLockfileCommand(
      { tool: "codex", target: { type: "dir", dir: "./custom-target" }, force: false },
      { cwd: "/workspace/packages/app" },
    );

    expect(runInstallCommandSpy).toHaveBeenCalledWith(
      {
        source: "/workspace/skills/beta",
        tool: "codex",
        target: { type: "dir", dir: "./custom-target" },
        force: false,
        skills: ["*"],
      },
      expect.objectContaining({ cwd: "/workspace/packages/app" }),
    );
  });

  it("returns a clear user-facing error when the lockfile is missing", async () => {
    vi.spyOn(lockfilePathModule, "resolveProjectSkillsLockfilePath").mockResolvedValue("/workspace/skills-lock.yaml");
    vi.spyOn(loadLockfileModule, "loadSkillsLockfile").mockRejectedValue(
      new FilesystemError("Failed to read lockfile: /workspace/skills-lock.yaml", undefined, { code: "ENOENT" }),
    );

    await expect(
      runInstallFromLockfileCommand({ tool: "codex", target: { type: "project" }, force: false }, { cwd: "/workspace" }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
      message: "Missing lockfile: /workspace/skills-lock.yaml",
      suggestion: "Run 'skill lock' in this project, or pass a source to 'skill install <source>'",
    });
  });

  it("returns a stable user-facing error when the lockfile has no skill entries", async () => {
    vi.spyOn(lockfilePathModule, "resolveProjectSkillsLockfilePath").mockResolvedValue("/workspace/skills-lock.yaml");
    vi.spyOn(loadLockfileModule, "loadSkillsLockfile").mockResolvedValue({
      version: 2,
      skills: [],
    });
    const runInstallCommandSpy = vi.spyOn(installCommandModule, "runInstallCommand");

    await expect(
      runInstallFromLockfileCommand({ tool: "codex", target: { type: "project" }, force: false }, { cwd: "/workspace" }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
      message: "Lockfile has no skill entries: /workspace/skills-lock.yaml",
      suggestion: "Add skill entries to skills-lock.yaml or regenerate it with 'skill lock'",
    });
    expect(runInstallCommandSpy).not.toHaveBeenCalled();
  });

  it("returns an aggregated failure when one source install fails", async () => {
    vi.spyOn(lockfilePathModule, "resolveProjectSkillsLockfilePath").mockResolvedValue("/workspace/skills-lock.yaml");
    vi.spyOn(loadLockfileModule, "loadSkillsLockfile").mockResolvedValue({
      version: 2,
      skills: [
        { source: "npm:@acme/alpha", name: "*" },
        { source: "./skills/beta", name: "browser" },
      ],
    });
    const output = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runInstallCommandSpy = vi.spyOn(installCommandModule, "runInstallCommand");
    runInstallCommandSpy
      .mockResolvedValueOnce({ storedSourceDir: "/store/alpha", installedByTool: { codex: ["alpha"] } })
      .mockRejectedValueOnce(new SkillCliError("Target already exists", ExitCode.FILESYSTEM));

    await expect(
      runInstallFromLockfileCommand(
        { tool: "codex", target: { type: "project" }, force: false },
        { cwd: "/workspace", output },
      ),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.FILESYSTEM,
      message: "Failed to install 1 source(s) from skills-lock.yaml",
      suggestion: "Review the source failure output above and re-run after fixing the reported sources",
    });
    expect(output.warn).toHaveBeenCalledWith("./skills/beta: Target already exists");
  });

  it("continues installing later sources after an earlier failure", async () => {
    vi.spyOn(lockfilePathModule, "resolveProjectSkillsLockfilePath").mockResolvedValue("/workspace/skills-lock.yaml");
    vi.spyOn(loadLockfileModule, "loadSkillsLockfile").mockResolvedValue({
      version: 2,
      skills: [
        { source: "./skills/alpha", name: "*" },
        { source: "./skills/beta", name: "*" },
        { source: "./skills/gamma", name: "*" },
      ],
    });
    const output = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runInstallCommandSpy = vi.spyOn(installCommandModule, "runInstallCommand");
    runInstallCommandSpy
      .mockRejectedValueOnce(new SkillCliError("Target already exists", ExitCode.FILESYSTEM))
      .mockResolvedValueOnce({ storedSourceDir: "/store/beta", installedByTool: { codex: ["beta"] } })
      .mockResolvedValueOnce({ storedSourceDir: "/store/gamma", installedByTool: { codex: ["gamma"] } });

    await expect(
      runInstallFromLockfileCommand(
        { tool: "codex", target: { type: "project" }, force: false },
        { cwd: "/workspace", output },
      ),
    ).rejects.toMatchObject({
      exitCode: ExitCode.FILESYSTEM,
      suggestion: "Review the source failure output above and re-run after fixing the reported sources",
    });

    expect(runInstallCommandSpy).toHaveBeenCalledTimes(3);
    expect(output.warn).toHaveBeenCalledWith("./skills/alpha: Target already exists");
    expect(runInstallCommandSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ source: "/workspace/skills/beta", skills: ["*"] }),
      expect.any(Object),
    );
    expect(runInstallCommandSpy).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ source: "/workspace/skills/gamma", skills: ["*"] }),
      expect.any(Object),
    );
  });

  it("falls back to source exit code when source failures disagree", async () => {
    vi.spyOn(lockfilePathModule, "resolveProjectSkillsLockfilePath").mockResolvedValue("/workspace/skills-lock.yaml");
    vi.spyOn(loadLockfileModule, "loadSkillsLockfile").mockResolvedValue({
      version: 2,
      skills: [
        { source: "./skills/alpha", name: "*" },
        { source: "./skills/beta", name: "*" },
      ],
    });
    const output = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runInstallCommandSpy = vi.spyOn(installCommandModule, "runInstallCommand");
    runInstallCommandSpy
      .mockRejectedValueOnce(new SkillCliError("Bad lockfile", ExitCode.CONFIG))
      .mockRejectedValueOnce(new SkillCliError("Target already exists", ExitCode.FILESYSTEM));

    await expect(
      runInstallFromLockfileCommand(
        { tool: "codex", target: { type: "project" }, force: false },
        { cwd: "/workspace", output },
      ),
    ).rejects.toMatchObject({
      exitCode: ExitCode.SOURCE,
      message: "Failed to install 2 source(s) from skills-lock.yaml",
      suggestion: "Review the source failure output above and re-run after fixing the reported sources",
    });
    expect(output.warn).toHaveBeenNthCalledWith(1, "./skills/alpha: Bad lockfile");
    expect(output.warn).toHaveBeenNthCalledWith(2, "./skills/beta: Target already exists");
  });

  it("preserves ExitCode.INTERNAL when any SkillCliError failure is internal", async () => {
    vi.spyOn(lockfilePathModule, "resolveProjectSkillsLockfilePath").mockResolvedValue("/workspace/skills-lock.yaml");
    vi.spyOn(loadLockfileModule, "loadSkillsLockfile").mockResolvedValue({
      version: 2,
      skills: [
        { source: "./skills/alpha", name: "*" },
        { source: "./skills/beta", name: "*" },
      ],
    });
    const output = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runInstallCommandSpy = vi.spyOn(installCommandModule, "runInstallCommand");
    runInstallCommandSpy
      .mockRejectedValueOnce(new SkillCliError("Internal failure", ExitCode.INTERNAL))
      .mockRejectedValueOnce(new SkillCliError("Target already exists", ExitCode.FILESYSTEM));

    await expect(
      runInstallFromLockfileCommand(
        { tool: "codex", target: { type: "project" }, force: false },
        { cwd: "/workspace", output },
      ),
    ).rejects.toMatchObject({
      exitCode: ExitCode.INTERNAL,
      message: "Failed to install 2 source(s) from skills-lock.yaml",
      suggestion: "Review the source failure output above and re-run after fixing the reported sources",
    });
    expect(output.warn).toHaveBeenNthCalledWith(1, "./skills/alpha: Internal failure");
    expect(output.warn).toHaveBeenNthCalledWith(2, "./skills/beta: Target already exists");
  });

  it("uses ExitCode.INTERNAL when any source failure is a raw error", async () => {
    vi.spyOn(lockfilePathModule, "resolveProjectSkillsLockfilePath").mockResolvedValue("/workspace/skills-lock.yaml");
    vi.spyOn(loadLockfileModule, "loadSkillsLockfile").mockResolvedValue({
      version: 2,
      skills: [
        { source: "./skills/alpha", name: "*" },
        { source: "./skills/beta", name: "*" },
      ],
    });
    const output = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runInstallCommandSpy = vi.spyOn(installCommandModule, "runInstallCommand");
    runInstallCommandSpy
      .mockRejectedValueOnce(new Error("Unexpected crash"))
      .mockRejectedValueOnce(new SkillCliError("Target already exists", ExitCode.FILESYSTEM));

    await expect(
      runInstallFromLockfileCommand(
        { tool: "codex", target: { type: "project" }, force: false },
        { cwd: "/workspace", output },
      ),
    ).rejects.toMatchObject({
      exitCode: ExitCode.INTERNAL,
      message: "Failed to install 2 source(s) from skills-lock.yaml",
      suggestion: "Review the source failure output above and re-run after fixing the reported sources",
    });
    expect(output.warn).toHaveBeenNthCalledWith(1, "./skills/alpha: Unexpected crash");
    expect(output.warn).toHaveBeenNthCalledWith(2, "./skills/beta: Target already exists");
  });
});
