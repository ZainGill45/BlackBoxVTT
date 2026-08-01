import {
  SCENE_TEXT_TEXTURE_RESOLUTION,
} from './sceneConstants';

interface SceneTextMetricInput {
  content: string;
  style: {
    fontSize: number;
    strokeWidth: number;
  };
}

export interface EstimatedSceneTextRaster {
  height: number;
  pixels: number;
  width: number;
}

// These deliberately overestimate the bundled faces, including the widest
// deterministic fallback glyphs, without multiplying every character by 2em.
const MAX_GLYPH_ADVANCE_EM = 1.25;
const MAX_LINE_HEIGHT_EM = 1.5;
const TEXT_TEXTURE_PADDING = 2;

/** Estimates the physical Pixi canvas/texture allocation for safety checks. */
export function estimateSceneTextRaster(
  text: SceneTextMetricInput,
): EstimatedSceneTextRaster {
  const lines = text.content.split('\n');
  const longestLine = Math.max(
    1,
    ...lines.map((line) => [...line].length),
  );
  const padding = (text.style.strokeWidth + TEXT_TEXTURE_PADDING) * 2;
  const width = Math.ceil(
    (longestLine * text.style.fontSize * MAX_GLYPH_ADVANCE_EM + padding) *
      SCENE_TEXT_TEXTURE_RESOLUTION,
  );
  const height = Math.ceil(
    (lines.length * text.style.fontSize * MAX_LINE_HEIGHT_EM + padding) *
      SCENE_TEXT_TEXTURE_RESOLUTION,
  );
  return { height, pixels: width * height, width };
}
