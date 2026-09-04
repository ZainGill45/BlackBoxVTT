import { Application, Container, FederatedWheelEvent } from "pixi.js";

let panningActive = false;
let previousPointerX = 0;
let previousPointerY = 0;

export const registerPixiCamera = (app: Application, container: Container, handleScaleChanged: (scale: number) => void) => {
  app.stage.on("mousedown", (event) => {
    if (event.button === 1) {
      panningActive = true;
      previousPointerX = event.global.x;
      previousPointerY = event.global.y;
      app.stage.cursor = "grab";
      container.cursor = "grab";
    }
  });

  app.stage.on("mouseup", (event) => {
    if (event.button === 1) {
      panningActive = false;
      app.stage.cursor = "default";
      container.cursor = "default";
    }
  });

  app.stage.on("mousemove", (event) => {
    if (panningActive) {
      const currentPanDeltaX = previousPointerX - event.global.x;
      const currentPanDeltaY = previousPointerY - event.global.y;

      container.position.set(container.position.x - currentPanDeltaX, container.position.y - currentPanDeltaY);

      previousPointerX = event.global.x;
      previousPointerY = event.global.y;
    }
  });

  container.on("wheel", (event: FederatedWheelEvent) => {
    event.preventDefault();

    const mouseLocalPos = container.toLocal(event.global);
    const zoomFactor = 0.1;
    const minScale = 0.2;
    const maxScale = 2.5;

    if (event.deltaY === 0) {
      return;
    }

    const zoomMultiplier = event.deltaY > 0 ? 1 / (1 + zoomFactor) : 1 + zoomFactor;
    const newScale = Math.min(maxScale, Math.max(minScale, container.scale.x * zoomMultiplier));

    container.scale.set(newScale);

    const newMouseGlobalPos = container.toGlobal(mouseLocalPos);
    container.x += event.global.x - newMouseGlobalPos.x;
    container.y += event.global.y - newMouseGlobalPos.y;

    handleScaleChanged(newScale);
  });
};
