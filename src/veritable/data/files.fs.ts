import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DataFileNotFound, RawDataFiles } from "./DataSource";

// data/veritable/ read from disk: the headless runner and the tools (tsx).
// Never imported by the client bundle.

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA_ROOT = path.resolve(HERE, "../../../data/veritable");

export function fsDataFiles(root: string = DATA_ROOT): RawDataFiles {
  const resolve = (relative: string) => {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) throw new DataFileNotFound(relative);
    return file;
  };
  return {
    json: (relative) => JSON.parse(fs.readFileSync(resolve(relative), "utf8")),
    list: (directory, suffix) =>
      fs
        .readdirSync(path.join(root, directory))
        .filter((name) => name.endsWith(suffix))
        .map((name) => `${directory}/${name}`),
    bytes: async (relative) =>
      new Uint8Array(fs.readFileSync(resolve(relative))),
  };
}
