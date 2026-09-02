<script setup lang="ts">
import { Application, Graphics, Container, FederatedWheelEvent } from 'pixi.js';
import { onMounted, onUnmounted, useTemplateRef } from 'vue';
import 'pixi.js/unsafe-eval';

const canvas = useTemplateRef<HTMLDivElement>('canvas');
const gridCellSize = 70;
const gridColumns = 25;
const gridRows = 25;

let app: Application | null = null;
let panningActive = false;
let previousPointerX = 0;
let previousPointerY = 0;

const buildGrid = (sizeX: number, sizeY: number, cellSize: number, columns: number, rows: number): Graphics => {
  const grid = new Graphics();

  grid.setSize(sizeX, sizeY);

  for (let i = 1; i < columns; i++) {
    grid.moveTo(i * cellSize, 0).lineTo(i * cellSize, sizeY - 2);
  }

  for (let i = 1; i < rows; i++) {
    grid.moveTo(0, i * cellSize).lineTo(sizeX - 2, i * cellSize);
  }

  grid.stroke({
    color: 0x444444,
    pixelLine: true,
    width: 1,
  });

  return grid;
}
const getGridCordinate = (globalPositionX: number, globalPositionY: number, container: Container): { x: number | undefined, y: number | undefined } => {
  const cordinate: { x: number | undefined, y: number | undefined } = { x: undefined, y: undefined };

  const worldPoint = { x: globalPositionX, y: globalPositionY }
  const localContainerPosition = container.toLocal(worldPoint)

  if (localContainerPosition.x < 0
    || localContainerPosition.y < 0
    || localContainerPosition.x > gridCellSize * gridColumns
    || localContainerPosition.y > gridCellSize * gridRows) {
    return cordinate;
  }

  for (let x = 1; x <= gridColumns; x++) {
    for (let y = 1; y <= gridRows; y++) {
      const cellPositionAreaXMax = x * gridCellSize;
      const cellPositionAreaYMax = y * gridCellSize;
      const cellPositionAreaXMin = cellPositionAreaXMax - gridCellSize;
      const cellPositionAreaYMin = cellPositionAreaYMax - gridCellSize;

      if (localContainerPosition.x >= cellPositionAreaXMin && localContainerPosition.x <= cellPositionAreaXMax) {
        cordinate.x = x;
      }
      if (localContainerPosition.y >= cellPositionAreaYMin && localContainerPosition.y <= cellPositionAreaYMax) {
        cordinate.y = y;
      }

      if (cordinate.x !== undefined && cordinate.y !== undefined) {
        return cordinate;
      }
    }
  }

  return cordinate;
}
const getGridCordinateLocalPoint = (cordinateX: number, cordinateY: number): { x: number | undefined, y: number | undefined } => {
  const cordinate: { x: number | undefined, y: number | undefined } = { x: undefined, y: undefined };

  if (cordinateX < 0
      || cordinateY < 0
      || cordinateX > gridColumns
      || cordinateY > gridRows) {
    return cordinate;
  }

  cordinate.x = (cordinateX * gridCellSize) - (gridCellSize);
  cordinate.y = (cordinateY * gridCellSize) - (gridCellSize);

  return cordinate;
}

onMounted(async () => {
  if (!canvas.value)
    return;

  app = new Application();

  await app.init({
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true
  });

  canvas.value.appendChild(app.canvas);

  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;

  const containerWidth = gridColumns * gridCellSize;
  const containerHeight = gridRows * gridCellSize;

  const container = new Container();
  container.setSize(containerWidth, containerHeight);
  container.pivot.set(containerWidth / 2, containerHeight / 2);
  container.position.set(app.screen.width / 2, app.screen.height / 2);
  container.eventMode = 'static';

  app.stage.addChild(container);

  const containerBackground = new Graphics();
  containerBackground.rect(0, 0, containerWidth, containerHeight);
  containerBackground.fill(0x222222);
  containerBackground.stroke({ width: 2, color: 0x666666 });
  container.addChild(containerBackground);

  container.addChild(buildGrid(container.width, container.height, gridCellSize, gridColumns, gridRows));

  container.scale.set(0.5);

  app.stage.on('mousedown', (event) => {
    if (event.button === 0) {
      const gridCordinate = getGridCordinate(event.globalX, event.globalY, container);
      const gridCordCenterPoint = getGridCordinateLocalPoint(gridCordinate.x!, gridCordinate.y!);

      if (gridCordCenterPoint.x === undefined || gridCordCenterPoint.y === undefined)
        return;

      const gridTile = new Graphics();
      gridTile.rect(gridCordCenterPoint.x!, gridCordCenterPoint.y!, gridCellSize, gridCellSize);
      gridTile.fill(0xffffff);

      gridTile.onRender = () => {
        gridTile.alpha -= 0.01;
        if (gridTile.alpha < 0) {
          gridTile.destroy();
        }
      };

      container.addChild(gridTile);
    }

    if (event.button === 1) {
      panningActive = true;
      previousPointerX = event.global.x;
      previousPointerY = event.global.y;
      app!.stage.cursor = 'grab';
      container.cursor = 'grab';
    }
  });
  app.stage.on('mouseup', (event) => {
    if (event.button === 1) {
      panningActive = false;
      app!.stage.cursor = 'default';
      container.cursor = 'default';
    }
  });
  app.stage.on('mousemove', (event) => {
    if (panningActive) {
      const currentPanDeltaX = previousPointerX - event.global.x;
      const currentPanDeltaY = previousPointerY - event.global.y;

      container.position.set(container.position.x - currentPanDeltaX, container.position.y - currentPanDeltaY);

      previousPointerX = event.global.x;
      previousPointerY = event.global.y;
    }
  });

  container.on('wheel', (event: FederatedWheelEvent) => {
    event.preventDefault();

    const mouseLocalPos = container.toLocal(event.global);
    const currentScaleX = container.scale.x;
    const currentScaleY = container.scale.y;

    const zoomFactor = 0.1;
    const minScale = 0.1;
    const maxScale = 1.5;

    let zoomDelta = 0;

    if (event.deltaY > 0) {
      zoomDelta = 1 - zoomFactor;
    } else if (event.deltaY < 0) {
      zoomDelta = 1 + zoomFactor;
    }

    let newScaleX = currentScaleX * zoomDelta;
    let newScaleY = currentScaleY * zoomDelta;

    if (newScaleX < minScale) {
      newScaleX = minScale;
      newScaleY = minScale;
      zoomDelta = minScale / container.scale.x;
    }
    if (newScaleX > maxScale) {
      newScaleX = maxScale;
      newScaleY = maxScale;
      zoomDelta = maxScale / container.scale.x;
    }

    container.scale.set(newScaleX, newScaleY);

    const newMouseGlobalPos = container.toGlobal(mouseLocalPos);
    container.x += event.global.x - newMouseGlobalPos.x;
    container.y += event.global.y - newMouseGlobalPos.y;
  });
});
onUnmounted(() => {
  if (app) {
    app.destroy(true, { children: true, texture: true });
    app = null;
  }
});
</script>

<template>
  <div ref="canvas" class="w-full h-full overflow-hidden"></div>
</template>