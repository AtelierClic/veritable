import { z } from "zod";
import { IsoDateSchema } from "./common";

// Shape of data/veritable/config.json: every balancing constant has a name
// and lives there, never in a .ts file.
export const VeritableConfigSchema = z.object({
  leaderNames: z.enum(["parody", "fictional"]),
  time: z.object({
    // Game minutes elapsed per OpenFront tick at speed x1. One game month
    // (30 days = 43 200 min) per real minute (600 ticks of 100 ms) = 72.
    gameMinutesPerTick: z.number().positive(),
    // Start of a campaign whose scenario does not say otherwise (J0 ad-hoc
    // scenarios built from the map roster).
    defaultStartDate: IsoDateSchema,
  }),
  save: z.object({
    // Monthly automatic saves kept; older ones are rotated out.
    autosaveSlots: z.number().int().min(1),
  }),
});
export type VeritableConfig = z.infer<typeof VeritableConfigSchema>;
