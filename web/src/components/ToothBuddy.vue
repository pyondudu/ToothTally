<script setup>
// 牙齒吉祥物（16×16 像素，inline SVG）
//   size：顯示尺寸（px）。登入頁約 96、標題列約 28
//   mood：'idle' 一般眨眼浮動／'happy' 已超過門檻，跳躍＋閃光／'done' 當月已結算，滿足表情＋勾勾
//   celebrate(text)：跳一下並顯示短訊息（例如登記成功時），以 ref 呼叫
import { computed, ref } from 'vue'
import { toRects, PALETTE } from './toothSprite.js'

const props = defineProps({
  size: { type: Number, default: 28 },
  mood: { type: String, default: 'idle' },
})

const rects = toRects()
const pick = (...chs) => rects.filter((r) => chs.includes(r.ch))
const body = pick('O', 'W', 'S', 'C', 'M')
const eyes = pick('E')

// 結算後：笑瞇眼（^ ^），先用牙齒本體色蓋掉原本眼睛的位置
const eyesDone = [
  ...eyes.map((r) => ({ ...r, fill: PALETTE.W })),
  { x: 4, y: 6, w: 1, fill: PALETTE.E }, { x: 5, y: 5, w: 1, fill: PALETTE.E }, { x: 6, y: 6, w: 1, fill: PALETTE.E },
  { x: 9, y: 6, w: 1, fill: PALETTE.E }, { x: 10, y: 5, w: 1, fill: PALETTE.E }, { x: 11, y: 6, w: 1, fill: PALETTE.E },
]
// 超過門檻：周圍小閃光
const SPARK = '#f6c45b'
const twinkles = [
  { x: 1, y: 2, w: 1, fill: SPARK },
  { x: 15, y: 4, w: 1, fill: SPARK },
  { x: 13, y: 1, w: 1, fill: SPARK },
]
// 結算後：右上角勾勾
const check = [
  { x: 12, y: 2, w: 1 }, { x: 13, y: 3, w: 1 }, { x: 14, y: 2, w: 1 }, { x: 15, y: 1, w: 1 },
]

const hopping = ref(false)
const bubble = ref('')
let timer
function celebrate(text = '登記完成！') {
  clearTimeout(timer)
  hopping.value = false
  bubble.value = text
  requestAnimationFrame(() => { hopping.value = true })
  timer = setTimeout(() => { hopping.value = false; bubble.value = '' }, 2200)
}
defineExpose({ celebrate })

const classes = computed(() => ['buddy', `mood-${props.mood}`, { hopping: hopping.value }])
</script>

<template>
  <span :class="classes" :style="{ width: size + 'px', height: size + 'px' }">
    <span v-if="bubble" class="bubble" role="status">{{ bubble }}</span>
    <svg viewBox="0 0 16 16" :width="size" :height="size" shape-rendering="crispEdges" aria-hidden="true">
      <ellipse class="shadow" cx="8" cy="15.3" rx="4.6" ry="0.6" shape-rendering="auto" />
      <g class="bob">
        <rect v-for="(r, i) in body" :key="'b' + i" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" />
        <g v-if="mood === 'done'">
          <rect v-for="(r, i) in eyesDone" :key="'d' + i" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" />
        </g>
        <g v-else class="eyes">
          <rect v-for="(r, i) in eyes" :key="'e' + i" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" />
        </g>
      </g>
      <g v-if="mood === 'happy'" class="twinkles">
        <rect v-for="(r, i) in twinkles" :key="'t' + i" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" />
      </g>
      <g v-if="mood === 'done'" class="check" fill="#2f9e6e">
        <rect v-for="(r, i) in check" :key="'c' + i" :x="r.x" :y="r.y" :width="r.w" height="1" />
      </g>
    </svg>
  </span>
</template>

<style scoped>
.buddy { position: relative; display: inline-block; flex: none; line-height: 0; }
svg { display: block; overflow: visible; }

.shadow { fill: currentColor; opacity: 0.14; transform-origin: 8px 15.3px; animation: shadow 2.4s ease-in-out infinite; }
.bob { animation: bob 2.4s ease-in-out infinite; }
.eyes { transform-origin: 0 5.5px; animation: blink 4.2s infinite; }

/* 超過門檻：連續小跳＋閃光 */
.mood-happy .bob { animation: jump 0.9s ease-in-out infinite; }
.mood-happy .shadow { animation: shadow-jump 0.9s ease-in-out infinite; }
.twinkles rect { animation: twinkle 1.2s steps(2, jump-none) infinite; }
.twinkles rect:nth-child(2) { animation-delay: 0.4s; }
.twinkles rect:nth-child(3) { animation-delay: 0.8s; }

/* 已結算：慢慢浮動 */
.mood-done .bob { animation-duration: 3.6s; }

/* 登記成功：跳一下 */
.hopping .bob { animation: hop 0.6s ease-out 2; }

.bubble {
  position: absolute; bottom: 100%; left: 50%; transform: translate(-50%, -4px);
  white-space: nowrap; line-height: 1.4; font-size: 13px; font-weight: 600;
  padding: 4px 10px; border-radius: 10px;
  background: var(--surface, #fff); color: var(--fg, #1d2423);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
  animation: pop 0.25s ease-out;
}

@keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-0.6px); } }
@keyframes shadow { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(0.85); } }
@keyframes blink { 0%, 94%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
@keyframes jump { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-2px); } 60% { transform: translateY(-2px); } }
@keyframes shadow-jump { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(0.65); } }
@keyframes twinkle { 0% { opacity: 1; } 100% { opacity: 0; } }
@keyframes hop { 0% { transform: translateY(0); } 40% { transform: translateY(-3px); } 100% { transform: translateY(0); } }
@keyframes pop { from { opacity: 0; transform: translate(-50%, 2px); } }

@media (prefers-reduced-motion: reduce) {
  .shadow, .bob, .eyes, .twinkles rect, .bubble { animation: none !important; }
}
</style>
