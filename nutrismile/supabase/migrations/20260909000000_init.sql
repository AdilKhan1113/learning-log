-- NutriSmile cloud mirror.
--
-- Mirrors the local SQLite schema in src/db/schema/001_init.sql closely enough
-- that push and pull are a straight column copy. Two deliberate divergences,
-- both noted where they occur:
--
--   1. Timestamps stay bigint epoch milliseconds rather than becoming
--      timestamptz. The device is the source of truth for when something was
--      logged, and converting twice is how timezone bugs get in. Calendar days
--      remain text 'YYYY-MM-DD' in the user's own timezone for the same reason.
--
--   2. food_portions and recipe_ingredients carry a user_id here, which the
--      local schema does not need. Row-level security has to decide ownership
--      from the row itself; deriving it through a join on every check is
--      slower and easier to get wrong than storing it.
--
-- Cached catalogue foods (user_id IS NULL locally) are NOT synced at all. They
-- are reproducible from Open Food Facts, so replicating them would spend the
-- user's bandwidth copying a public database.

create table if not exists users (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text,
  display_name        text,
  birth_date          text,
  sex                 text check (sex in ('female','male','unspecified')),
  height_cm           double precision,
  activity_level      text,
  goal_type           text check (goal_type in ('lose','maintain','gain')),
  goal_rate_kg_week   double precision,
  unit_system         text not null default 'metric',
  theme               text not null default 'dark',
  water_unit          text not null default 'ml',
  water_container_ml  double precision not null default 250,
  timezone            text,
  onboarded_at        bigint,
  created_at          bigint not null,
  updated_at          bigint not null,
  deleted_at          bigint
);

create table if not exists daily_goals (
  id                  uuid primary key,
  user_id             uuid not null references users (id) on delete cascade,
  effective_date      text not null,
  calorie_target      double precision not null,
  protein_g_target    double precision not null,
  carbs_g_target      double precision not null,
  fat_g_target        double precision not null,
  fiber_g_target      double precision,
  water_ml_target     double precision not null default 2000,
  source              text not null default 'calculated',
  bmr_kcal            double precision,
  tdee_kcal           double precision,
  calc_weight_kg      double precision,
  calc_height_cm      double precision,
  calc_age_years      double precision,
  calc_activity_level text,
  floor_applied       boolean not null default false,
  created_at          bigint not null,
  updated_at          bigint not null,
  deleted_at          bigint,
  unique (user_id, effective_date)
);

create table if not exists foods (
  id                  uuid primary key,
  user_id             uuid not null references users (id) on delete cascade,
  name                text not null,
  brand               text,
  search_text         text not null default '',
  source              text not null default 'custom',
  source_id           text,
  barcode             text,
  basis_unit          text not null default 'g',
  kcal_per_100        double precision not null,
  protein_g_per_100   double precision not null default 0,
  carbs_g_per_100     double precision not null default 0,
  fat_g_per_100       double precision not null default 0,
  fiber_g_per_100     double precision,
  sugar_g_per_100     double precision,
  sat_fat_g_per_100   double precision,
  sodium_mg_per_100   double precision,
  grams_per_ml        double precision,
  is_favorite         boolean not null default false,
  is_verified         boolean not null default false,
  last_used_at        bigint,
  use_count           integer not null default 0,
  created_at          bigint not null,
  updated_at          bigint not null,
  deleted_at          bigint
);

create table if not exists food_portions (
  id                  uuid primary key,
  user_id             uuid not null references users (id) on delete cascade,
  food_id             uuid not null references foods (id) on delete cascade,
  label               text not null,
  quantity            double precision not null default 1,
  amount_in_basis     double precision not null,
  is_default          boolean not null default false,
  sort_order          integer not null default 0,
  created_at          bigint not null,
  updated_at          bigint not null,
  deleted_at          bigint
);

create table if not exists recipes (
  id                  uuid primary key,
  user_id             uuid not null references users (id) on delete cascade,
  name                text not null,
  search_text         text not null default '',
  notes               text,
  servings            double precision not null default 1,
  serving_label       text,
  photo_uri           text,
  total_grams         double precision,
  total_kcal          double precision,
  total_protein_g     double precision,
  total_carbs_g       double precision,
  total_fat_g         double precision,
  totals_stale        boolean not null default true,
  is_favorite         boolean not null default false,
  last_used_at        bigint,
  use_count           integer not null default 0,
  created_at          bigint not null,
  updated_at          bigint not null,
  deleted_at          bigint
);

