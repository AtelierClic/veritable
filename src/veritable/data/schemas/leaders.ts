import { z } from "zod";
import { IsoDateSchema, NationIdSchema } from "./common";
import { IdeologySchema } from "./politics";

// Shape of data/veritable/leaders/<iso3>.json: the political actors of a
// nation on the first day (heads of state and government, party leaders)
// and its main parties. Source: Wikidata (CC0) through the ingest tool; the
// traits of the heads are written by hand and justified, those of the party
// leaders derived from the ideology of their party.

export const ACTOR_ROLES = [
  "head-of-state",
  "head-of-government",
  "party-leader",
  "military-chief",
] as const;
export const ActorRoleSchema = z.enum(ACTOR_ROLES);
export type ActorRole = z.infer<typeof ActorRoleSchema>;

const unit = z.number().min(0).max(1);
export const TraitsSchema = IdeologySchema.extend({
  aggressiveness: unit,
  corruption: unit,
  charisma: unit,
  competence: unit,
});
export type Traits = z.infer<typeof TraitsSchema>;

export const ActorDataSchema = z.object({
  id: z.string().min(1),
  role: ActorRoleSchema,
  // Two i18n keys: the parody name (written by hand) and the fictional one
  // (drawn from the name pools at ingestion); config.leaderNames picks.
  names: z.object({ parody: z.string().min(1), fictional: z.string().min(1) }),
  born: IsoDateSchema,
  party: z.string().nullable(), // party id of this file
  traits: TraitsSchema,
  wikidata: z.string().nullable(),
  source: z.string().min(1),
  asOf: z.string().min(1),
  note: z.string().optional(),
});
export type ActorData = z.infer<typeof ActorDataSchema>;

export const PartyDataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1), // i18n key
  wikidata: z.string().nullable(),
  ideologies: z.array(z.string()), // Wikidata QIDs, as fetched
  ideology: IdeologySchema, // derived from the table, or by hand
  ideologySource: z.string().min(1),
  support: z.number().min(0).max(1), // share of the last election
  supportSource: z.object({
    source: z.string().min(1),
    asOf: z.string().min(1),
    note: z.string().optional(),
  }),
  leader: z.string().nullable(), // actor id
});
export type PartyData = z.infer<typeof PartyDataSchema>;

export const LeadersDataSchema = z
  .object({
    nation: NationIdSchema,
    actors: z.array(ActorDataSchema),
    parties: z.array(PartyDataSchema),
  })
  .refine(
    (d) =>
      d.actors.every(
        (a) => a.party === null || d.parties.some((p) => p.id === a.party),
      ) &&
      d.parties.every(
        (p) => p.leader === null || d.actors.some((a) => a.id === p.leader),
      ),
    { message: "actors and parties must reference each other consistently" },
  )
  .refine((d) => d.actors.some((a) => a.role === "head-of-government"), {
    message: "a head of government is required",
  });
export type LeadersData = z.infer<typeof LeadersDataSchema>;
