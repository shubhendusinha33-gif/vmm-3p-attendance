-- VMM 3rd Party Attendance — schema v1
create extension if not exists pgcrypto;

-- ---------- master data ----------
create table public.stores (
  store_code text primary key check (store_code ~ '^[A-Z]{2}[0-9]{2}$'),
  name text not null,
  city text,
  am_emp text,
  zfm_emp text,
  lat double precision,
  lng double precision,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.categories (
  id text primary key,                 -- HK, SEC, TRAVEL, CDIT ...
  name text not null,
  name_hi text,
  brands text[] not null default '{}',
  photo_group text,                    -- HK / SEC / PROM / null = no photo
  sort int not null default 0,
  active boolean not null default true
);

create table public.departments (
  id bigserial primary key,
  name text not null unique,           -- Facility, Security, Travel, CDIT
  category_ids text[] not null default '{}'
);

create table public.users (
  emp_code text primary key check (emp_code ~ '^[0-9]{5,}$'),
  name text not null,
  role text not null check (role in ('store','am','zfm','hodept','admin')),
  post text check (post in ('SM','ASM','MOD')),
  store_code text references public.stores(store_code),
  dept_id bigint references public.departments(id),
  pin_hash text,
  failed_count int not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  first_login_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

-- append-only requirement history
create table public.manpower (
  id bigserial primary key,
  store_code text not null references public.stores(store_code),
  category_id text not null references public.categories(id),
  brand text not null default '',
  vendor text,
  morning int not null default 0 check (morning >= 0),
  evening int not null default 0 check (evening >= 0),
  effective_from date not null,
  uploaded_by text,
  created_at timestamptz not null default now()
);
create index on public.manpower (store_code, category_id, brand, effective_from desc);

create table public.associates (
  id bigserial primary key,
  code text not null unique,
  store_code text not null references public.stores(store_code),
  category_id text not null references public.categories(id),
  brand text not null default '',
  vendor text,
  name text not null,
  norm_name text not null,
  created_at timestamptz not null default now(),
  unique (store_code, category_id, brand, norm_name)
);

create table public.punches (
  id bigserial primary key,
  associate_id bigint not null references public.associates(id),
  store_code text not null,
  category_id text not null,
  brand text not null default '',
  vendor text,
  work_date date not null,
  kind text not null check (kind in ('IN','OUT')),
  ts timestamptz not null default now(),
  shift text not null check (shift in ('M','E')),
  lat double precision, lng double precision, dist_m int,
  device_kind text not null default 'own' check (device_kind in ('own','mod')),
  device_id text,
  mod_emp text,
  photo_status text not null default 'none' check (photo_status in ('none','pending','done','missing','deleted')),
  photo_token uuid,
  photo_path text
);
create index on public.punches (store_code, work_date);
create index on public.punches (associate_id, work_date);
create index on public.punches (work_date);

create table public.compoffs (
  associate_id bigint not null references public.associates(id),
  work_date date not null,
  marked_by text not null,
  created_at timestamptz not null default now(),
  primary key (associate_id, work_date)
);

-- one random photo per store / day / group
create table public.photo_slots (
  store_code text not null,
  work_date date not null,
  grp text not null,
  target_n int not null,
  seen_n int not null default 0,
  taken boolean not null default false,
  primary key (store_code, work_date, grp)
);

create table public.sessions (
  token uuid primary key default gen_random_uuid(),
  emp_code text not null references public.users(emp_code),
  role text not null,
  store_code text,
  device_id text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text
);
create index on public.sessions (store_code) where ended_at is null;

create table public.access_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  emp_code text,
  role text,
  store_code text,
  event text not null,        -- login, logout, auto_logout, pin_lock, pin_set, pin_reset, store_busy
  by_emp text,
  detail text
);
create index on public.access_log (ts desc);

create table public.settings (
  id int primary key default 1 check (id = 1),
  test_mode boolean not null default true,
  radius_m int not null default 500,
  store_idle_min int not null default 30,
  pin_max_tries int not null default 3,
  pin_lock_min int not null default 5,
  storage_alert_pct int not null default 70,
  alert_email text
);
insert into public.settings default values;

-- ---------- lock everything; access only through functions ----------
alter table public.stores enable row level security;
alter table public.categories enable row level security;
alter table public.departments enable row level security;
alter table public.users enable row level security;
alter table public.manpower enable row level security;
alter table public.associates enable row level security;
alter table public.punches enable row level security;
alter table public.compoffs enable row level security;
alter table public.photo_slots enable row level security;
alter table public.sessions enable row level security;
alter table public.access_log enable row level security;
alter table public.settings enable row level security;
-- (no policies = no direct table access for anon/authenticated)

-- ---------- seed: categories + departments ----------
insert into public.categories (id, name, name_hi, brands, photo_group, sort) values
 ('HK','Housekeeping','हाउसकीपिंग','{}','HK',1),
 ('SEC','Security','सिक्योरिटी','{}','SEC',2),
 ('TRAVEL','Travel Brand Promoter','ट्रैवल प्रमोटर','{Safari,VIP,AT}','PROM',3),
 ('CDIT','CDIT Promoter','CDIT प्रमोटर','{Bajaj,Butterfly,Eureka,Prestige,Usha}','PROM',4);

insert into public.departments (name, category_ids) values
 ('Facility','{HK}'), ('Security','{SEC}'), ('Travel','{TRAVEL}'), ('CDIT','{CDIT}');
