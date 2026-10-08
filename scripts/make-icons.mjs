// 產生 app 圖示：npm run icons
//   web/public/icon.svg        瀏覽器分頁（圓角）
//   web/public/icon-192.png    manifest
//   web/public/icon-512.png    manifest、apple-touch-icon
// PNG 為滿版方形：圓角由手機系統裁切（iPhone 遇到透明角會補黑邊），角色四周留約 20% 供 Android 圓形遮罩
import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'
import path from 'node:path'
import { toRects, rectSvg, THEME_COLOR } from '../web/src/components/toothSprite.js'

const pub = path.resolve(import.meta.dirname, '../web/public')
const sprite = toRects().map(rectSvg).join('')
// 16 格角色（實際內容在第 2～14 列，往上移半格置中）放在 26 格畫布中央（四周約 19%）
const icon = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 26 26" shape-rendering="crispEdges">
<rect x="-5" y="-5" width="26" height="26"${rounded ? ' rx="5.5"' : ''} fill="${THEME_COLOR}"/>
<g transform="translate(0 -0.5)">${sprite}</g>
</svg>
`

fs.mkdirSync(pub, { recursive: true })
fs.writeFileSync(path.join(pub, 'icon.svg'), icon(true))
console.log('wrote web/public/icon.svg')
for (const size of [192, 512]) {
  const png = new Resvg(icon(false), { fitTo: { mode: 'width', value: size } }).render().asPng()
  fs.writeFileSync(path.join(pub, `icon-${size}.png`), png)
  console.log(`wrote web/public/icon-${size}.png`)
}
