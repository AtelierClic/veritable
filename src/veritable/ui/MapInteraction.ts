import { Controller } from "../../client/Controller";
import { ContextMenuEvent, MouseUpEvent } from "../../client/InputHandler";
import { TransformHandler } from "../../client/TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../client/Transport";
import { UIState } from "../../client/UIState";
import { GameView } from "../../client/view/GameView";
import { EventBus } from "../../core/EventBus";
import { UnitType } from "../../core/game/Game";
import { NationId } from "../data/schemas/common";
import { actionMenu } from "./ActionMenu";
import { campaignController } from "./CampaignController";
import type { FrontOverlayController } from "./FrontOverlay";
import { Buildable, MENU_STRUCTURES, menuContent } from "./mapMenu";
import { nationCard } from "./NationCard";
import { veritableScreens } from "./VeritableScreens";
import { veritableTopBar } from "./VeritableTopBar";

// The map as an interface (J7b), for the campaign only:
// - a right click on a nation opens its card near the cursor (the game goes
//   on); a click elsewhere or Escape closes it;
// - a left click opens, where it lands, the action menu of what lies there
//   (ui/mapMenu.ts): at most CLICK_PX pixels and CLICK_MS milliseconds
//   between press and release, beyond it is the camera that moves. A click
//   that closes a menu or a card opens nothing; a click on a marker of the
//   journal opens its entry; a click near a front also shows the factors of
//   its segment.
// The worker says what lies under the point (the owner of the tile is a
// nation of the simulation, not a player of the core the client knows).

const CLICK_PX = 6;
const CLICK_MS = 250;
const MAP_INPUT_ID = "game-input-overlay";

export class MapInteractionController implements Controller {
  private press: {
    t: number;
    x: number;
    y: number;
    onMap: boolean;
    closing: boolean;
  } | null = null;

  constructor(
    private readonly eventBus: EventBus,
    private readonly transform: TransformHandler,
    private readonly game: GameView,
    private readonly overlay: FrontOverlayController,
    private readonly uiState: UIState,
  ) {}

