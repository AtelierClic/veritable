import fs from "fs";
import path from "path";
import { hasTextKey } from "../data/i18n";
import { INTEREST_GROUPS } from "../data/schemas/common";
import { SPENDING_POSTS, TAX_IDS } from "../data/schemas/nation";
import { JOURNAL_KINDS } from "../data/schemas/save";
import { SCREENS } from "./VeritableScreens";

// No visible string outside fr.json: every key the screens build or use exists.
describe("i18n keys of the screens", () => {
  it("has a label for every tax, spending post, group, screen and journal kind", () => {
    const keys = [
      ...TAX_IDS.map((t) => `tax.${t}`),
      ...SPENDING_POSTS.map((p) => `spending.${p}`),
      ...INTEREST_GROUPS.map((g) => `group.${g}`),
      ...SCREENS.map((s) => `screen.${s}.title`),
      ...JOURNAL_KINDS.map((k) => `journal.${k}`),
    ];
    for (const key of keys) expect(hasTextKey(key), key).toBe(true);
  });

  it('every literal vt("...") key of src/veritable/ui exists', () => {
    const missing: string[] = [];
    for (const file of fs.readdirSync(__dirname)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const code = fs.readFileSync(path.join(__dirname, file), "utf8");
      for (const match of code.matchAll(/vt\(\s*"([^"$]+)"/g)) {
        if (!hasTextKey(match[1])) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
