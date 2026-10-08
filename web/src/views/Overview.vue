<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { store, RECORD_SELECT } from '../lib/store'
import { exportMonth } from '../lib/exportExcel'
import { addMonths, fmtMonth, fmtMoney, fmtPct, fromMonthParam, monthParam, thisMonth } from '../lib/util'
import ToothBuddy from '../components/ToothBuddy.vue'

const route = useRoute()
const router = useRouter()
const month = computed(() => fromMonthParam(route.query.m) ?? thisMonth())
const go = (n) => router.replace({ query: { m: monthParam(addMonths(month.value, n)) } })

const totals = ref([])     // monthly_clinic_totals
const bonus = ref(null)    // calc_bonus 結果
const closing = ref(null)  // month_closings
// 尚未送回：依「登記月份」分組（還沒有送回日，無法歸到營業額月份）
const pending = ref([])  // [{ month: 10, year: 2026, count }]
const pendingCount = computed(() => pending.value.reduce((s, p) => s + p.count, 0))
const loading = ref(false)
const err = ref('')

async function load() {
  loading.value = true
  err.value = ''
  const m = month.value
  const [tot, clo, pend] = await Promise.all([
    supabase.from('monthly_clinic_totals').select('*').eq('month', m),
    supabase.from('month_closings').select('*').eq('month', m).maybeSingle(),
    supabase.from('records').select('created_at').is('return_date', null),
  ])
  const e = tot.error || clo.error || pend.error
  if (e) { err.value = '讀取失敗：' + e.message; loading.value = false; return }
  totals.value = tot.data
  closing.value = clo.data
  const groups = new Map()
  for (const r of pend.data) {
    const d = new Date(r.created_at)
    const key = d.getFullYear() * 100 + d.getMonth() + 1
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  pending.value = [...groups].sort(([a], [b]) => a - b).map(([key, count]) => ({ year: Math.floor(key / 100), month: key % 100, count }))
  const sum = tot.data.reduce((s, r) => s + Number(r.amount), 0)
  const b = await supabase.rpc('calc_bonus', { p_total: sum, p_month: m })
  if (b.error) err.value = '獎金計算失敗：' + b.error.message
  bonus.value = b.data?.[0] ?? null
  loading.value = false
}
watch(month, load, { immediate: true })

const clinicRows = computed(() => store.clinics.map((c) => {
  const t = totals.value.find((r) => r.clinic_id === c.id)
  return { id: c.id, name: c.name, amount: Number(t?.amount ?? 0), count: Number(t?.record_count ?? 0) }
}))
const total = computed(() => clinicRows.value.reduce((s, r) => s + r.amount, 0))
const count = computed(() => clinicRows.value.reduce((s, r) => s + r.count, 0))
const gap = computed(() => (bonus.value ? Number(bonus.value.threshold) - total.value : null))

const mood = computed(() => {
  if (closing.value) return 'done'
  if (gap.value !== null && gap.value < 0) return 'happy'
  return 'idle'
})

// ── 月份結算（admin）──
const confirmClose = ref(false)
const busy = ref(false)
async function closeMonth() {
  busy.value = true
  const snapshot = {
    clinics: clinicRows.value,
    total: total.value,
    record_count: count.value,
    bonus: bonus.value,
  }
  const { error } = await supabase.from('month_closings').insert({ month: month.value, snapshot })
  busy.value = false
  confirmClose.value = false
  if (error) { err.value = '結算失敗：' + error.message; return }
  load()
}
async function reopenMonth() {
  busy.value = true
  const { error } = await supabase.from('month_closings').delete().eq('month', month.value)
  busy.value = false
  if (error) { err.value = '取消結算失敗：' + error.message; return }
  load()
}

// ── 匯出 Excel 給會計（admin）──
const exporting = ref(false)
async function exportExcel() {
  exporting.value = true
  err.value = ''
  try {
    await exportMonth({ supabase, store, month: month.value, closing: closing.value, bonus: bonus.value, recordSelect: RECORD_SELECT })
  } catch (e) {
    err.value = '匯出失敗：' + e.message
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="overview">
    <div class="month-bar">
      <button class="btn ghost" aria-label="上個月" @click="go(-1)">‹</button>
      <h2>{{ fmtMonth(month) }}</h2>
      <button class="btn ghost" aria-label="下個月" @click="go(1)">›</button>
      <span v-if="closing" class="pill done">已結算</span>
    </div>

    <p v-if="err" class="msg error">{{ err }}</p>

    <section class="bonus card" :class="{ closed: closing }">
      <ToothBuddy :size="72" :mood="mood" />
      <div class="bonus-body">
        <template v-if="bonus">
          <div class="bonus-label">每人獎金</div>
          <div class="bonus-num" :class="{ neg: Number(bonus.per_person) < 0 }">{{ fmtMoney(bonus.per_person) }}</div>
          <div class="muted small">
            獎金總額 {{ fmtMoney(bonus.bonus_total) }}
            <template v-if="Number(bonus.bonus_total) < 0">（未達門檻倒扣，兩人合計最多 {{ fmtMoney(bonus.max_deduction) }}）</template>
          </div>
        </template>
        <div v-else-if="!loading" class="muted">這個月份沒有獎金設定</div>
      </div>
    </section>

    <div class="stats">
      <router-link v-for="c in clinicRows" :key="c.id" class="stat" :to="{ path: '/records', query: { m: monthParam(month), clinic: c.name } }">
        <span class="lbl">{{ c.name }}</span>
        <span class="num">{{ fmtMoney(c.amount) }}</span>
        <span class="lbl">{{ c.count }} 筆</span>
      </router-link>
      <router-link class="stat total" :to="{ path: '/records', query: { m: monthParam(month) } }">
        <span class="lbl">合計</span>
        <span class="num">{{ fmtMoney(total) }}</span>
        <span class="lbl">{{ count }} 筆</span>
      </router-link>
      <div v-if="bonus" class="stat" :class="gap > 0 ? 'short' : 'over'">
        <span class="lbl">門檻 {{ fmtMoney(bonus.threshold) }}</span>
        <span class="num">{{ fmtMoney(Math.abs(gap)) }}</span>
        <span class="lbl">{{ gap > 0 ? '還差' : '已超過' }}</span>
      </div>
    </div>

    <router-link v-if="pendingCount" class="pending-note card" :to="{ path: '/records', query: { pending: 1 } }">
      <span>
        <template v-for="(p, i) in pending" :key="p.year * 100 + p.month">{{ i ? '、' : '' }}<template v-if="pending.some((q) => q.year !== p.year)">{{ p.year }} 年 </template>{{ p.month }} 月 <strong>{{ p.count }}</strong> 筆</template>尚未送回，不計入營業額
      </span>
      <span class="muted">補填送回日 ›</span>
    </router-link>

    <p class="muted small">
      營業額依「送回日」歸月；獎金 = (兩家合計 − 門檻) × {{ bonus ? fmtPct(bonus.rate) : '比例' }}，兩位技師各半。
    </p>

    <section v-if="store.isAdmin" class="card closing">
      <template v-if="closing">
        <p>本月已結算，紀錄不能再新增、修改或刪除。</p>
        <button class="btn small" :disabled="busy" @click="reopenMonth">取消結算</button>
      </template>
      <template v-else-if="confirmClose">
        <p>結算後 {{ fmtMonth(month) }} 的紀錄將鎖定，確定要結算嗎？</p>
        <div class="head-actions">
          <button class="btn small" @click="confirmClose = false">先不要</button>
          <button class="btn primary small" :disabled="busy" @click="closeMonth">確定結算</button>
        </div>
      </template>
      <template v-else>
        <p class="muted">確認本月資料無誤後，可結算鎖定。</p>
        <button class="btn small" @click="confirmClose = true">結算本月</button>
      </template>
    </section>

    <section v-if="store.isAdmin" class="card closing">
      <p>
        匯出 {{ fmtMonth(month) }} 的彙整與各診所明細（含病患姓名）給會計
        <span v-if="!closing" class="warn-text">・尚未結算，檔案會標示「未結算」</span>
      </p>
      <button class="btn small" :disabled="exporting || loading" @click="exportExcel">{{ exporting ? '產生中…' : '匯出 Excel' }}</button>
    </section>
  </div>
</template>
