// Formats shared by the campaign screens (J7).

// "4 mars 2027" for "2027-03-04" (the calendar of the game is UTC); the
// first of a month is "1er" in French.
export function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const text = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return day === 1 ? text.replace(/^1 /, "1er ") : text;
}
