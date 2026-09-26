import { JournalEntry } from "../data/schemas/save";
import {
  classify,
  DEFAULT_PAUSE_SETTINGS,
  PAUSE_COOLDOWN_MS,
  shouldPause,
} from "./notices";

// J7: what pauses the game, what makes a card, what only goes to the journal.
const ctx = {
  playerNation: "FRA",
  neighbours: ["ESP", "DEU"],
  allies: ["DEU", "ITA"],
  enemies: ["RUS"],
  blocs: ["eu"],
};
const entry = (
  kind: JournalEntry["kind"],
  nation: string,
  params: Record<string, string> = {},
): JournalEntry => ({ date: "2027-03-04", kind, nation, params });
const level = (e: JournalEntry) => {
  const n = classify(e, ctx);
  return n.category === null ? n.level : `${n.level}:${n.category}`;
};

describe("the notices of the player (J7)", () => {
  it("a war on the player, an ally or a neighbour pauses; elsewhere it is news or the journal", () => {
    expect(level(entry("war-declared", "RUS", { target: "FRA" }))).toBe(
      "critical:war",
    );
    expect(level(entry("war-declared", "RUS", { target: "ITA" }))).toBe(
      "critical:war",
    );
    expect(level(entry("war-declared", "MAR", { target: "ESP" }))).toBe(
      "critical:war",
    );
    expect(level(entry("war-declared", "DEU", { target: "POL" }))).toBe("info");
    expect(level(entry("war-declared", "IND", { target: "PAK" }))).toBe("log");
    // Its own declaration is its act.
    expect(level(entry("war-declared", "FRA", { target: "ESP" }))).toBe("log");
  });

  it("any nuclear shot, a coup next door, a collapse anywhere, a vote of its bloc pause", () => {
    expect(level(entry("nuclear-launch", "IND", { target: "PAK" }))).toBe(
      "critical:nuclear",
    );
    expect(level(entry("nuclear-launch", "FRA", { target: "RUS" }))).toBe(
      "log",
    );
    expect(level(entry("coup-succeeded", "ESP"))).toBe("critical:regime");
    expect(level(entry("coup-succeeded", "FRA"))).toBe("critical:regime");
    expect(level(entry("coup-succeeded", "MLI"))).toBe("log");
    expect(level(entry("nation-status", "UKR", { to: "exiled" }))).toBe(
      "critical:collapse",
    );
    expect(
      level(entry("bloc-proposal", "DEU", { bloc: "eu", target: "RUS" })),
    ).toBe("critical:vote");
    // A measure against the player is not its vote.
    expect(
      level(entry("bloc-proposal", "DEU", { bloc: "eu", target: "FRA" })),
    ).toBe("log");
    expect(
      level(entry("bloc-proposal", "BRA", { bloc: "mercosur", target: "" })),
    ).toBe("log");
  });

  it("what happens to its nation is a card that fades; its government's choice too, not its own", () => {
    expect(level(entry("election-held", "FRA"))).toBe("info");
    expect(level(entry("sanctions-imposed", "FRA", { by: "RUS" }))).toBe(
      "info",
    );
    expect(level(entry("sanctions-imposed", "RUS", { by: "FRA" }))).toBe("log");
    expect(level(entry("event-occurred", "FRA", { by: "government" }))).toBe(
      "info",
    );
    expect(level(entry("event-occurred", "FRA", { by: "player" }))).toBe("log");
    expect(level(entry("election-held", "DEU"))).toBe("log");
  });

  it("pauses at most once every 20 real seconds, never at pause, never when turned off", () => {
    const s = structuredClone(DEFAULT_PAUSE_SETTINGS);
    expect(shouldPause(s, "war", 1000, null, 5)).toBe(true);
    expect(shouldPause(s, "war", 1000 + PAUSE_COOLDOWN_MS - 1, 1000, 5)).toBe(
      false,
    );
    expect(shouldPause(s, "war", 1000 + PAUSE_COOLDOWN_MS, 1000, 5)).toBe(true);
    expect(shouldPause(s, "war", 1000, null, 0)).toBe(false);
    s.categories.war = false;
    expect(shouldPause(s, "war", 1000, null, 5)).toBe(false);
    s.categories.war = true;
    s.seconds = 0;
    expect(shouldPause(s, "war", 1000, null, 5)).toBe(false);
  });
});
