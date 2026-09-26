import fs from "fs";
import path from "path";

// J7b: every figure about another nation shown to the player goes through
// perceive() (sim/intel/intel.ts), by the accessors of ui/intel.ts. This
// test refuses, in every file of src/veritable/ui/ but ui/intel.ts, a read
// of the tables of the view by nation — the raw values of a nation other
// than the player's. A line carrying public information of another nation
// (its name, regime, leader or parties) says so with the marker
// "intel: public" on it or on the line above.

const RAW_READS: readonly RegExp[] = [
  /\.economies\s*\[/,
  /\.politics\s*\[/,
  /military\.nations\s*\[/,
  /nuclear\.nations\s*\[/,
  /\.nuclearRisk\s*\[/,
  /\.deadHand\s*\[/,
  /tech\.nations\s*\[/,
  /\.power\s*\[/,
  /\.coupRisk\s*\[/,
  /ai\.nations\s*\[/,
  /intel\.state\b/,
  /\.sides\s*\[/,
  /Object\.(values|entries|keys)\(\s*\w+\.(economies|politics|military|nuclear)\b/,
];

describe("the screens read the figures of other nations through perceive (J7b)", () => {
  it("has no raw read of a table by nation outside ui/intel.ts", () => {
    const dir = __dirname;
    const violations: string[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      if (file === "intel.ts") continue;
      const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!RAW_READS.some((re) => re.test(line))) return;
        const marked =
          line.includes("intel: public") ||
          (i > 0 && lines[i - 1].includes("intel: public"));
        if (!marked) violations.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(violations).toEqual([]);
  });
});
