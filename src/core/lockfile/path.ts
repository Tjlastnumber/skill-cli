import { join } from "node:path";

import { findProjectRoot } from "../project-root.js";

export async function resolveProjectSkillsLockfilePath(cwd: string): Promise<string> {
  return join(await findProjectRoot(cwd), "skills-lock.yaml");
}
