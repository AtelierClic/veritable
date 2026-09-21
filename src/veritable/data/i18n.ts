import { z } from "zod";
import rawFr from "../../../data/veritable/i18n/fr.json";

// Every visible Véritable string goes through a key of
// data/veritable/i18n/fr.json (ARCHITECTURE.md, invariant 6).

const CatalogSchema = z.record(z.string(), z.string());
const catalogs: Record<string, Record<string, string>> = {
  fr: CatalogSchema.parse(rawFr),
};

let currentLang = "fr";

export function setVeritableLang(lang: string): void {
  if (!(lang in catalogs)) throw new Error(`unknown language: ${lang}`);
  currentLang = lang;
}

export function hasTextKey(key: string): boolean {
  return key in catalogs[currentLang];
}

// Returns the key itself when it is missing, so a gap is visible on screen.
export function vt(
  key: string,
  params: Record<string, string | number> = {},
): string {
  const template = catalogs[currentLang][key];
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
