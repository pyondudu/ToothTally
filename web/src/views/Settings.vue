<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { supabase } from '../lib/supabase'
import { store, loadMaster } from '../lib/store'
import { fmtMonth, fmtMoney, fmtPct, monthOf, thisMonth } from '../lib/util'

const err = ref('')
const ok = ref('')
function done(msg) {
  ok.value = msg
  setTimeout(() => { if (ok.value === msg) ok.value = '' }, 2000)
}
async function run(q, msg) {
  err.value = ''
  const { error } = await q
  if (error) { err.value = error.message; return false }
  await loadMaster()
  done(msg)
  return true
}

// ── 價目表 ──
// 改單價只影響之後的登記；舊紀錄的單價是登記當下的快照
const prices = reactive({})
const priceOf = (i) => prices[i.id] ?? Number(i.unit_price)
const priceChanged = (i) => prices[i.id] !== undefined && Number(prices[i.id]) !== Number(i.unit_price)
async function savePrice(i) {
  if (await run(supabase.from('price_items').update({ unit_price: Number(prices[i.id]) }).eq('id', i.id), `${i.name} 單價已更新`)) delete prices[i.id]
}
const toggleItem = (i) => run(supabase.from('price_items').update({ active: !i.active }).eq('id', i.id), i.active ? `已停用 ${i.name}` : `已啟用 ${i.name}`)
const newItem = reactive({ name: '', unit_price: null })
async function addItem() {
  const name = newItem.name.trim()
  if (!name || newItem.unit_price === null) { err.value = '請填項目名稱與單價'; return }
  const sort = Math.max(0, ...store.items.map((i) => i.sort)) + 1
  if (await run(supabase.from('price_items').insert({ name, unit_price: newItem.unit_price, sort }), `已新增 ${name}`)) {
    Object.assign(newItem, { name: '', unit_price: null })
  }
}

// ── 醫師 ──
const toggleDoctor = (d) => run(supabase.from('doctors').update({ active: !d.active }).eq('id', d.id), d.active ? `已停用 ${d.name}` : `已啟用 ${d.name}`)
const newDoctor = ref('')
async function addDoctor() {
  const name = newDoctor.value.trim()
  if (!name) return
  const sort = Math.max(0, ...store.doctors.map((d) => d.sort)) + 1
  if (await run(supabase.from('doctors').insert({ name, sort }), `已新增 ${name} 醫師`)) newDoctor.value = ''
}

// ── 獎金設定（歷史版本）──
const bonusList = ref([])
async function loadBonus() {
  const { data, error } = await supabase.from('bonus_settings').select('*').order('effective_from', { ascending: false })
  if (error) err.value = error.message
  bonusList.value = data ?? []
}
onMounted(loadBonus)
const current = computed(() => bonusList.value.find((b) => b.effective_from <= thisMonth()))
const nb = reactive({ month: thisMonth().slice(0, 7), threshold: null, rate: null, max_deduction: null })
function prefill() {
  const c = current.value
  if (c) Object.assign(nb, { threshold: Number(c.threshold), rate: +(Number(c.rate) * 100).toFixed(2), max_deduction: Number(c.max_deduction) })
}
async function addBonus() {
  if ([nb.threshold, nb.rate, nb.max_deduction].some((v) => v === null || v === '')) { err.value = '請填門檻、比例與最多倒扣'; return }
  const row = {
    effective_from: monthOf(nb.month + '-01'),
    threshold: nb.threshold, rate: nb.rate / 100, max_deduction: nb.max_deduction, share: 0.5,
  }
  const { error } = await supabase.from('bonus_settings').upsert(row, { onConflict: 'effective_from' })
  if (error) { err.value = error.message; return }
  await loadBonus()
  done(`${fmtMonth(row.effective_from)}起的獎金設定已儲存`)
}
</script>

