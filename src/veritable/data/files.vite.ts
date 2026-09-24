/// <reference types="vite/client" />
import { DataFileNotFound, RawDataFiles } from "./DataSource";

// data/veritable/ bundled by Vite (client, game worker, Vitest).

const PREFIX = "../../../data/veritable/";

const jsonFiles = {
  ...import.meta.glob<unknown>("../../../data/veritable/*.json", {
    eager: true,
    import: "default",
  }),
  ...import.meta.glob<unknown>(
    "../../../data/veritable/{goods,nations,scenarios,blocs,war,politics,laws,leaders,names}/*.json",
    { eager: true, import: "default" },
  ),
  ...import.meta.glob<unknown>(
    "../../../data/veritable/{tech,tech/branches,events/scripted,events/templates}/*.json",
    { eager: true, import: "default" },
  ),
  ...import.meta.glob<unknown>("../../../data/veritable/borders/*.meta.json", {
    eager: true,
    import: "default",
  }),
  ...import.meta.glob<unknown>("../../../data/veritable/maps/*.seas.json", {
    eager: true,
    import: "default",
  }),
};

// Inlined as a data: URL — the game worker runs from a blob: URL, where
// relative asset URLs do not resolve.
const binaryFiles = import.meta.glob<string>(
  "../../../data/veritable/borders/*.bin",
  { query: "?inline", import: "default" },
);

export function viteDataFiles(): RawDataFiles {
  return {
    json(path) {
      const key = PREFIX + path;
      if (!(key in jsonFiles)) throw new DataFileNotFound(path);
      return jsonFiles[key];
    },
    list: (directory, suffix) =>
      Object.keys(jsonFiles)
        .filter(
          (key) =>
            key.startsWith(`${PREFIX}${directory}/`) && key.endsWith(suffix),
        )
        .map((key) => key.slice(PREFIX.length)),
    async bytes(path) {
      const load = binaryFiles[PREFIX + path];
      if (load === undefined) throw new DataFileNotFound(path);
      const dataUrl = await load();
      const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    },
  };
}
