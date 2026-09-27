import fs from "fs";
import path from "path";
import { SAVE_SCHEMA_VERSION } from "../data/schemas/save";
import { decodeSave, encodeSave } from "./serialize";

// The prepared saves of the J7 test guide (docs/veritable/guides/J7-saves,
// written by tools/veritable/headless/prepareJ7Saves.ts) decode in the
// current version of the save and round-trip byte for byte. J7c: a field
// added to the v7 during the milestone made the saves of the guide
// unreadable (zbin has no field tags); regenerate them when this fails.

const DIR = path.resolve(__dirname, "../../../docs/veritable/guides/J7-saves");
const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith(".vsave"))
  : [];

describe("the saves of the J7 guide", () => {
  it("exist", () => {
    expect(files.sort()).toEqual([
      "j7-baroud.vsave",
      "j7-exil.vsave",
      "j7-guerre-nucleaire.vsave",
    ]);
  });

  for (const file of files) {
    it(`${file} decodes in the current version and round-trips`, () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(DIR, file)));
      const save = decodeSave(bytes);
      expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
      expect(encodeSave(save)).toEqual(bytes);
      // A world save of two megabytes: seconds on a loaded machine.
    }, 60_000);
  }
});
