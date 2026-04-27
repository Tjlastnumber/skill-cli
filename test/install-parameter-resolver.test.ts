import { describe, expect, it, vi } from "vitest";

import { ExitCode, SkillCliError } from "../src/core/errors.js";
import {
  parseExplicitInstallTargetFlags,
  resolveInstallInputs,
} from "../src/commands/install-inputs.js";

describe("parseExplicitInstallTargetFlags", () => {
  it("preserves an explicit global target", () => {
    expect(parseExplicitInstallTargetFlags({ global: true })).toEqual({ type: "global" });
  });

  it("preserves an explicit project target", () => {
    expect(parseExplicitInstallTargetFlags({ project: true })).toEqual({ type: "project" });
  });

  it("preserves an explicit custom directory target", () => {
    expect(parseExplicitInstallTargetFlags({ dir: "./custom" })).toEqual({
      type: "dir",
      dir: "./custom",
    });
  });

  it("treats an explicit empty custom directory as invalid user input", () => {
    expect(() => parseExplicitInstallTargetFlags({ dir: "" })).toThrow(/custom directory path/i);
  });

  it("returns undefined when no explicit target was provided", () => {
    expect(parseExplicitInstallTargetFlags({})).toBeUndefined();
  });

  it("throws when multiple explicit targets are provided", () => {
    expect(() => parseExplicitInstallTargetFlags({ global: true, project: true })).toThrow(
      /Exactly one target may be specified/,
    );
  });

  it("treats an explicitly empty dir as conflicting with --global", () => {
    expect(() => parseExplicitInstallTargetFlags({ global: true, dir: "" })).toThrow(
      /Exactly one target may be specified/,
    );
  });

  it("treats an explicitly empty dir as conflicting with --project", () => {
    expect(() => parseExplicitInstallTargetFlags({ project: true, dir: "" })).toThrow(
      /Exactly one target may be specified/,
    );
  });
});

