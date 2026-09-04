import { Container, Graphics } from "pixi.js";
import { Grid, grid } from "./dataStore";

export const buildGridGraphic = (gridToBuild: Grid, graphic: Graphics, localLineThickness: number): Graphics => {
  const gridWidth = gridToBuild.columns * gridToBuild.cellSize;
  const gridHeight = gridToBuild.rows * gridToBuild.cellSize;
  const lineOffset = localLineThickness / 2;

  for (let i = 1; i < gridToBuild.columns; i++) {
    graphic.rect((i * gridToBuild.cellSize) - lineOffset, 0, localLineThickness, gridHeight);
  }
  for (let i = 1; i < gridToBuild.rows; i++) {
    graphic.rect(0, (i * gridToBuild.cellSize) - lineOffset, gridWidth, localLineThickness);
  }

  return graphic;
};
export const getGridCordinate = (globalPositionX: number, globalPositionY: number, container: Container): { x: number | undefined; y: number | undefined; } => {
  const cordinate: { x: number | undefined; y: number | undefined; } = { x: undefined, y: undefined };

  const worldPoint = { x: globalPositionX, y: globalPositionY };
  const localContainerPosition = container.toLocal(worldPoint);

  if (localContainerPosition.x < 0 || localContainerPosition.y < 0 || localContainerPosition.x > grid.cellSize * grid.columns || localContainerPosition.y > grid.cellSize * grid.rows) {
    return cordinate;
  }

  for (let x = 1; x <= grid.columns; x++) {
    for (let y = 1; y <= grid.rows; y++) {
      const cellPositionAreaXMax = x * grid.cellSize;
      const cellPositionAreaYMax = y * grid.cellSize;
      const cellPositionAreaXMin = cellPositionAreaXMax - grid.cellSize;
      const cellPositionAreaYMin = cellPositionAreaYMax - grid.cellSize;

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
};
export const getGridCordinateLocalPoint = (cordinateX: number, cordinateY: number): { x: number | undefined; y: number | undefined; } => {
  const cordinate: { x: number | undefined; y: number | undefined; } = { x: undefined, y: undefined };

  if (cordinateX < 0 || cordinateY < 0 || cordinateX > grid.columns || cordinateY > grid.rows) {
    return cordinate;
  }

  cordinate.x = (cordinateX * grid.cellSize) - grid.cellSize;
  cordinate.y = (cordinateY * grid.cellSize) - grid.cellSize;

  return cordinate;
};
