-- ToothTally 資料庫結構
-- 在 Supabase Dashboard → SQL Editor 貼上整份執行即可（可重複執行）。

-- ─────────────────────────────────────────────
-- 使用者角色：admin（主要者，管理）/ staff（牙技師）
-- ─────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'staff' check (role in ('admin', 'staff')),
  created_at   timestamptz not null default now()
);

-- 新使用者建立時自動產生 profile（預設 staff）
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 目前登入者角色（security definer 避免 RLS 遞迴）
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ─────────────────────────────────────────────
-- 基本資料：診所、醫師、技師、價目
-- ─────────────────────────────────────────────
create table if not exists public.clinics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

-- 醫師：兩家診所共用一份名單
create table if not exists public.doctors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

-- 技師：紀錄「這筆是誰做的」，與獎金分配無關。profile_id 之後綁定 staff 帳號
create table if not exists public.technicians (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  profile_id  uuid unique references public.profiles(id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 價目：clinic_id 為 null = 兩家通用。不用的項目設 active = false，不要刪除（舊紀錄會參照）
create table if not exists public.price_items (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid references public.clinics(id),
  name        text not null,
  unit_price  numeric not null default 0,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique nulls not distinct (clinic_id, name)
);

-- ─────────────────────────────────────────────
-- 業績登記
-- month：業績月份（每月 1 日）＝送回日所在月。尚未送回（return_date 為 null）時 month 也是 null，
--        不計入任何月份的營業額；補填送回日後自動歸入該月
-- unit_price：登記當下的價目快照，之後改價目表不影響舊紀錄
-- ─────────────────────────────────────────────
create table if not exists public.records (
  id             uuid primary key default gen_random_uuid(),
  month          date,
  send_date      date,                -- 送件日
  appt_date      date,                -- 約診日
  return_date    date,                -- 送回日
  clinic_id      uuid not null references public.clinics(id),
  doctor_id      uuid references public.doctors(id),
  patient_name   text,
  tooth          text,                -- 牙位（自由文字，如 27.45、上下顎）
  item_id        uuid references public.price_items(id),
  qty            numeric not null default 1,
  unit_price     numeric not null default 0,
  amount         numeric not null default 0,
  technician_id  uuid references public.technicians(id),
  note           text,
  source         text not null default 'form' check (source in ('form', 'import')),
  import_key     text unique,         -- 匯入去重用
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists records_month_idx on public.records (month, clinic_id);
create index if not exists records_pending_idx on public.records (send_date) where return_date is null;

-- ─────────────────────────────────────────────
-- 獎金設定（歷史版本，各月份套用 effective_from <= 該月 的最新一筆）
-- 獎金總額 = max((兩家合計 − threshold) × rate, −max_deduction)；每位技師 = 獎金總額 × share
-- ─────────────────────────────────────────────
create table if not exists public.bonus_settings (
  id              uuid primary key default gen_random_uuid(),
  effective_from  date not null unique,   -- 月份（每月 1 日）
  threshold       numeric not null,
  rate            numeric not null,
  max_deduction   numeric not null default 0,   -- 未達門檻時，兩人合計最多倒扣金額
  share           numeric not null default 0.5, -- 每位技師分得比例
  created_at      timestamptz not null default now()
);

create table if not exists public.month_closings (
  month      date primary key,
  closed_by  uuid references auth.users(id) default auth.uid(),
  closed_at  timestamptz not null default now(),
  snapshot   jsonb
);

-- ─────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────
create or replace function public.records_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and exists (select 1 from month_closings where month = old.month) then
    raise exception '% 已結算，不能修改', to_char(old.month, 'YYYY-MM');
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  -- staff 只能補填「尚未送回」紀錄的送回日，其他欄位不能動
  if tg_op = 'UPDATE' and public.my_role() = 'staff' then
    if old.return_date is not null or new.return_date is null
       or (to_jsonb(new) - 'return_date' - 'month' - 'updated_at')
          is distinct from (to_jsonb(old) - 'return_date' - 'month' - 'updated_at') then
      raise exception '技師只能補填尚未送回紀錄的送回日';
    end if;
  end if;

  -- 業績月份：未送回 → null；送回日變動 → 跟著送回日；匯入時可明確指定（舊 Excel 以工作表月份為準）
  if new.return_date is null then
    new.month := null;
  elsif tg_op = 'INSERT' then
    new.month := date_trunc('month', coalesce(new.month, new.return_date))::date;
  elsif new.return_date is distinct from old.return_date then
    new.month := date_trunc('month', new.return_date)::date;
  else
    new.month := date_trunc('month', new.month)::date;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  if exists (select 1 from month_closings where month = new.month) then
    raise exception '% 已結算，不能新增或修改', to_char(new.month, 'YYYY-MM');
  end if;
  return new;
end $$;

drop trigger if exists records_before_write on public.records;
create trigger records_before_write before insert or update or delete on public.records
  for each row execute function public.records_before_write();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists price_items_touch on public.price_items;
create trigger price_items_touch before update on public.price_items
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────
-- 獎金計算與月彙整
-- ─────────────────────────────────────────────
create or replace function public.calc_bonus(p_total numeric, p_month date)
returns table (threshold numeric, rate numeric, max_deduction numeric, share numeric,
               bonus_total numeric, per_person numeric)
language sql stable set search_path = public as $$
  select s.threshold, s.rate, s.max_deduction, s.share,
         b.total, round(b.total * s.share)
  from (select * from bonus_settings
        where effective_from <= p_month order by effective_from desc limit 1) s
  cross join lateral (
    select round(greatest((p_total - s.threshold) * s.rate, -s.max_deduction)) as total
  ) b
$$;

-- 月份 × 診所（未送回的紀錄不計）
create or replace view public.monthly_clinic_totals with (security_invoker = true) as
select r.month, c.id as clinic_id, c.name as clinic_name, c.sort,
       count(*) as record_count, sum(r.amount) as amount
from public.records r join public.clinics c on c.id = r.clinic_id
where r.month is not null
group by r.month, c.id, c.name, c.sort;

-- 月份總覽（含獎金與結算狀態）
create or replace view public.monthly_summary with (security_invoker = true) as
select t.month, t.record_count, t.total,
       b.threshold, b.rate, b.max_deduction, b.share,
       t.total - b.threshold as over_threshold,
       b.bonus_total, b.per_person,
       (mc.month is not null) as closed
from (select month, count(*) as record_count, sum(amount) as total
      from public.records where month is not null group by month) t
left join lateral public.calc_bonus(t.total, t.month) b on true
left join public.month_closings mc on mc.month = t.month;

-- ─────────────────────────────────────────────
-- RLS
--   讀取：admin、staff
--   records 新增：admin、staff（created_by 必須是自己）；修改／刪除：admin；staff 可補填未送回紀錄的送回日
--   價目、醫師、技師、診所、獎金設定、結算：只有 admin 能寫
--   （醫師下拉的「＋新增」：staff 也可新增醫師）
-- ─────────────────────────────────────────────
alter table public.profiles       enable row level security;
alter table public.clinics        enable row level security;
alter table public.doctors        enable row level security;
alter table public.technicians    enable row level security;
alter table public.price_items    enable row level security;
alter table public.records        enable row level security;
alter table public.bonus_settings enable row level security;
alter table public.month_closings enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select using (id = auth.uid() or public.my_role() in ('admin', 'staff'));

do $$
declare t text;
begin
  foreach t in array array['clinics', 'doctors', 'technicians', 'price_items', 'records', 'bonus_settings', 'month_closings'] loop
    execute format('drop policy if exists "read for members" on public.%I', t);
    execute format('create policy "read for members" on public.%I for select using (public.my_role() in (''admin'', ''staff''))', t);
    execute format('drop policy if exists "write for admin" on public.%I', t);
    execute format('create policy "write for admin" on public.%I for all using (public.my_role() = ''admin'') with check (public.my_role() = ''admin'')', t);
  end loop;
end $$;

drop policy if exists "staff insert records" on public.records;
create policy "staff insert records" on public.records
  for insert with check (public.my_role() = 'staff' and created_by = auth.uid() and source = 'form');

-- staff 補填送回日（只限尚未送回的紀錄；只能改送回日由 trigger 檢查）
drop policy if exists "staff fill return_date" on public.records;
create policy "staff fill return_date" on public.records
  for update using (public.my_role() = 'staff' and return_date is null)
  with check (public.my_role() = 'staff');

drop policy if exists "staff insert doctors" on public.doctors;
create policy "staff insert doctors" on public.doctors
  for insert with check (public.my_role() = 'staff');

-- ─────────────────────────────────────────────
-- 種子資料
-- ─────────────────────────────────────────────
insert into public.clinics (name, sort) values ('正光', 1), ('小檜溪', 2)
on conflict (name) do nothing;

-- 技師、醫師名單屬個人資料，不放在 repo：放在 supabase/seed.local.sql（已被 .gitignore 排除）另外執行


-- 價目（2026-07-28 更新版，兩家通用）。只在項目不存在時新增，不覆蓋之後在設定頁改過的單價
insert into public.price_items (clinic_id, name, unit_price, sort) values
  (null, 'temp',            800,  1),
  (null, '3D列印temp',      800,  2),
  (null, 'zr(前牙)',        2800, 3),
  (null, 'zr(後牙)',        2300, 4),
  (null, 'IP zr(前牙)',     4000, 5),
  (null, 'IP zr(後牙)',     3500, 6),
  (null, 'E.max(前牙)',     3500, 7),
  (null, 'E.max',           3000, 8),
  (null, '維持器',          1000, 9),
  (null, '咬合板',          1500, 10),
  (null, '3D模型列印',      800,  11),
  (null, '手術導板',        1500, 12),
  (null, 'ALL ON Denture',  3000, 13),
  (null, '數位排牙',        100,  14),
  (null, '委外客製化ABUTMENT', 0, 15)  -- 委外費用另收，不計入營業額
on conflict (clinic_id, name) do nothing;

-- 只出現在舊資料、表單上沒有的項目：建立但停用（舊紀錄才能對應名稱）
insert into public.price_items (clinic_id, name, unit_price, sort, active) values
  (null, 'Denture', 3000, 90, false)   -- 115/05 一筆：顧醫師代印，收 3000 算技工所
on conflict (clinic_id, name) do nothing;

insert into public.bonus_settings (effective_from, threshold, rate, max_deduction, share)
values ('2026-05-01', 178000, 0.4, 3000, 0.5)
on conflict (effective_from) do nothing;

-- ─────────────────────────────────────────────
-- 建立帳號後，把自己設為 admin（把 email 換成你的）：
--   update public.profiles set role = 'admin' where email = 'you@example.com';
-- staff 帳號綁定技師（帳號與技師名稱換成實際的）：
--   update public.technicians set profile_id = (select id from public.profiles where email = '<帳號>@toothtally.local') where name = '<技師名>';
-- ─────────────────────────────────────────────
