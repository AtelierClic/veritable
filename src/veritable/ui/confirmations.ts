import { RemoteVeritableSim } from "../adapters/RemoteVeritableSim";
import { dataSource } from "../data/catalog";
import { vt } from "../data/i18n";
import { NationId } from "../data/schemas/common";
import { PlayerCommand, WarPreview } from "../sim/VeritableSim";
import { confirmAction } from "./ConfirmModal";
import { Names } from "./journalText";

// The two irreversible actions the player launches itself (J7), the same
// from the screens and from the action menu of the map (J7b): a declaration
// of war — its casus belli, then what it would bring down as the AI weighs
// its own wars, computed in the worker — and a nuclear shot.

// Nations named in a list of the preview; the others are counted.
const SHOWN_NATIONS = 6;

const percent = (v: number) =>
  `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`;
const whole = (v: number) =>
  v.toLocaleString("fr-FR", { maximumFractionDigits: 0 });

export function casusBelliName(id: string): string {
  const entry = dataSource.casusBelli().find((c) => c.id === id);
  return vt(entry?.name ?? `casus.${id}`);
}

function nationList(items: string[]): string {
  if (items.length === 0) return vt("confirm.none");
  if (items.length <= SHOWN_NATIONS) return items.join(", ");
  const rest = items.length - SHOWN_NATIONS;
  const list = items.slice(0, SHOWN_NATIONS).join(", ");
  return rest === 1
    ? vt("confirm.list-more-one", { list })
    : vt("confirm.list-more", { list, count: rest });
}

export function warPreviewText(preview: WarPreview, names: Names): string {
  return vt("confirm.war.body", {
    casus: casusBelliName(preview.casusBelli),
    sanctions: percent(preview.sanctionsShare),
    sanctioners: nationList(preview.sanctioners.map((n) => names.nation(n))),
    coalition: nationList(
      preview.coalition.map(
        (c) => `${names.nation(c.nation)} (${percent(c.probability)})`,
      ),
    ),
    relations: whole(preview.relationsCost),
    monthly:
      preview.monthlyRelationsCost > 0
        ? vt("confirm.war.monthly", {
            cost: whole(preview.monthlyRelationsCost),
          })
        : "",
  });
}

// The preview, the confirmation, then the declaration.
export async function declareWarConfirmed(
  sim: RemoteVeritableSim,
  names: Names,
  target: NationId,
  casusBelli: string,
  apply: (command: PlayerCommand) => Promise<void>,
): Promise<void> {
  const preview = await sim.warPreview(target, casusBelli);
  const ok = await confirmAction({
    title: vt("confirm.war.title", { nation: names.nation(target) }),
    body: warPreviewText(preview, names),
    confirm: vt("confirm.war.declare"),
  });
  if (!ok) return;
  await apply({ type: "declare-war", target, casusBelli });
}

// A nuclear shot on the front or the capital of an enemy.
export async function nuclearLaunchConfirmed(
  names: Names,
  target: NationId,
  aim: "front" | "capital",
  apply: (command: PlayerCommand) => Promise<void>,
): Promise<void> {
  const ok = await confirmAction({
    title: vt("confirm.nuclear.title"),
    body: vt(`confirm.nuclear.body-${aim}`, { nation: names.nation(target) }),
    confirm: vt("confirm.nuclear.fire"),
  });
  if (!ok) return;
  await apply({ type: "nuclear-launch", target, aim, confirmed: true });
}