  init(): void {
    const card = nationCard();
    card.onDiplomacy = (nation) => this.openDiplomacy(nation);
    card.onActions = (nation, x, y) => void this.openMenuFor(nation, x, y);
    // Registered before the menu and the card add theirs (when they open):
    // this one sees whether the press closes one of them.
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0) return;
        this.press = {
          t: performance.now(),
          x: e.clientX,
          y: e.clientY,
          // The element the input handler of the map listens on.
          onMap: (e.target as Element | null)?.id === MAP_INPUT_ID,
          closing: actionMenu().isOpen() || nationCard().isOpen(),
        };
      },
      true,
    );
    this.eventBus.on(ContextMenuEvent, (e) => void this.onRightClick(e.x, e.y));
    this.eventBus.on(MouseUpEvent, (e) => void this.onLeftClick(e.x, e.y));
  }

  // The tile under a point of the screen, null off the map.
  tileAt(x: number, y: number): number | null {
    const cell = this.transform.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return null;
    return this.game.ref(cell.x, cell.y);
  }

  private openDiplomacy(nation: NationId): void {
    const screens = veritableScreens();
    screens.openDiplomacy(nation);
    veritableTopBar().setActiveScreen(screens.current());
  }

  private async onRightClick(x: number, y: number): Promise<void> {
    actionMenu().close();
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

  private isClick(x: number, y: number): boolean {
    const p = this.press;
    this.press = null;
    return (
      p !== null &&
      p.onMap &&
      !p.closing &&
      performance.now() - p.t <= CLICK_MS &&
      Math.hypot(x - p.x, y - p.y) <= CLICK_PX
    );
  }

  private async onLeftClick(x: number, y: number): Promise<void> {
    if (!this.isClick(x, y)) return;
    // The legacy build bar places a structure with this click.
    if (this.uiState.ghostStructure !== null) return;
    if (this.overlay.handleClick(x, y)) return;
    const tile = this.tileAt(x, y);
    if (tile === null) return;
    await this.openMenu(tile, x, y, true);
  }

  // From the card of a nation: the menu of the tile under the card's point
  // when it is that nation's, else of the nation without a point.
  private async openMenuFor(
    nation: NationId,
    x: number,
    y: number,
  ): Promise<void> {
    const sim = campaignController().remote();
    const tile = this.tileAt(x, y);
    if (sim === null) return;
    if (tile !== null) {
      const info = await sim.tileInfo(tile);
      if (info.owner === nation) {
        await this.openMenu(tile, x, y, true);
        return;
      }
    }
    await this.openMenu(null, x, y, false, nation);
  }

  private async openMenu(
    tile: number | null,
    x: number,
    y: number,
    atPoint: boolean,
    nation?: NationId,
  ): Promise<void> {
    const sim = campaignController().remote();
    if (sim === null) return;
    const info =
      tile === null
        ? {
            tile: -1,
            land: true,
            owner: nation ?? null,
            contested: false,
            zone: null,
          }
        : await sim.tileInfo(tile);
    const player = campaignController().playerNation();
    const view = await sim.readIfChanged(
      undefined,
      [player, info.owner].filter((n): n is string => n !== null),
    );
    if (view === null) return;
    const width = this.game.width();
    const content = await menuContent({
      view,
      info,
      x: atPoint && tile !== null ? tile % width : null,
      y: atPoint && tile !== null ? Math.floor(tile / width) : null,
      overlay: this.overlay.overlayData(),
      sim,
      apply: (command) => sim.apply(command),
      buildables: () => this.buildables(tile),
      build: (b) => this.build(b, tile),
      durations: this.durations(),
      openCard: (n) => void nationCard().open(n, x, y),
      openDiplomacy: (n) => this.openDiplomacy(n),
    });
    actionMenu().open(x, y, content.title, content.entries, content.subtitle);
  }

  private durations(): Map<UnitType, number> {
    const config = this.game.config();
    return new Map(
      MENU_STRUCTURES.map((type) => [
        type,
        config.unitInfo(type).constructionDuration ?? 0,
      ]),
    );
  }

  // J7c: after a last stand the player's nation is not the core's human
  // player any more: the worker builds for it.
  private handedOver(): boolean {
    const config = this.game.config().gameConfig();
    const nation = campaignController().playerNation();
    return nation !== null && nation !== config.veritablePlayerNation;
  }

  private async buildables(tile: number | null): Promise<Buildable[]> {
    if (tile !== null && this.handedOver()) {
      const remote = campaignController().remote();
      if (remote === null) return [];
      const config = this.game.config();
      const types = MENU_STRUCTURES.filter((t) => !config.isUnitDisabled(t));
      const options = await remote.buildOptions(tile, [...types]);
      return types.map((type) => ({
        type,
        canBuild:
          options.find((o) => o.type === type)?.canBuild === true
            ? tile
            : false,
        canUpgrade: false,
      }));
    }
    const me = this.game.myPlayer();
    if (me === null || tile === null) return [];
    const units = await me.buildables(tile, [...MENU_STRUCTURES]);
    const config = this.game.config();
    return MENU_STRUCTURES.filter((type) => !config.isUnitDisabled(type)).map(
      (type) => {
        const unit = units.find((u) => u.type === type);
        return {
          type,
          canBuild: unit?.canBuild ?? false,
          canUpgrade: unit?.canUpgrade ?? false,
        };
      },
    );
  }

  // The orders of the core, as its build menu gives them.
  private build(b: Buildable, tile: number | null): void {
    if (this.handedOver()) {
      if (b.canBuild !== false && tile !== null) {
        void campaignController().remote()?.build(b.type, tile);
      }
      return;
    }
    if (b.canUpgrade !== false) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(b.canUpgrade, b.type),
      );
    } else if (b.canBuild !== false && tile !== null) {
      this.eventBus.emit(new BuildUnitIntentEvent(b.type, tile));
    }
  }
}
