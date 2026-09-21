import {
  GameConfig,
  GameStartInfo,
  GameStartInfoSchema,
} from "../../core/Schemas";
import { decodeSave } from "../save/serialize";

// Every solo game is a Véritable campaign (DECISIONS.md, 2026-09-21). These
// are mode rules, not balancing: the legacy mechanics below contradict the
// design (no victory, no elimination, tiles belong to nations).
export function veritableSoloConfig(config: GameConfig): GameConfig {
  return {
    ...config,
    veritable: true,
    // No win condition: no lobby timer, no Overtime.
    maxTimerValue: undefined,
    overtime: undefined,
    // The Doomsday Clock is an elimination mechanic.
    doomsdayClock: undefined,
    // Tribes are not nations: their tiles would belong to nobody in a save.
    bots: 0,
  };
}

// The GameStartInfo stored in a save, validated: it recreates the core game
// the save was made in.
export function gameStartInfoFromSave(bytes: Uint8Array): GameStartInfo {
  const save = decodeSave(bytes);
  const start = GameStartInfoSchema.parse(save.world.coreStart);
  return { ...start, config: veritableSoloConfig(start.config) };
}
