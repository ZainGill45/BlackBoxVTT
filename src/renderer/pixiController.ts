import { Application, Graphics, Container } from "pixi.js";
import { grid, rightSidebarWidth } from "./dataStore"; 
import { registerPixiCamera } from "./pixiCamera";
import { buildGridGraphic } from "./pixiGrid";

import "pixi.js/unsafe-eval";

export const initializePixi = async () => {
  const canvas = document.getElementById("pixi-canvas");
  const app = new Application();

  if (!canvas) {
    throw new Error("Canvas element not found");
  }

  await app.init({
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
    webgpu: {
      powerPreference: "high-performance",
      antialias: true,
    },
  });

  canvas.appendChild(app.canvas);

  const containerWidth = grid.columns * grid.cellSize;
  const containerHeight = grid.rows * grid.cellSize;

  const container = new Container();
  container.sortableChildren = true;
  container.setSize(containerWidth, containerHeight);
  container.pivot.set(containerWidth / 2, containerHeight / 2);
  container.position.set((app.screen.width / 2) - (rightSidebarWidth / 2), app.screen.height / 2);

  app.stage.hitArea = app.screen;
  app.stage.eventMode = "static";
  container.eventMode = "static";

  app.stage.addChild(container);

  const backgroundGraphic = new Graphics();
  backgroundGraphic.rect(0, 0, containerWidth, containerHeight);
  backgroundGraphic.fill(0x262626);
  backgroundGraphic.zIndex = 0;
  container.addChild(backgroundGraphic);

  const crossHatchGraphic = new Graphics();
  crossHatchGraphic.setSize(containerWidth, containerHeight);

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

  crossHatchGraphic.stroke({ width: 2, pixelLine: true, color: 0x303030, alpha: 0.5 });
  crossHatchGraphic.zIndex = 1;
  container.addChild(crossHatchGraphic);

  const gridGraphic = buildGridGraphic(grid);
  gridGraphic.stroke({pixelLine: true, width: 1, color: 0x404040});
  gridGraphic.zIndex = 2;
  container.addChild(gridGraphic);

  const borderGraphic = new Graphics();
  borderGraphic.rect(0, 0, containerWidth, containerHeight);
  borderGraphic.stroke({ width: 1, pixelLine: true, color: 0x737373 });
  borderGraphic.zIndex = 4;
  container.addChild(borderGraphic);

  container.scale.set(0.5);

  registerPixiCamera(app, container);
};