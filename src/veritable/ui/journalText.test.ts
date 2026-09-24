import { ReadonlyWorldView } from "../sim/VeritableSim";
import { leaderName, namedParams } from "./journalText";

// J6c: the journal showed "gouvernement formé (fra-renaissance), dirigé par
// leader.fra-gabriel-attal.parody".
describe("the names of the journal", () => {
  const view = {
    politics: {
      FRA: {
        parties: [
          {
            id: "fra-renaissance",
            name: { kind: "key", key: "party.fra-renaissance" },
          },
          {
            id: "fra-les-republicains",
            name: { kind: "key", key: "party.fra-les-republicains" },
          },
        ],
      },
    },
  } as unknown as ReadonlyWorldView;

  it("translate a leader's key, keep a generated leader's literal name", () => {
    expect(leaderName("leader.fra-gabriel-attal.parody")).toBe(
      "Gabriel Attelle",
    );
    expect(leaderName("Général Duval")).toBe("Général Duval");
  });

  it("name the parties of a government and the winner of an election", () => {
    const named = namedParams(view, "FRA", {
      parties: "fra-renaissance, fra-les-republicains",
      leader: "leader.fra-gabriel-attal.parody",
      winner: "fra-les-republicains",
    });
    expect(named.parties).toBe("Renaissance, Les Républicains");
    expect(named.winner).toBe("Les Républicains");
    expect(named.leader).toBe("Gabriel Attelle");
    // An unknown id stays as it is.
    expect(namedParams(view, "FRA", { winner: "x" }).winner).toBe("x");
  });
});
