import { afterEach, describe, expect, it, vi } from "vitest";

const { runAutoSyncProjectLockfileMock } = vi.hoisted(() => ({
  runAutoSyncProjectLockfileMock: vi.fn(),
}));

vi.mock("../src/commands/auto-sync-project-lockfile.js", () => ({
  runAutoSyncProjectLockfile: runAutoSyncProjectLockfileMock,
}));

import * as removeCommandModule from "../src/commands/remove.js";
import * as removeInputsModule from "../src/commands/remove-inputs.js";
import * as loadConfigModule from "../src/core/config/load.js";
import { runCli } from "../src/cli.js";
import { ExitCode, SkillCliError } from "../src/core/errors.js";

afterEach(() => {
  vi.restoreAllMocks();
  runAutoSyncProjectLockfileMock.mockReset();
  process.exitCode = undefined;
});

describe("runCli remove", () => {
  it("resolves project-default remove inputs before running removal", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        opencode: {
          globalDir: ".opencode/global",
          projectDir: ".opencode/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    const resolveRemoveInputsSpy = vi.spyOn(removeInputsModule, "resolveRemoveInputs").mockResolvedValue({
      bundleName: undefined,
      skillName: "browser",
      tool: "opencode",
      target: { type: "project" },
      selectedSkill: {
        tool: "opencode",
        bundleName: "skills-source",
        skillName: "browser",
        target: { type: "project" },
        targetRoot: "/repo/.opencode/project",
        linkPath: "/repo/.opencode/project/browser",
      },
    });
    const runRemoveCommandSpy = vi
      .spyOn(removeCommandModule, "runRemoveCommand")
      .mockResolvedValue(undefined as never);

    await runCli(["node", "skill", "remove", "--skill", "browser"]);

    expect(resolveRemoveInputsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bundleName: undefined,
        skillName: "browser",
        tool: undefined,
        target: undefined,
        configuredTools: ["opencode"],
      }),
    );
    expect(runRemoveCommandSpy).toHaveBeenCalledWith({
      bundleName: undefined,
      skillName: "browser",
      selectedSkill: {
        tool: "opencode",
        bundleName: "skills-source",
        skillName: "browser",
        target: { type: "project" },
        targetRoot: "/repo/.opencode/project",
        linkPath: "/repo/.opencode/project/browser",
      },
      tool: "opencode",
      target: { type: "project" },
    });
    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "remove",
      tool: "all",
    });
  });

  it("passes bundle-name remove through the resolver", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(removeInputsModule, "resolveRemoveInputs").mockResolvedValue({
      bundleName: "alpha-skill",
      skillName: undefined,
      tool: "codex",
      target: { type: "global" },
    });
    const runRemoveCommandSpy = vi
      .spyOn(removeCommandModule, "runRemoveCommand")
      .mockResolvedValue(undefined as never);

    await runCli(["node", "skill", "remove", "alpha-skill", "--global"]);

    expect(runRemoveCommandSpy).toHaveBeenCalledWith({
      bundleName: "alpha-skill",
      skillName: undefined,
      tool: "codex",
      target: { type: "global" },
    });
    expect(runAutoSyncProjectLockfileMock).not.toHaveBeenCalled();
  });

  it("auto-syncs after successful project removals", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(removeInputsModule, "resolveRemoveInputs").mockResolvedValue({
      bundleName: "alpha-skill",
      skillName: undefined,
      tool: "codex",
      target: { type: "project" },
    });
    const runRemoveCommandSpy = vi
      .spyOn(removeCommandModule, "runRemoveCommand")
      .mockResolvedValue(undefined as never);

    await runCli(["node", "skill", "remove", "alpha-skill", "--project"]);

    expect(runRemoveCommandSpy).toHaveBeenCalledWith({
      bundleName: "alpha-skill",
      skillName: undefined,
      tool: "codex",
      target: { type: "project" },
    });
    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "remove",
      tool: "all",
    });
  });

  it("does not auto-sync after global removals", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(removeInputsModule, "resolveRemoveInputs").mockResolvedValue({
      bundleName: "alpha-skill",
      skillName: undefined,
      tool: "codex",
      target: { type: "global" },
    });
    vi.spyOn(removeCommandModule, "runRemoveCommand").mockResolvedValue(undefined as never);

    await runCli(["node", "skill", "remove", "alpha-skill", "--global"]);

    expect(runAutoSyncProjectLockfileMock).not.toHaveBeenCalled();
  });

  it("forwards tool all into auto-sync for project removals", async () => {
    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(removeInputsModule, "resolveRemoveInputs").mockResolvedValue({
      bundleName: "alpha-skill",
      skillName: undefined,
      tool: "all",
      target: { type: "project" },
    });
    vi.spyOn(removeCommandModule, "runRemoveCommand").mockResolvedValue(undefined as never);

    await runCli(["node", "skill", "remove", "alpha-skill", "--project"]);

    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "remove",
      tool: "all",
    });
  });

  it("surfaces auto-sync failures after successful project removals", async () => {
    const stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    vi.spyOn(loadConfigModule, "loadConfig").mockResolvedValue({
      storeDir: ".skill-store",
      tools: {
        codex: {
          globalDir: ".codex/global",
          projectDir: ".codex/project",
          entryPattern: "*",
          nameStrategy: "basename",
        },
      },
    });
    vi.spyOn(removeInputsModule, "resolveRemoveInputs").mockResolvedValue({
      bundleName: "alpha-skill",
      skillName: undefined,
      tool: "codex",
      target: { type: "project" },
    });
    vi.spyOn(removeCommandModule, "runRemoveCommand").mockResolvedValue(undefined as never);
    runAutoSyncProjectLockfileMock.mockRejectedValue(
      new SkillCliError(
        "Remove succeeded but automatic lockfile sync failed",
        ExitCode.FILESYSTEM,
        "Re-run `skill lock` to regenerate the project lockfile",
      ),
    );

    await runCli(["node", "skill", "remove", "alpha-skill", "--project"]);

    expect(runAutoSyncProjectLockfileMock).toHaveBeenCalledWith({
      action: "remove",
      tool: "all",
    });
    expect(process.exitCode).toBe(ExitCode.FILESYSTEM);
    expect(stderrWriteSpy).toHaveBeenCalledWith(
      "ERROR: Remove succeeded but automatic lockfile sync failed\n",
    );
    expect(stdoutWriteSpy).toHaveBeenCalledWith(
      "Suggestion: Re-run `skill lock` to regenerate the project lockfile\n",
    );
  });
});
