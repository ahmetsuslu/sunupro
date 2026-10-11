export type Rect = { x: number; y: number; width: number; height: number }

/** (w × h) alanına en-boy oranı korunarak sığdırılmış, ortalanmış dikdörtgen (PowerPoint'in letterbox'ı). */
export function containRect(w: number, h: number, aspect: number): Rect {
  if (w / h > aspect) {
    const width = h * aspect
    return { x: (w - width) / 2, y: 0, width, height: h }
  }
  const height = w / aspect
  return { x: 0, y: (h - height) / 2, width: w, height }
}