describe("resolveInstallInputs", () => {
  it("preserves explicit tool and target without prompting", async () => {
    const prompt = {
      select: vi.fn(),
      text: vi.fn(),
      cancel: vi.fn(),
      isCancel: vi.fn(() => false),
    };

    const result = await resolveInstallInputs({
      tool: "codex",
      target: { type: "global" },
      configuredTools: ["codex", "claude"],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompt,
    });

    expect(result).toEqual({
      tool: "codex",
      target: { type: "global" },
    });
    expect(prompt.select).not.toHaveBeenCalled();
    expect(prompt.text).not.toHaveBeenCalled();
  });

  it("rejects an invalid explicit tool before returning early", async () => {
    const prompt = {
      select: vi.fn(),
      text: vi.fn(),
      cancel: vi.fn(),
      isCancel: vi.fn(() => false),
    };

    await expect(
      resolveInstallInputs({
        tool: "not-a-tool",
        target: { type: "global" },
        configuredTools: ["codex", "claude"],
        stdinIsTTY: true,
        stdoutIsTTY: true,
        prompt,
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
      message: "Invalid tool selected",
    });
    expect(prompt.select).not.toHaveBeenCalled();
    expect(prompt.text).not.toHaveBeenCalled();
  });

  it("rejects explicit install inputs when no tools are configured", async () => {
    const prompt = {
      select: vi.fn(),
      text: vi.fn(),
      cancel: vi.fn(),
      isCancel: vi.fn(() => false),
    };

    await expect(
      resolveInstallInputs({
        tool: "all",
        target: { type: "global" },
        configuredTools: [],
        stdinIsTTY: true,
        stdoutIsTTY: true,
        prompt,
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
      message: "No configured tools available for install",
    });
    expect(prompt.select).not.toHaveBeenCalled();
    expect(prompt.text).not.toHaveBeenCalled();
  });

  it("prompts for a directory path when an explicit dir target is missing dir", async () => {
    const prompt = {
      select: vi.fn().mockResolvedValueOnce("codex"),
      text: vi.fn().mockResolvedValueOnce("./custom-skills"),
      cancel: vi.fn(),
      isCancel: vi.fn(() => false),
    };

    const result = await resolveInstallInputs({
      tool: undefined,
      target: { type: "dir" },
      configuredTools: ["codex", "claude"],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompt,
    });

    expect(result).toEqual({
      tool: "codex",
      target: {
        type: "dir",
        dir: "./custom-skills",
      },
    });
    expect(prompt.text).toHaveBeenCalledTimes(1);
  });

  it("throws a user input error when target is missing in non-interactive mode", async () => {
    await expect(
      resolveInstallInputs({
        tool: "codex",
        configuredTools: ["codex"],
        stdinIsTTY: false,
        stdoutIsTTY: true,
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
    });
  });

  it("throws a user input error when tool is missing in non-interactive mode", async () => {
    await expect(
      resolveInstallInputs({
        target: { type: "project" },
        configuredTools: ["codex"],
        stdinIsTTY: true,
        stdoutIsTTY: false,
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
    });
  });

  it("prompts for missing scope, custom dir, and tool in order when interactive", async () => {
    const prompt = {
      select: vi
        .fn()
        .mockResolvedValueOnce("dir")
        .mockResolvedValueOnce("claude"),
      text: vi.fn().mockResolvedValueOnce("./custom-skills"),
      cancel: vi.fn(),
      isCancel: vi.fn(() => false),
    };

    const result = await resolveInstallInputs({
      configuredTools: ["codex", "claude"],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompt,
    });

    expect(result).toEqual({
      tool: "claude",
      target: {
        type: "dir",
        dir: "./custom-skills",
      },
    });
    expect(prompt.select).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: expect.stringMatching(/install scope/i) }),
    );
    expect(prompt.text).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/directory path/i) }),
    );
    expect(prompt.select).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: expect.stringMatching(/tool/i) }),
    );
  });

  it("rejects interactive install input resolution when no tools are configured", async () => {
    const prompt = {
      select: vi.fn(),
      text: vi.fn(),
      cancel: vi.fn(),
      isCancel: vi.fn(() => false),
    };

    await expect(
      resolveInstallInputs({
        configuredTools: [],
        stdinIsTTY: true,
        stdoutIsTTY: true,
        prompt,
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
      message: "No configured tools available for install",
    });
    expect(prompt.select).not.toHaveBeenCalled();
    expect(prompt.text).not.toHaveBeenCalled();
  });

  it("throws a user input error when the selected scope is invalid", async () => {
    const prompt = {
      select: vi.fn().mockResolvedValueOnce("not-a-target"),
      text: vi.fn(),
      cancel: vi.fn(),
      isCancel: vi.fn(() => false),
    };

    await expect(
      resolveInstallInputs({
        configuredTools: ["codex", "claude"],
        stdinIsTTY: true,
        stdoutIsTTY: true,
        prompt,
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
    });
  });

  it("throws a user input error when the selected tool is invalid", async () => {
    const prompt = {
      select: vi
        .fn()
        .mockResolvedValueOnce("global")
        .mockResolvedValueOnce("not-a-tool"),
      text: vi.fn(),
      cancel: vi.fn(),
      isCancel: vi.fn(() => false),
    };

    await expect(
      resolveInstallInputs({
        configuredTools: ["codex", "claude"],
        stdinIsTTY: true,
        stdoutIsTTY: true,
        prompt,
      }),
    ).rejects.toMatchObject({
      name: SkillCliError.name,
      exitCode: ExitCode.USER_INPUT,
    });
  });

  it("includes all in the interactive tool choices and allows selecting it", async () => {
    const prompt = {
      select: vi.fn().mockResolvedValueOnce("global").mockResolvedValueOnce("all"),
      text: vi.fn(),
      cancel: vi.fn(),
      isCancel: vi.fn(() => false),
    };

    const result = await resolveInstallInputs({
      configuredTools: ["codex", "claude"],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompt,
    });

    expect(result).toEqual({
      tool: "all",
      target: { type: "global" },
    });
    expect(prompt.select).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        options: expect.arrayContaining([
          { value: "all", label: "all" },
          { value: "codex", label: "codex" },
          { value: "claude", label: "claude" },
        ]),
      }),
    );
  });

  it("returns a cancellation sentinel and emits cancel output when prompting is cancelled", async () => {
    const cancelled = Symbol("cancelled");
    const prompt = {
      select: vi.fn().mockResolvedValueOnce(cancelled),
      text: vi.fn(),
      cancel: vi.fn(),
      isCancel: vi.fn((value: unknown) => value === cancelled),
    };

    const result = await resolveInstallInputs({
      configuredTools: ["codex"],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompt,
    });

    expect(result).toEqual({ cancelled: true });
    expect(prompt.cancel).toHaveBeenCalledTimes(1);
    expect(prompt.text).not.toHaveBeenCalled();
  });

  it("returns a cancellation sentinel when the custom directory prompt is cancelled", async () => {
    const cancelled = Symbol("cancelled");
    const prompt = {
      select: vi.fn().mockResolvedValueOnce("dir"),
      text: vi.fn().mockResolvedValueOnce(cancelled),
      cancel: vi.fn(),
      isCancel: vi.fn((value: unknown) => value === cancelled),
    };

    const result = await resolveInstallInputs({
      configuredTools: ["codex"],
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompt,
    });

    expect(result).toEqual({ cancelled: true });
    expect(prompt.cancel).toHaveBeenCalledTimes(1);
  });
});
