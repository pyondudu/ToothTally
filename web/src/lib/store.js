import { reactive } from 'vue'
import { supabase } from './supabase'

// 登入狀態與下拉選單用的基本資料（診所、醫師、技師、價目）
export const store = reactive({
  session: null,
  profile: null,
  clinics: [],
  doctors: [],
  technicians: [],
  items: [],
  get role() { return this.profile?.role ?? null },
  get isAdmin() { return this.role === 'admin' },
  // 目前登入的技師（staff 帳號綁定的 technicians 列）
  get myTech() { return this.technicians.find((t) => t.profile_id === this.session?.user?.id) ?? null },
})

export async function initAuth() {
  const { data } = await supabase.auth.getSession()
  await setSession(data.session)
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user?.id !== store.session?.user?.id) setSession(session)
    else store.session = session
  })
}

async function setSession(session) {
  store.session = session
  store.profile = null
  if (!session) return
  const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
  store.profile = data
  await loadMaster()
}

export async function loadMaster() {
  const [clinics, doctors, technicians, items] = await Promise.all([
    supabase.from('clinics').select('*').order('sort'),
    supabase.from('doctors').select('*').order('sort').order('name'),
    supabase.from('technicians').select('*').order('name'),
    supabase.from('price_items').select('*').order('sort').order('name'),
  ])
  for (const r of [clinics, doctors, technicians, items]) if (r.error) throw r.error
  store.clinics = clinics.data
  store.doctors = doctors.data
  store.technicians = technicians.data
  store.items = items.data
}

// 紀錄列表／編輯用：帶出診所、醫師、項目、技師名稱
export const RECORD_SELECT = '*, clinic:clinics(name), doctor:doctors(name), item:price_items(name), technician:technicians(name)'
