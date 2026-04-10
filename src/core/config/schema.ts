import { z } from "zod";

export const toolConfigSchema = z.object({
  globalDir: z.string().min(1),
  projectDir: z.string().min(1),
  entryPattern: z.string().min(1),
  nameStrategy: z.string().min(1),
});

export const toolConfigOverrideSchema = toolConfigSchema.partial();

export const configOverrideSchema = z
  .object({
    storeDir: z.string().min(1).optional(),
    tools: z.record(z.string(), toolConfigOverrideSchema).optional(),
  })
  .strict();

export const resolvedConfigSchema = z
  .object({
    storeDir: z.string().min(1),
    tools: z.record(z.string(), toolConfigSchema),
  })
  .strict();

export type ToolConfig = z.infer<typeof toolConfigSchema>;
export type ToolConfigOverride = z.infer<typeof toolConfigOverrideSchema>;
export type ConfigOverride = z.infer<typeof configOverrideSchema>;
export type ResolvedConfig = z.infer<typeof resolvedConfigSchema>;
