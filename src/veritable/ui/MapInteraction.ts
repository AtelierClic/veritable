import { Controller } from "../../client/Controller";
import { ContextMenuEvent } from "../../client/InputHandler";
import { TransformHandler } from "../../client/TransformHandler";
import { GameView } from "../../client/view/GameView";
import { EventBus } from "../../core/EventBus";
import { campaignController } from "./CampaignController";
import { nationCard } from "./NationCard";
import { veritableScreens } from "./VeritableScreens";
import { veritableTopBar } from "./VeritableTopBar";

// The map as an interface (J7b), for the campaign only: a right click on a
// nation opens its card near the cursor (the game goes on); a click
// elsewhere or Escape closes it. The worker says what lies under the point
// (the owner of the tile is a nation of the simulation, not a player of the
// core the client knows).

export class MapInteractionController implements Controller {
  constructor(
    private readonly eventBus: EventBus,
    private readonly transform: TransformHandler,
    private readonly game: GameView,
  ) {}

  init(): void {
    const card = nationCard();
    card.onDiplomacy = (nation) => {
      const screens = veritableScreens();
      screens.openDiplomacy(nation);
      veritableTopBar().setActiveScreen(screens.current());
    };
    this.eventBus.on(ContextMenuEvent, (e) => void this.onRightClick(e.x, e.y));
  }

  // The tile under a point of the screen, null off the map.
  tileAt(x: number, y: number): number | null {
    const cell = this.transform.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return null;
    return this.game.ref(cell.x, cell.y);
  }

  private async onRightClick(x: number, y: number): Promise<void> {
    const sim = campaignController().remote();
    const tile = this.tileAt(x, y);
    if (sim === null || tile === null) return;
    const info = await sim.tileInfo(tile);
    if (info.owner === null) {
      nationCard().close();
      return;
    }
    await nationCard().open(info.owner, x, y);
  }
}
