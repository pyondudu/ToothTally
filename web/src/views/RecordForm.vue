<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { store, RECORD_SELECT } from '../lib/store'
import { fmtDate, fmtMoney, isEmpty, todayStr } from '../lib/util'
import ToothBuddy from '../components/ToothBuddy.vue'

const props = defineProps({ id: String })
const router = useRouter()
const isNew = computed(() => !props.id)

const EMPTY = {
  clinic_id: null, send_date: todayStr(), appt_date: null, doctor_id: '', patient_name: '',
  item_id: '', tooth: '', qty: 1, unit_price: 0, amount: 0, return_date: null,
  technician_id: '', note: '',
}
const form = reactive({ ...EMPTY })
const original = ref(null)
const err = ref('')
const busy = ref(false)
const buddy = ref(null)
// 手動改過金額後，就不再自動用 顆數 × 單價 覆蓋
const amountTouched = ref(false)

// 新增：預設第一家診所、自己（技師帳號）
watch(() => [store.clinics.length, store.myTech], () => {
  if (!isNew.value) return
  if (!form.clinic_id && store.clinics.length) form.clinic_id = store.clinics[0].id
  if (!form.technician_id && store.myTech) form.technician_id = store.myTech.id
}, { immediate: true })

// 編輯（admin）：讀取原紀錄
watch(() => props.id, async (id) => {
  if (!id) return
  const { data, error } = await supabase.from('records').select(RECORD_SELECT).eq('id', id).single()
  if (error) { err.value = '讀取紀錄失敗：' + error.message; return }
  original.value = data
  for (const k of Object.keys(EMPTY)) form[k] = data[k] ?? EMPTY[k]
  amountTouched.value = Number(data.amount) !== Number(data.qty) * Number(data.unit_price)
}, { immediate: true })

// 下拉選項：停用的醫師／項目不列出，但編輯舊紀錄時保留原本的值
const doctorOptions = computed(() => store.doctors.filter((d) => d.active || d.id === form.doctor_id))
const itemOptions = computed(() => store.items.filter((i) => (i.active || i.id === form.item_id) && (!i.clinic_id || i.clinic_id === form.clinic_id)))
const techOptions = computed(() => store.technicians.filter((t) => t.active || t.id === form.technician_id))

function pickItem() {
  const item = store.items.find((i) => i.id === form.item_id)
  if (item) form.unit_price = Number(item.unit_price)
  if (!amountTouched.value) form.amount = Number(form.qty || 0) * Number(form.unit_price || 0)
}
watch(() => [form.qty, form.unit_price], () => {
  if (!amountTouched.value) form.amount = Number(form.qty || 0) * Number(form.unit_price || 0)
})
function resetAmount() {
  amountTouched.value = false
  form.amount = Number(form.qty || 0) * Number(form.unit_price || 0)
}

// 醫師「＋ 新增…」
const ADD_NEW = '__add__'
watch(() => form.doctor_id, async (v, prev) => {
  if (v !== ADD_NEW) return
  form.doctor_id = prev
  const name = window.prompt('新增醫師名稱：')?.trim()
  if (!name) return
  const exist = store.doctors.find((d) => d.name === name)
  if (exist) { form.doctor_id = exist.id; return }
  const { data, error } = await supabase.from('doctors').insert({ name }).select().single()
  if (error) { err.value = '新增醫師失敗：' + error.message; return }
  store.doctors.push(data)
  form.doctor_id = data.id
})

// 必填（同 Google 表單）
const LABELS = {
  clinic_id: '診所', send_date: '送件日', appt_date: '約診日', doctor_id: '醫師', patient_name: '患者姓名',
  item_id: '項目', qty: '顆數', technician_id: '技師',
}
const showErrors = ref(false)
const missing = computed(() => Object.keys(LABELS).filter((k) => isEmpty(form[k]) || (k === 'qty' && !(Number(form.qty) > 0))))
const bad = (k) => showErrors.value && missing.value.includes(k)
watch(missing, (m) => {
  if (showErrors.value) err.value = m.length ? '還有欄位沒填：' + m.map((k) => LABELS[k]).join('、') : ''
})

