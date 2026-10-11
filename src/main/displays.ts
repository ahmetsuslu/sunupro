import { screen, type Display } from 'electron'

/** Seyirci (projeksiyon) ekranı: tercih edilen varsa o, yoksa birincil olmayan ilk ekran. */
export function pickAudienceDisplay(preferredId?: number | null): Display {
  const all = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  if (preferredId != null) {
    const d = all.find((x) => x.id === preferredId)
    if (d) return d
  }
  return all.find((x) => x.id !== primary.id) ?? primary
}

/** Sunucu ekranı: seyirci ekranı dışındaki ekran (tek ekranda aynı ekran). */
export function pickPresenterDisplay(audience: Display): Display {
  const primary = screen.getPrimaryDisplay()
  if (primary.id !== audience.id) return primary
  return screen.getAllDisplays().find((x) => x.id !== audience.id) ?? primary
}

/**
 * Ekranın merkezini fiziksel piksel koordinatına çevirir. PowerPoint gösteri penceresi
 * pptctl tarafından bu noktayı içeren ekrana oturtulur (farklı ölçekli ekranlarda DIP
 * koordinatları doğrudan kullanılamaz).
 */
export function physicalCenter(d: Display): { x: number; y: number } {
  const c = {
    x: Math.round(d.bounds.x + d.bounds.width / 2),
    y: Math.round(d.bounds.y + d.bounds.height / 2)
  }
  return screen.dipToScreenPoint(c)
}