<template>
  <div v-if="!store.isAdmin" class="card center">只有管理者可以使用設定。</div>
  <div v-else class="settings">
    <p v-if="err" class="msg error">{{ err }}</p>
    <p v-if="ok" class="toast" role="status">{{ ok }}</p>

    <section class="card">
      <div class="section-head"><h3>價目表</h3><span class="muted small">改單價不影響已登記的紀錄</span></div>
      <table class="plain">
        <thead><tr><th>項目</th><th class="num">單價</th><th></th></tr></thead>
        <tbody>
          <tr v-for="i in store.items" :key="i.id" :class="{ off: !i.active }">
            <td>{{ i.name }}<span v-if="!i.active" class="pill off">停用</span></td>
            <td class="num">
              <input :id="'price-' + i.id" class="num-input" type="number" min="0" step="any" inputmode="decimal"
                :value="priceOf(i)" :aria-label="i.name + ' 單價'" @input="prices[i.id] = $event.target.value" />
            </td>
            <td class="actions">
              <button v-if="priceChanged(i)" class="btn primary small" @click="savePrice(i)">儲存</button>
              <button class="btn ghost small" @click="toggleItem(i)">{{ i.active ? '停用' : '啟用' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <form class="add-row" @submit.prevent="addItem">
        <input id="new-item-name" v-model="newItem.name" placeholder="新項目名稱" aria-label="新項目名稱" />
        <input id="new-item-price" v-model.number="newItem.unit_price" class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="單價" aria-label="新項目單價" />
        <button class="btn small">新增項目</button>
      </form>
    </section>

    <section class="card">
      <div class="section-head"><h3>醫師</h3><span class="muted small">兩家診所共用</span></div>
      <ul class="chips">
        <li v-for="d in store.doctors" :key="d.id" :class="{ off: !d.active }">
          <span>{{ d.name }}</span>
          <button class="btn link small" @click="toggleDoctor(d)">{{ d.active ? '停用' : '啟用' }}</button>
        </li>
      </ul>
      <form class="add-row" @submit.prevent="addDoctor">
        <input id="new-doctor" v-model="newDoctor" placeholder="新醫師名稱" aria-label="新醫師名稱" />
        <button class="btn small">新增醫師</button>
      </form>
    </section>

    <section class="card">
      <div class="section-head"><h3>獎金設定</h3><span class="muted small">每月套用當時有效的設定</span></div>
      <p v-if="current" class="formula">
        目前：(兩家合計 − <strong>{{ fmtMoney(current.threshold) }}</strong>) × <strong>{{ fmtPct(current.rate) }}</strong>，
        兩位技師各半；未達門檻時兩人合計最多倒扣 <strong>{{ fmtMoney(current.max_deduction) }}</strong>
      </p>
      <table class="plain">
        <thead><tr><th>起始月份</th><th class="num">門檻</th><th class="num">比例</th><th class="num">最多倒扣</th></tr></thead>
        <tbody>
          <tr v-for="b in bonusList" :key="b.id">
            <td>{{ fmtMonth(b.effective_from) }}起</td>
            <td class="num">{{ fmtMoney(b.threshold) }}</td>
            <td class="num">{{ fmtPct(b.rate) }}</td>
            <td class="num">{{ fmtMoney(b.max_deduction) }}</td>
          </tr>
        </tbody>
      </table>
      <details class="new-bonus" @toggle="prefill">
        <summary>新增或修改某月起的設定</summary>
        <form class="grid" @submit.prevent="addBonus">
          <label>從哪個月起<input id="nb-month" v-model="nb.month" type="month" /></label>
          <label>門檻<input id="nb-threshold" v-model.number="nb.threshold" type="number" min="0" inputmode="numeric" /></label>
          <label>比例（%）<input id="nb-rate" v-model.number="nb.rate" type="number" min="0" max="100" step="any" inputmode="decimal" /></label>
          <label>未達門檻最多倒扣<input id="nb-max" v-model.number="nb.max_deduction" type="number" min="0" inputmode="numeric" /></label>
          <div class="span2 form-actions"><button class="btn primary small">儲存設定</button></div>
        </form>
        <p class="muted small">同一個月份再儲存一次會覆蓋該月的設定；已結算的月份請勿更改。</p>
      </details>
    </section>
  </div>
</template>
