<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { store, RECORD_SELECT } from '../lib/store'
import { addMonths, fmtDate, fmtMonth, fmtMoney, fromMonthParam, monthParam, thisMonth, todayStr } from '../lib/util'

const route = useRoute()
const router = useRouter()

// 網址記住檢視條件：?m=2026-10 或 ?pending=1，以及篩選
const pending = computed(() => route.query.pending === '1')
const month = computed(() => fromMonthParam(route.query.m) ?? thisMonth())
const setQuery = (q) => router.replace({ query: { ...route.query, ...q } })
const goMonth = (n) => setQuery({ m: monthParam(addMonths(month.value, n)), pending: undefined })

const filters = reactive({ clinic: '', doctor: '', tech: '', item: '', q: '' })
watch(() => route.query, (q) => {
  for (const k of ['clinic', 'doctor', 'tech', 'item']) filters[k] = q[k] ?? ''
}, { immediate: true })
watch(() => ({ ...filters }), (f) => {
  const q = {}
  for (const k of ['clinic', 'doctor', 'tech', 'item']) q[k] = f[k] || undefined
  setQuery(q)
})

const rows = ref([])
const loading = ref(false)
const err = ref('')
const closed = ref(false)

async function load() {
  loading.value = true
  err.value = ''
  let q = supabase.from('records').select(RECORD_SELECT)
  q = pending.value
    ? q.is('return_date', null).order('send_date')
    : q.eq('month', month.value).order('return_date').order('send_date')
  const [res, clo] = await Promise.all([
    q,
    pending.value ? { data: null } : supabase.from('month_closings').select('month').eq('month', month.value).maybeSingle(),
  ])
  loading.value = false
  if (res.error) { err.value = '讀取失敗：' + res.error.message; return }
  rows.value = res.data
  closed.value = Boolean(clo.data)
}
watch([pending, month], load, { immediate: true })

const shown = computed(() => {
  const s = filters.q.trim()
  return rows.value.filter((r) =>
    (!filters.clinic || r.clinic?.name === filters.clinic) &&
    (!filters.doctor || r.doctor?.name === filters.doctor) &&
    (!filters.tech || r.technician?.name === filters.tech) &&
    (!filters.item || r.item?.name === filters.item) &&
    (!s || (r.patient_name ?? '').includes(s) || (r.tooth ?? '').includes(s) || (r.note ?? '').includes(s)))
})
const sum = computed(() => shown.value.reduce((s, r) => s + Number(r.amount), 0))
const names = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
const doctorNames = computed(() => names(rows.value.map((r) => r.doctor?.name)))
const itemNames = computed(() => names(rows.value.map((r) => r.item?.name)))

// ── 補填送回日（未送回清單；技師也可以）──
const returnDates = reactive({})
const saving = ref(null)
async function fillReturn(r) {
  const d = returnDates[r.id] || todayStr()
  saving.value = r.id
  const { error } = await supabase.from('records').update({ return_date: d }).eq('id', r.id)
  saving.value = null
  if (error) { err.value = `${r.patient_name}：` + error.message; return }
  rows.value = rows.value.filter((x) => x.id !== r.id)
}

// ── 刪除（admin）──
const confirmDel = ref(null)
async function remove(r) {
  const { error } = await supabase.from('records').delete().eq('id', r.id)
  confirmDel.value = null
  if (error) { err.value = '刪除失敗：' + error.message; return }
  rows.value = rows.value.filter((x) => x.id !== r.id)
}
</script>