create table if not exists recipe_ingredients (
  id                  uuid primary key,
  user_id             uuid not null references users (id) on delete cascade,
  recipe_id           uuid not null references recipes (id) on delete cascade,
  food_id             uuid not null,
  portion_id          uuid,
  quantity            double precision not null,
  unit_label          text not null,
  amount_in_basis     double precision not null,
  sort_order          integer not null default 0,
  created_at          bigint not null,
  updated_at          bigint not null,
  deleted_at          bigint
);

-- The nutrition columns are a snapshot taken when the entry was logged, exactly
-- as on the device. Nothing server-side ever recomputes them.
create table if not exists log_entries (
  id                  uuid primary key,
  user_id             uuid not null references users (id) on delete cascade,
  log_date            text not null,
  meal                text not null check (meal in ('breakfast','lunch','dinner','snacks')),
  sort_order          integer not null default 0,
  logged_at           bigint not null,
  food_id             uuid,
  recipe_id           uuid,
  name_snapshot       text not null,
  brand_snapshot      text,
  quantity            double precision not null,
  unit_label          text not null,
  amount_in_basis     double precision,
  basis_unit          text,
  kcal                double precision not null,
  protein_g           double precision not null default 0,
  carbs_g             double precision not null default 0,
  fat_g               double precision not null default 0,
  fiber_g             double precision,
  sugar_g             double precision,
  sat_fat_g           double precision,
  sodium_mg           double precision,
  entry_source        text not null default 'manual',
  is_estimate         boolean not null default false,
  ai_confidence       double precision,
  ai_photo_uri        text,
  notes               text,
  created_at          bigint not null,
  updated_at          bigint not null,
  deleted_at          bigint
);

create table if not exists weight_entries (
  id                  uuid primary key,
  user_id             uuid not null references users (id) on delete cascade,
  log_date            text not null,
  weight_kg           double precision not null,
  body_fat_pct        double precision,
  note                text,
  recorded_at         bigint not null,
  created_at          bigint not null,
  updated_at          bigint not null,
  deleted_at          bigint,
  unique (user_id, log_date)
);

create table if not exists water_entries (
  id                  uuid primary key,
  user_id             uuid not null references users (id) on delete cascade,
  log_date            text not null,
  amount_ml           double precision not null,
  logged_at           bigint not null,
  created_at          bigint not null,
  updated_at          bigint not null,
  deleted_at          bigint
);

-- Pull reads "everything changed since my cursor", so updated_at is the hot
-- column on every table.
create index if not exists idx_daily_goals_sync on daily_goals (user_id, updated_at);
create index if not exists idx_foods_sync on foods (user_id, updated_at);
create index if not exists idx_food_portions_sync on food_portions (user_id, updated_at);
create index if not exists idx_recipes_sync on recipes (user_id, updated_at);
create index if not exists idx_recipe_ingredients_sync on recipe_ingredients (user_id, updated_at);
create index if not exists idx_log_entries_sync on log_entries (user_id, updated_at);
create index if not exists idx_weight_entries_sync on weight_entries (user_id, updated_at);
create index if not exists idx_water_entries_sync on water_entries (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Every table is owner-only. The policies are written out per table rather than
-- generated, so each one can be read and checked on its own — this is the part
-- where a mistake exposes one person's food log to another.
-- ---------------------------------------------------------------------------

alter table users              enable row level security;
alter table daily_goals        enable row level security;
alter table foods              enable row level security;
alter table food_portions      enable row level security;
alter table recipes            enable row level security;
alter table recipe_ingredients enable row level security;
alter table log_entries        enable row level security;
alter table weight_entries     enable row level security;
alter table water_entries      enable row level security;

-- The profile row is keyed by the auth user id itself.
create policy "own profile" on users
  for all to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

do $$
declare t text;
begin
  foreach t in array array[
    'daily_goals','foods','food_portions','recipes',
    'recipe_ingredients','log_entries','weight_entries','water_entries'
  ] loop
    execute format(
      'create policy "own rows" on %I for all to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

-- A row's owner is never taken from the client: whatever user_id is sent, the
-- with-check above rejects it unless it matches the caller. Nothing here is
-- exposed to the anon role at all.
