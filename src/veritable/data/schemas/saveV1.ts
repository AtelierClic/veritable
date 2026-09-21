import { z } from "zod";
import { zb } from "../../../../zbin";
import { IsoDateSchema, NationIdSchema, RegimeSchema } from "./common";

// Save file, schemaVersion 1 (J0-J1). FROZEN: never edit this file again.
//
// zbin has no version byte and no field tags: the schema IS the format. This
// file is therefore FROZEN once a save of this version exists in the wild.
// Any change of shape = a new saveVN schema + a migration in
// src/veritable/save/migrations/ (see ARCHITECTURE.md, invariant 2).

export const NATION_STATUSES = ["active", "exiled", "dissolved"] as const;
export const NationStatusSchema = z.enum(NATION_STATUSES);
export type NationStatus = z.infer<typeof NationStatusSchema>;

export const NationNameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("key"), key: z.string() }),
  z.object({ kind: z.literal("literal"), text: z.string() }),
]);
export type NationName = z.infer<typeof NationNameSchema>;

const SaveTerritorySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tiles") }),
  z.object({
    kind: z.literal("microstate"),
    hostTile: z.tuple([zb.uint(), zb.uint()]),
  }),
]);

// A nation is an autonomous entity. Tiles reference it (by index in the save,
// by smallID in the OpenFront core); it never depends on them to exist.
export const NationStateSchema = z.object({
  id: NationIdSchema,
  name: NationNameSchema,
  regime: RegimeSchema.nullable(), // null for J0 ad-hoc nations
  territory: SaveTerritorySchema,
  status: NationStatusSchema,
  tileCount: zb.uint(), // cache refreshed from the world; never a liveness test
  isPlayer: z.boolean(),
});
export type NationState = z.infer<typeof NationStateSchema>;

export const SPEEDS = [0, 1, 2, 5] as const;
export const CalendarSchema = z.object({
  startDate: IsoDateSchema,
  elapsedGameMinutes: zb.float(),
  date: IsoDateSchema, // derived from the two fields above, kept readable
  speed: zb.uint({ max: 5 }),
});
export type Calendar = z.infer<typeof CalendarSchema>;

export const JOURNAL_KINDS = ["campaign-started", "nation-status"] as const;
export const JournalEntrySchema = z.object({
  date: IsoDateSchema,
  kind: z.enum(JOURNAL_KINDS),
  nation: NationIdSchema.optional(),
  params: z.record(z.string(), z.string()),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

// State of the inherited OpenFront core that survives a reload. In-flight
// state (attacks, boats, warheads, legacy AI, alliances, embargoes) is NOT
// saved until the system that owns it is replaced (see DECISIONS.md).
export const CoreStructureSchema = z.object({
  type: z.string(),
  tile: zb.uint(),
  level: zb.uint(),
});
export const CorePlayerStateSchema = z.object({
  nation: NationIdSchema,
  troops: zb.float(),
  gold: z.bigint(),
  spawnTile: zb.uint().nullable(),
  structures: z.array(CoreStructureSchema),
});
export type CorePlayerState = z.infer<typeof CorePlayerStateSchema>;

export const WorldStateSchema = z.object({
  // Opaque to the simulation: whatever the adapter needs to recreate the
  // same core game (OpenFront GameStartInfo). JSON-encoded.
  coreStart: zb.json(z.unknown()),
  players: z.array(CorePlayerStateSchema),
});
export type WorldState = z.infer<typeof WorldStateSchema>;

export const SaveHeaderV1Schema = zb.object({
  schemaVersion: z.literal(1),
  seed: zb.uint(),
  rngState: z.tuple([zb.uint(), zb.uint(), zb.uint(), zb.uint()]),
  calendar: CalendarSchema,
  nations: z.array(NationStateSchema),
  blocs: z.array(z.object({ id: z.string() })),
  world: WorldStateSchema,
  journal: z.array(JournalEntrySchema),
  metrics: z.record(z.string(), zb.float()),
  tilesInfo: z.object({ width: zb.uint(), height: zb.uint() }),
});
export type SaveHeaderV1 = z.infer<typeof SaveHeaderV1Schema>;

// Tile grid of a save. One 16-bit value per tile:
//   bits 0-11  index of the owning nation in `nations[]`, + 1 (0 = no owner)
//   bit  13    fallout
// Stored apart from the header, RLE-compressed (src/veritable/save/tiles.ts).
export const TILE_NATION_MASK = 0x0fff;
export const TILE_FALLOUT_BIT = 1 << 13;

export type SaveFileV1 = SaveHeaderV1 & { tiles: Uint16Array };