<template>
  <div class="records">
    <div class="view-switch">
      <div class="seg">
        <button type="button" class="seg-btn" :class="{ on: !pending }" @click="setQuery({ pending: undefined })">依月份</button>
        <button type="button" class="seg-btn" :class="{ on: pending }" @click="setQuery({ pending: '1' })">未送回</button>
      </div>
      <div v-if="!pending" class="month-bar">
        <button class="btn ghost" aria-label="上個月" @click="goMonth(-1)">‹</button>
        <h2>{{ fmtMonth(month) }}</h2>
        <button class="btn ghost" aria-label="下個月" @click="goMonth(1)">›</button>
        <span v-if="closed" class="pill done">已結算</span>
      </div>
    </div>

    <div class="toolbar">
      <input id="r-search" v-model="filters.q" class="search" type="search" placeholder="搜尋病患、牙位、備註" />
      <select id="r-clinic" v-model="filters.clinic" aria-label="診所">
        <option value="">全部診所</option>
        <option v-for="c in store.clinics" :key="c.id" :value="c.name">{{ c.name }}</option>
      </select>
      <select id="r-doctor" v-model="filters.doctor" aria-label="醫師">
        <option value="">全部醫師</option>
        <option v-for="n in doctorNames" :key="n" :value="n">{{ n }}</option>
      </select>
      <select id="r-tech" v-model="filters.tech" aria-label="技師">
        <option value="">全部技師</option>
        <option v-for="t in store.technicians" :key="t.id" :value="t.name">{{ t.name }}</option>
      </select>
      <select id="r-item" v-model="filters.item" aria-label="項目">
        <option value="">全部項目</option>
        <option v-for="n in itemNames" :key="n" :value="n">{{ n }}</option>
      </select>
    </div>

    <p class="filter-note">
      {{ shown.length }} 筆，金額 <strong>{{ fmtMoney(sum) }}</strong>
      <template v-if="pending">（未送回，不計入營業額）</template>
    </p>
    <p v-if="err" class="msg error">{{ err }}</p>
    <p v-if="loading" class="muted center">載入中…</p>
    <p v-else-if="!shown.length" class="muted center empty">{{ pending ? '沒有未送回的紀錄' : '這個月份沒有紀錄' }}</p>

    <ul v-else class="rec-list">
      <li v-for="r in shown" :key="r.id" class="rec card">
        <div class="rec-main">
          <div class="rec-title">
            <strong>{{ r.patient_name }}</strong>
            <span class="muted">{{ r.item?.name ?? '（無項目）' }} × {{ Number(r.qty) }}</span>
          </div>
          <div class="rec-amount">{{ fmtMoney(r.amount) }}</div>
        </div>
        <div class="rec-meta">
          <span class="pill clinic">{{ r.clinic?.name }}</span>
          <span>{{ r.doctor?.name ?? '—' }} 醫師</span>
          <span v-if="r.tooth">牙位 {{ r.tooth }}</span>
          <span>{{ r.technician?.name ?? '未指定技師' }}</span>
        </div>
        <div class="rec-dates">
          <span>送件 {{ fmtDate(r.send_date) }}</span>
          <span>約診 {{ fmtDate(r.appt_date) }}</span>
          <span v-if="r.return_date">送回 {{ fmtDate(r.return_date) }}</span>
        </div>
        <p v-if="r.note" class="rec-note">{{ r.note }}</p>

        <div v-if="pending" class="rec-actions">
          <label class="inline">送回日<input :id="'ret-' + r.id" v-model="returnDates[r.id]" type="date" :placeholder="todayStr()" /></label>
          <button class="btn primary small" :disabled="saving === r.id" @click="fillReturn(r)">
            {{ returnDates[r.id] ? '確認送回' : '今天送回' }}
          </button>
        </div>
        <div v-if="store.isAdmin && !closed" class="rec-actions admin">
          <template v-if="confirmDel === r.id">
            <span class="muted small">確定刪除這筆？</span>
            <button class="btn small" @click="confirmDel = null">取消</button>
            <button class="btn small danger" @click="remove(r)">刪除</button>
          </template>
          <template v-else>
            <router-link class="btn ghost small" :to="`/records/${r.id}/edit`">修改</router-link>
            <button class="btn ghost small danger" @click="confirmDel = r.id">刪除</button>
          </template>
        </div>
      </li>
    </ul>
  </div>
</template>
