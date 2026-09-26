import { Controller } from "../../client/Controller";
import { CenterCameraEvent } from "../../client/InputHandler";
import { GoToPositionEvent } from "../../client/TransformHandler";
import { GameView } from "../../client/view/GameView";
import { EventBus } from "../../core/EventBus";
import { dataSource } from "../data/catalog";
import { campaignController } from "./CampaignController";

// The camera of a campaign (J7b): once the campaign has started it goes to
// the capital of the player at the scale of a region, then moves only on
// the player's order — an entry of the journal, a marker, the mini-map, and
// the key that centres the camera (C), which goes back to the capital.

// Kilometres across the screen at the scale of a region.
const REGION_KM = 2500;
const EARTH_KM = 6371;
const WAIT_MS = 500;

export class CampaignCameraController implements Controller {
  private done = false;

  constructor(
    private readonly eventBus: EventBus,
    private readonly game: GameView,
  ) {}

  init(): void {
    this.eventBus.on(CenterCameraEvent, () => this.toCapital());
    const wait = () => {
      if (this.done) return;
      if (this.game.inSpawnPhase() || this.game.myPlayer() === null) {
        window.setTimeout(wait, WAIT_MS);
        return;
      }
      this.done = true;
      this.toCapital();
    };
    window.setTimeout(wait, WAIT_MS);
  }

  private toCapital(): void {
    const config = this.game.config().gameConfig();
    const id = config.veritableScenario;
    // J7c: the player's nation of now (a last stand changes it).
    const nation =
      campaignController().playerNation() ?? config.veritablePlayerNation;
    if (id === undefined || nation === undefined) return;
    const scenario = dataSource.scenario(id);
    const capital = dataSource
      .cities(scenario)
      .find((c) => c.nation === nation && c.capital);
    if (capital === undefined) return;
    // Tiles per radian of the map: the size of a tile in kilometres.
    const kmPerTile = EARTH_KM / dataSource.georef(scenario.map).scale;
    const scale = window.innerWidth / (REGION_KM / kmPerTile);
    this.eventBus.emit(new GoToPositionEvent(capital.x, capital.y, scale));
  }
}
