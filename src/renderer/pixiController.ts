import { Application, Graphics, Container } from "pixi.js";
import { registerPixiCamera } from "./pixiCamera";
import { buildGridGraphic } from "./pixiGrid";
import { grid } from "./dataStore"; 

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
  container.setSize(containerWidth, containerHeight);
  container.pivot.set(containerWidth / 2, containerHeight / 2);
  container.position.set((app.screen.width / 2) - 192, app.screen.height / 2);

  app.stage.hitArea = app.screen;
  app.stage.eventMode = "static";
  container.eventMode = "static";

  app.stage.addChild(container);

  const containerBackground = new Graphics();
  containerBackground.rect(0, 0, containerWidth, containerHeight);
  containerBackground.fill(0x222222);
  containerBackground.stroke({ width: 2, color: 0x666666 });
  container.addChild(containerBackground);

  const gridGraphic = buildGridGraphic(grid);
  gridGraphic.stroke({color: 0x444444, pixelLine: true, width: 1});
  container.addChild(gridGraphic);

  container.scale.set(0.5);

  registerPixiCamera(app, container);
};