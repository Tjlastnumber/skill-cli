import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export function expandHomePath(input: string, homeDir: string = homedir()): string {
  if (input === "~") {
    return homeDir;
  }

  if (input.startsWith("~/")) {
    return resolve(homeDir, input.slice(2));
  }

  return input;
}

export function resolvePath(input: string, cwd: string, homeDir: string = homedir()): string {
  const expanded = expandHomePath(input, homeDir);
  if (isAbsolute(expanded)) {
    return expanded;
  }
  return resolve(cwd, expanded);
}