async function save() {
  if (missing.value.length) {
    showErrors.value = true
    err.value = '還有欄位沒填：' + missing.value.map((k) => LABELS[k]).join('、')
    await nextTick()
    const first = document.querySelector('.form .invalid')
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    first?.querySelector('input, textarea, select')?.focus({ preventScroll: true })
    return
  }
  err.value = ''
  busy.value = true
  const payload = { ...form }
  for (const k of Object.keys(payload)) if (payload[k] === '') payload[k] = null
  const q = isNew.value
    ? supabase.from('records').insert(payload).select(RECORD_SELECT).single()
    : supabase.from('records').update(payload).eq('id', props.id)
  const { data, error } = await q
  busy.value = false
  if (error) { err.value = '儲存失敗：' + friendly(error.message); return }
  if (!isNew.value) { router.back(); return }
  // 登記成功：清空表單（保留診所、送件日、技師），頂端顯示剛登記的內容，最近登記清單也會出現這筆
  saved.value = data
  recent.value = [data, ...recent.value.filter((r) => r.id !== data.id)].slice(0, RECENT_N)
  clearAll()
  buddy.value?.celebrate('登記完成！')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function clearAll() {
  Object.assign(form, { ...EMPTY, send_date: form.send_date || todayStr(), clinic_id: form.clinic_id, technician_id: store.myTech?.id ?? form.technician_id })
  amountTouched.value = false
  showErrors.value = false
  err.value = ''
}

// 剛登記的那筆；可一鍵帶回同一位病患的資料，再登記下一個項目
const saved = ref(null)
function samePatient() {
  const r = saved.value
  Object.assign(form, {
    clinic_id: r.clinic_id, send_date: r.send_date, appt_date: r.appt_date, doctor_id: r.doctor_id,
    patient_name: r.patient_name, return_date: r.return_date, technician_id: r.technician_id,
  })
  saved.value = null
  nextTick(() => document.getElementById('f-item')?.focus())
}
// 有開始填新的一筆，就收起成功提示
watch(() => [form.patient_name, form.item_id], ([p, i]) => { if (saved.value && (p || i)) saved.value = null })

// 我最近登記的幾筆（確認有登記進去）
const RECENT_N = 5
const recent = ref([])
watch(() => [isNew.value, store.session?.user?.id], async ([n, uid]) => {
  if (!n || !uid) return
  const { data } = await supabase.from('records').select(RECORD_SELECT)
    .eq('created_by', uid).order('created_at', { ascending: false }).limit(RECENT_N)
  recent.value = data ?? []
}, { immediate: true })

function friendly(msg) {
  if (msg.includes('已結算')) return msg + '（送回日所在的月份已結算）'
  return msg
}
</script>

<template>
  <div v-if="!isNew && !store.isAdmin" class="card center">只有管理者可以修改紀錄。</div>
  <div v-else-if="!isNew && !original && !err" class="muted center">載入中…</div>
  <form v-else class="form" novalidate @submit.prevent="save">
    <div class="page-head">
      <button v-if="!isNew" type="button" class="btn ghost small" @click="router.back()">← 返回</button>
      <ToothBuddy v-else ref="buddy" :size="44" />
      <h2>{{ isNew ? '登記業績' : '修改紀錄' }}</h2>
      <button v-if="isNew" type="button" class="btn link push-right" @click="clearAll">全部清空</button>
    </div>

    <div v-if="saved" class="saved card" role="status">
      <div class="saved-text">
        <strong>✓ 已登記</strong>
        <span>{{ saved.patient_name }}　{{ saved.item?.name }} × {{ Number(saved.qty) }}　{{ fmtMoney(saved.amount) }}</span>
        <span class="muted small">{{ saved.clinic?.name }}・{{ saved.doctor?.name }} 醫師・{{ saved.return_date ? '送回 ' + fmtDate(saved.return_date) : '尚未送回' }}</span>
      </div>
      <button type="button" class="btn small" @click="samePatient">同一位病患再登記一筆</button>
    </div>

    <fieldset class="card">
      <legend>診所與病患</legend>
      <div class="grid">
        <div class="span2 seg" role="radiogroup" aria-label="診所" :class="{ invalid: bad('clinic_id') }">
          <button v-for="c in store.clinics" :key="c.id" type="button" role="radio" :aria-checked="form.clinic_id === c.id"
            class="seg-btn" :class="{ on: form.clinic_id === c.id }" @click="form.clinic_id = c.id">{{ c.name }}</button>
        </div>
        <label :class="{ invalid: bad('send_date') }">送件日 *<input id="f-send" v-model="form.send_date" type="date" /></label>
        <label :class="{ invalid: bad('appt_date') }">約診日 *<input id="f-appt" v-model="form.appt_date" type="date" /></label>
        <label :class="{ invalid: bad('doctor_id') }">醫師 *
          <select id="f-doctor" v-model="form.doctor_id">
            <option value="" disabled>請選擇醫師</option>
            <option v-for="d in doctorOptions" :key="d.id" :value="d.id">{{ d.name }}</option>
            <option :value="ADD_NEW">＋ 新增醫師…</option>
          </select>
        </label>
        <label :class="{ invalid: bad('patient_name') }">患者姓名 *<input id="f-patient" v-model="form.patient_name" autocomplete="off" /></label>
      </div>
    </fieldset>

    <fieldset class="card">
      <legend>項目</legend>
      <div class="grid">
        <label class="span2" :class="{ invalid: bad('item_id') }">項目 *
          <select id="f-item" v-model="form.item_id" @change="pickItem">
            <option value="" disabled>請選擇項目</option>
            <option v-for="i in itemOptions" :key="i.id" :value="i.id">{{ i.name }}（{{ Number(i.unit_price).toLocaleString() }}）</option>
          </select>
        </label>
        <label>牙位<input id="f-tooth" v-model="form.tooth" placeholder="例：36、11.21、上顎" autocomplete="off" /></label>
        <label :class="{ invalid: bad('qty') }">顆數 *<input id="f-qty" v-model.number="form.qty" type="number" min="1" step="1" inputmode="numeric" /></label>
        <label>單價<input id="f-price" v-model.number="form.unit_price" type="number" min="0" step="any" inputmode="decimal" :readonly="!store.isAdmin" /></label>
        <label>金額
          <input id="f-amount" v-model.number="form.amount" type="number" min="0" step="any" inputmode="decimal" @input="amountTouched = true" />
          <button v-if="amountTouched" type="button" class="btn link small left" @click="resetAmount">改回 顆數 × 單價</button>
        </label>
      </div>
    </fieldset>

    <fieldset class="card">
      <legend>送回與技師</legend>
      <div class="grid">
        <label>送回日<input id="f-return" v-model="form.return_date" type="date" />
          <span class="hint">還沒送回可先留空，送回後再到「紀錄 › 未送回」補填；填了才計入該月營業額</span>
        </label>
        <label :class="{ invalid: bad('technician_id') }">技師 *
          <select id="f-tech" v-model="form.technician_id">
            <option value="" disabled>請選擇技師</option>
            <option v-for="t in techOptions" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </label>
        <label class="span2">備註<textarea id="f-note" v-model="form.note" rows="2" /></label>
      </div>
    </fieldset>

    <p v-if="err" class="msg error">{{ err }}</p>
    <div class="form-actions">
      <span class="muted total-line">金額 <strong>{{ Number(form.amount || 0).toLocaleString() }}</strong></span>
      <button v-if="!isNew" type="button" class="btn ghost" @click="router.back()">取消</button>
      <button class="btn primary" :disabled="busy">{{ busy ? '儲存中…' : (isNew ? '登記' : '儲存') }}</button>
    </div>

    <section v-if="isNew && recent.length" class="card recent">
      <div class="section-head"><h3>我最近登記的</h3><router-link class="btn link small" to="/records">看全部紀錄 ›</router-link></div>
      <ul>
        <li v-for="r in recent" :key="r.id" :class="{ fresh: r.id === recent[0].id && saved }">
          <span class="recent-main"><strong>{{ r.patient_name }}</strong>　{{ r.item?.name }} × {{ Number(r.qty) }}</span>
          <span class="muted small">{{ r.clinic?.name }}・送件 {{ fmtDate(r.send_date) }}</span>
          <span class="recent-amt">{{ fmtMoney(r.amount) }}</span>
        </li>
      </ul>
    </section>
  </form>
</template>
