import rawConfig from "../../../data/veritable/config.json";
import { VeritableConfig, VeritableConfigSchema } from "./schemas/config";

let cached: VeritableConfig | null = null;

// data/veritable/config.json, validated. Throws on an invalid file: a broken
// balancing file must never start a campaign.
export function loadVeritableConfig(): VeritableConfig {
  cached ??= VeritableConfigSchema.parse(rawConfig);
  return cached;
}
