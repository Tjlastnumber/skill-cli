import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("removed CLI surfaces", () => {
  it("does not register the register command", async () => {
    await runCli(["node", "skill", "register"]);
    expect(process.exitCode).toBe(1);
  });

  it("does not register the relink command", async () => {
    await runCli(["node", "skill", "relink"]);
    expect(process.exitCode).toBe(1);
  });

  it("does not accept doctor --repair-registry", async () => {
    await runCli(["node", "skill", "doctor", "--repair-registry"]);
    expect(process.exitCode).toBe(1);
  });
});
