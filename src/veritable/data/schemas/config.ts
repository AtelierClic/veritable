import { z } from "zod";

// Shape of data/veritable/config.json: every balancing constant has a name
// and lives there, never in a .ts file.
export const VeritableConfigSchema = z.object({
  leaderNames: z.enum(["parody", "fictional"]),
  time: z.object({
    // Game minutes elapsed per OpenFront tick at speed x1. One game month
    // (30 days = 43 200 min) per real minute (600 ticks of 100 ms) = 72.
    gameMinutesPerTick: z.number().positive(),
  }),
});
export type VeritableConfig = z.infer<typeof VeritableConfigSchema>;
