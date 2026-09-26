import { z } from "zod";
import { INTEREST_GROUPS, IsoDateSchema, NationIdSchema } from "./common";
import { GOOD_IDS } from "./goods";

// Shape of data/veritable/events/scripted/<id>.json and
// events/templates/<id>.json (J5). One trigger engine (sim/events): every
// day (J7; once a month until the J6), for each nation the event may
// concern, the probability of the day is drawn and the conditions read. The player answers in a pop-up (at most two
// a month), the AI chooses by its agenda. An event names functions (a
// minister, the head of government, the army), never a real person, and
// blames no crime or scandal on a real leader.

const goods = (prefix: string) =>
  GOOD_IDS.map((g) => `${prefix}.${g}`) as string[];

// What a condition reads of the nation concerned (the subject):
//   stability, opinion, legitimacy, exhaustion      0..1
//   debtToGdp, deficitToGdp, growth                  ratios (growth per year)
//   shortage                                          index 0..1
//   coverage.<good>                                   0..1
//   price.<good>                                      world price / base price
//   atWar, unrest, democratic, nuclear, player        0 or 1
//   bloc.<id>                                         1 if a full member
//   lostTiles                                         share of the tiles of
//                                                     the first day it lost
//   gdpPerCapita                                      US$
//   regime                                            regime id (eq / ne)
export const EVENT_CONDITION_TARGETS = [
  "stability",
  "opinion",
  "legitimacy",
  "exhaustion",
  "debtToGdp",
  "deficitToGdp",
  "growth",
  "shortage",
  "atWar",
  "unrest",
  "democratic",
  "nuclear",
  "player",
  "lostTiles",
  "gdpPerCapita",
  "regime",
  ...goods("coverage"),
  ...goods("price"),
] as const;

export const EventConditionSchema = z.object({
  target: z.union([
    z.enum(EVENT_CONDITION_TARGETS as unknown as [string, ...string[]]),
    z.string().regex(/^bloc\.[a-z0-9-]+$/),
  ]),
  op: z.enum(["lt", "le", "gt", "ge", "eq", "ne"]),
  value: z.union([z.number(), z.string()]),
});
export type EventCondition = z.infer<typeof EventConditionSchema>;

// What an effect changes. On the subject:
//   budget.pctGdp        add  one-off budget balance, share of GDP (-0.005 =
//                             a cost of 0.5 % of GDP, paid into the debt)
//   gdp                  mul  GDP level, once
//   growth               add  trend growth per year for `months` months
//   stability, opinion, legitimacy, exhaustion   add
//   group.<id>           add  an interest group (the player's nation only)
//   capital              add  political capital (the player's nation only)
//   production.<good>    mul  capacity, once
//   consumption.<good>   mul  demand base, once
//   spending.defense, spending.research          add  share of GDP
//   unrest               set  1: unrest starts
//   relations.all        add  relations of every other nation with it
//   relations.neighbors  add  with its land neighbours
//   relations.other      add  with the other nation of the event (template)
//   relations.<ISO3>     add  with that nation
//   grievance.other, grievance.<ISO3>   set  a casus belli ("grievance")
//                             against that nation for `months` months
//   law.<id>             set  enacts that law, capital aside (J7); the
//                             government sets such a choice aside when the
//                             law is outside its window
// On the world (scope "world", or any event):
//   worldSupply.<good>   add  supply shock of the rest of the world (-0.1 =
//                             a tenth of its supply, fading month by month)
export const EventEffectSchema = z.object({
  target: z.union([
    z.enum([
      "budget.pctGdp",
      "gdp",
      "growth",
      "stability",
      "opinion",
      "legitimacy",
      "exhaustion",
      "capital",
      "spending.defense",
      "spending.research",
      "unrest",
      "relations.all",
      "relations.neighbors",
      "relations.other",
      "grievance.other",
    ]),
    z.enum(INTEREST_GROUPS.map((g) => `group.${g}`) as [string, ...string[]]),
    z.enum(goods("production") as [string, ...string[]]),
    z.enum(goods("consumption") as [string, ...string[]]),
    z.enum(goods("worldSupply") as [string, ...string[]]),
    z.string().regex(/^(relations|grievance)\.[A-Z]{3}$/),
    // J7: enact a law of the catalogue (the government's window applies).
    z.string().regex(/^law\.[a-z0-9-]+$/),
  ]),
  op: z.enum(["add", "mul", "set"]),
  value: z.number(),
  months: z.number().int().min(1).optional(), // growth, grievance
  // The outcome is uncertain: it happens with probability 0.5 (the pop-up
  // says so).
  uncertain: z.boolean().optional(),
});
export type EventEffect = z.infer<typeof EventEffectSchema>;

export const EventChoiceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1), // i18n key event.<id>.<choice>
  effects: z.array(EventEffectSchema),
});
export type EventChoice = z.infer<typeof EventChoiceSchema>;

export const EventSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["scripted", "template"]),
  title: z.string().min(1), // i18n key event.<id>.title
  text: z.string().min(1), // i18n key event.<id>.text; {nation} {other} {good}
  // nation: it concerns one nation at a time (the subject); world: it
  // happens once in the world (its `worldEffects`), and the player gets its
  // choices.
  scope: z.enum(["nation", "world"]),
  trigger: z.object({
    dateRange: z.tuple([IsoDateSchema, IsoDateSchema]).optional(),
    // The nations it may concern (scope nation); absent: any.
    nations: z.array(NationIdSchema).optional(),
    monthlyProbability: z.number().min(0).max(1),
    conditions: z.array(EventConditionSchema),
    // Scripted events happen once by default; templates repeat after their
    // cooldown (per nation).
    once: z.boolean().optional(),
    cooldownMonths: z.number().int().min(0).optional(),
  }),
  // Templates: how the other nation and the good are drawn. A
  // "tense-neighbor" is a land neighbour with relations at or under
  // events.tenseNeighbourRelations (J6c); without one the event does not
  // fire.
  params: z
    .object({
      other: z.enum(["neighbor", "tense-neighbor", "any", "rival"]).optional(),
      good: z.enum(["any", "energy", "food", "industrial"]).optional(),
    })
    .optional(),
  worldEffects: z.array(EventEffectSchema).optional(),
  // What happens to the subject when the event fires, before any choice
  // (a riot is already in the streets).
  effects: z.array(EventEffectSchema).optional(),
  choices: z.array(EventChoiceSchema).min(1).max(4),
  pause: z.boolean(),
  journal: z.boolean(),
});
export type VeritableEvent = z.infer<typeof EventSchema>;
