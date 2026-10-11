import { getStroke, type StrokeOptions } from 'perfect-freehand'

/** [x, y, basınç] — basınç 0..1 çizgi kalınlığını belirler */
export type StrokePoint = [number, number, number]

/**
 * Noktalardan tek parça, kenarları pürüzsüz bir çizgi şekli üretir ve tek seferde doldurur.
 * Her parçayı ayrı çizmek yarı saydam renklerde birleşim yerlerinde koyu "boncuklar" bırakır;
 * tek dolgu bu sorunu ortadan kaldırır.
 */
export function fillStroke(ctx: CanvasRenderingContext2D, points: StrokePoint[], options: StrokeOptions): void {
  const outline = getStroke(points, options)
  if (outline.length < 3) return
  ctx.beginPath()
  ctx.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % outline.length]
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  ctx.closePath()
  ctx.fill()
}
