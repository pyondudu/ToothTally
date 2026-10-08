// 牙齒角色 16×16 像素圖（app 圖示與 ToothBuddy.vue 共用，改造型只改這裡）
// O 描邊、W 牙齒本體、S 陰影、E 眼睛、C 腮紅、M 嘴巴
export const MAP = [
  '................',
  '................',
  '...OOO....OOO...',
  '..OWWWO..OWWWO..',
  '.OWWWWWOOWWWWWO.',
  '.OWWWEWWWWEWWWO.',
  '.OWWWEWWWWEWWWO.',
  '.OWWCWWWWWWCWSO.',
  '.OWWWWMWWMWWWSO.',
  '..OWWWWMMWWWSO..',
  '..OWWWWWWWWWSO..',
  '..OWWWOOOOWWSO..',
  '..OWWO....OWSO..',
  '..OWWO....OWSO..',
  '...OO......OO...',
]

export const PALETTE = {
  O: '#2b2a27', W: '#fffaf0', S: '#e3dccb',
  E: '#2b2a27', C: '#f7b6a0', M: '#2b2a27',
}

// 主題色（薄荷綠）
export const THEME_COLOR = '#3dbfa8'

// 把像素圖轉成水平合併的矩形：[{ ch, x, y, w, fill }]
export function toRects(map = MAP, palette = PALETTE) {
  const out = []
  map.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const ch = row[x]
      if (ch === '.') { x++; continue }
      let w = 1
      while (row[x + w] === ch) w++
      out.push({ ch, x, y, w, fill: palette[ch] })
      x += w
    }
  })
  return out
}

export const rectSvg = (r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1" fill="${r.fill}"/>`
