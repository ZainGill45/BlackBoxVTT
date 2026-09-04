import { Application, Graphics, Container } from "pixi.js";
import { grid, rightSidebarWidth } from "./dataStore";
import { registerPixiCamera } from "./pixiCamera";
import { buildGridGraphic } from "./pixiGrid";
import { log } from "./logger";

import "pixi.js/unsafe-eval";

let app: Application | null = null;
let container: Container | null = null;
let canvas: HTMLElement | null = null;
let gridGraphic: Graphics | null = null;
let borderGraphic: Graphics | null = null;

const containerWidth = grid.columns * grid.cellSize;
const containerHeight = grid.rows * grid.cellSize;
const gridLineThicknessInScreenPixels = 1;
const borderLineThicknessInScreenPixels = 1;

export const initializePixi = async () => {
  canvas = document.getElementById("pixi-canvas");
  app = new Application();

  if (!canvas) {
    throw new Error("Canvas element not found");
  }

  await app.init({
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio,
    preference: "webgpu",
    webgpu: {
      powerPreference: "high-performance",
      antialias: true,
    },
  });

  canvas.appendChild(app.canvas);

  container = new Container();
  container.sortableChildren = true;
  container.setSize(containerWidth, containerHeight);
  container.pivot.set(containerWidth / 2, containerHeight / 2);
  container.position.set((app.screen.width / 2) - (rightSidebarWidth / 2), app.screen.height / 2);

  app.stage.hitArea = app.screen;
  app.stage.eventMode = "static";
  container.eventMode = "static";

  app.stage.addChild(container);

  container.scale.set(0.5);

  buildStaticSceneBase();
  redrawScaleDependentSceneBase(container.scale.x);
  registerPixiCamera(app, container, redrawScaleDependentSceneBase);
};

const buildStaticSceneBase = () => {
  if (!container) {
    log("Container is null in buildStaticSceneBase", "error");
    return;
  }

  const backgroundGraphic = new Graphics();
  backgroundGraphic.rect(0, 0, containerWidth, containerHeight);
  backgroundGraphic.fill(0x262626);
  backgroundGraphic.zIndex = 0;
  container.addChild(backgroundGraphic);

  const crossHatchGraphic = new Graphics();
  const density = 4;
  const step = grid.cellSize / density;

  for (let x = 0; x < grid.columns; x++) {
    for (let y = 0; y < grid.rows; y++) {
      const cellX = x * grid.cellSize;
      const cellY = y * grid.cellSize;

      for (let i = 0; i < density; i++) {
        for (let j = 0; j < density; j++) {
          const subX = cellX + i * step;
          const subY = cellY + j * step;

          crossHatchGraphic.moveTo(subX, subY);
          crossHatchGraphic.lineTo(subX + step, subY + step);

          crossHatchGraphic.moveTo(subX + step, subY);
          crossHatchGraphic.lineTo(subX, subY + step);
        }
      }
    }
  }

  crossHatchGraphic.stroke({ width: 2, color: 0x303030, alpha: 0.5 });
  crossHatchGraphic.zIndex = 1;
  container.addChild(crossHatchGraphic);

  gridGraphic = new Graphics();
  gridGraphic.zIndex = 2;
  container.addChild(gridGraphic);

  borderGraphic = new Graphics();
  borderGraphic.zIndex = 4;
  container.addChild(borderGraphic);
};

const redrawScaleDependentSceneBase = (cameraScale: number) => {
  if (!gridGraphic || !borderGraphic) {
    log("Scene base graphics are not initialized in redrawScaleDependentSceneBase", "error");
    return;
  }

  if (!Number.isFinite(cameraScale) || cameraScale <= 0) {
    log(`Invalid camera scale ${cameraScale} in redrawScaleDependentSceneBase`, "error");
    return;
  }

  const gridLineThicknessInLocalCoordinates = gridLineThicknessInScreenPixels / cameraScale;
  const borderLineThicknessInLocalCoordinates = borderLineThicknessInScreenPixels / cameraScale;

  gridGraphic.clear();
  buildGridGraphic(grid, gridGraphic, gridLineThicknessInLocalCoordinates);
  gridGraphic.fill(0x404040);

  borderGraphic.clear();
  borderGraphic.rect(0, 0, containerWidth, containerHeight);
  borderGraphic.stroke({ width: borderLineThicknessInLocalCoordinates, color: 0x737373 });
};
