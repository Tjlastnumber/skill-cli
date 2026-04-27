import { z } from "zod";

export const skillsLockfileBundleSchema = z
  .object({
    source: z.string().min(1),
  })
  .strict();

export const skillsLockfileSchema = z
  .object({
    version: z.literal(1),
    bundles: z.array(skillsLockfileBundleSchema),
  })
  .strict();

export type SkillsLockfile = z.infer<typeof skillsLockfileSchema>;
