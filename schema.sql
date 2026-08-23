create table if not exists public.bot_users (
  telegram_id text primary key,
  phone text,
  display_name text not null,
  username text,
  role text not null check (role in ('manager', 'sales')),
  is_active boolean not null default true,
  granted_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_users_telegram_id_format check (telegram_id ~ '^[1-9][0-9]{4,19}$'),
  constraint bot_users_phone_format check (phone is null or phone ~ '^[0-9]{7,15}$'),
  constraint bot_users_display_name_not_blank check (btrim(display_name) <> '')
);

create unique index if not exists bot_users_active_phone_uidx
  on public.bot_users (phone)
  where phone is not null and is_active;

create index if not exists bot_users_display_name_lower_idx
  on public.bot_users (lower(display_name));

create index if not exists bot_users_active_role_idx
  on public.bot_users (role)
  where is_active;

create table if not exists public.access_requests (
  telegram_id text primary key,
  phone text,
  display_name text not null,
  username text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'revoked')),
  granted_role text check (granted_role is null or granted_role in ('manager', 'sales')),
  requested_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  constraint access_requests_telegram_id_format check (telegram_id ~ '^[1-9][0-9]{4,19}$'),
  constraint access_requests_phone_format check (phone is null or phone ~ '^[0-9]{7,15}$'),
  constraint access_requests_display_name_not_blank check (btrim(display_name) <> '')
);

create index if not exists access_requests_pending_idx
  on public.access_requests (requested_at)
  where status = 'pending';

create index if not exists access_requests_phone_idx
  on public.access_requests (phone)
  where phone is not null;

create index if not exists access_requests_display_name_lower_idx
  on public.access_requests (lower(display_name));

create table if not exists public.access_events (
  id bigint generated always as identity primary key,
  target_telegram_id text not null,
  actor_telegram_id text not null,
  action text not null
    check (action in ('request', 'approve', 'reject', 'promote', 'demote', 'remove')),
  old_role text check (old_role is null or old_role in ('manager', 'sales')),
  new_role text check (new_role is null or new_role in ('manager', 'sales')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists access_events_target_created_idx
  on public.access_events (target_telegram_id, created_at desc);

create index if not exists access_events_actor_created_idx
  on public.access_events (actor_telegram_id, created_at desc);

create table if not exists public.bot_conversation_states (
  telegram_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  constraint bot_conversation_states_telegram_id_format
    check (telegram_id ~ '^[1-9][0-9]{4,19}$'),
  constraint bot_conversation_states_state_object
    check (jsonb_typeof(state) = 'object')
);

create index if not exists bot_conversation_states_updated_idx
  on public.bot_conversation_states (updated_at);

create table if not exists public.delivery_prices (
  id bigint generated always as identity primary key,
  area_name text not null,
  price numeric(12,2) not null,
  uploaded_by text not null,
  updated_at timestamptz not null default now(),
  constraint delivery_prices_area_name_not_blank
    check (btrim(area_name) <> ''),
  constraint delivery_prices_area_name_length
    check (char_length(area_name) <= 200),
  constraint delivery_prices_price_range
    check (price >= 0 and price <= 9999999999.99),
  constraint delivery_prices_uploaded_by_format
    check (uploaded_by ~ '^[1-9][0-9]{4,19}$')
);

create unique index if not exists delivery_prices_area_lower_uidx
  on public.delivery_prices (lower(area_name));

create table if not exists public.catalog_items (
  id bigint generated always as identity primary key,
  item_name text not null,
  price numeric(12,2) not null,
  min_quantity integer,
  max_quantity integer,
  requires_label_color boolean not null default false,
  uploaded_by text not null,
  updated_at timestamptz not null default now(),
  constraint catalog_items_name_not_blank check (btrim(item_name) <> ''),
  constraint catalog_items_name_length check (char_length(item_name) <= 200),
  constraint catalog_items_price_range check (price >= 0 and price <= 9999999999.99),
  constraint catalog_items_min_quantity_range check (min_quantity is null or min_quantity >= 0),
  constraint catalog_items_max_quantity_range check (max_quantity is null or max_quantity >= 0),
  constraint catalog_items_quantity_order check (
    min_quantity is null or max_quantity is null or min_quantity <= max_quantity
  ),
  constraint catalog_items_uploaded_by_format check (uploaded_by ~ '^[1-9][0-9]{4,19}$')
);

create unique index if not exists catalog_items_name_lower_uidx
  on public.catalog_items (lower(item_name));

create table if not exists public.packages (
  id bigint generated always as identity primary key,
  package_name text not null,
  total_price numeric(12,2) not null,
  requires_label_color boolean not null default false,
  uploaded_by text not null,
  updated_at timestamptz not null default now(),
  constraint packages_name_not_blank check (btrim(package_name) <> ''),
  constraint packages_name_length check (char_length(package_name) <= 200),
  constraint packages_price_range check (total_price >= 0 and total_price <= 9999999999.99),
  constraint packages_uploaded_by_format check (uploaded_by ~ '^[1-9][0-9]{4,19}$')
);

create unique index if not exists packages_name_lower_uidx
  on public.packages (lower(package_name));

create table if not exists public.package_items (
  id bigint generated always as identity primary key,
  package_id bigint not null references public.packages(id) on delete cascade,
  item_name text not null,
  quantity integer not null,
  position integer not null,
  constraint package_items_name_not_blank check (btrim(item_name) <> ''),
  constraint package_items_name_length check (char_length(item_name) <= 200),
  constraint package_items_quantity_positive check (quantity > 0),
  constraint package_items_position_positive check (position > 0),
  constraint package_items_package_position_unique unique (package_id, position)
);

create index if not exists package_items_package_id_idx on public.package_items (package_id);
create unique index if not exists package_items_package_name_lower_uidx
  on public.package_items (package_id, lower(item_name));

create table if not exists public.sales_orders (
  id bigint generated always as identity primary key,
  order_code text unique,
  source text not null,
  parent_name text not null,
  parent_phone text not null,
  parent_phone_2 text,
  parent_phone_3 text,
  address text not null default '',
  notes text,
  delivery_area text not null,
  items_total numeric(12,2) not null,
  discount_type text check (discount_type is null or discount_type in ('percent', 'fixed')),
  discount_value numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  shipping_price numeric(12,2) not null,
  grand_total numeric(12,2) not null,
  advance_payment numeric(12,2) not null default 0,
  advance_payment_details text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_orders_source_not_blank check (btrim(source) <> ''),
  constraint sales_orders_parent_name_not_blank check (btrim(parent_name) <> ''),
  constraint sales_orders_parent_phone_format check (parent_phone ~ '^[0-9]{7,15}$'),
  constraint sales_orders_parent_phone_2_format check (parent_phone_2 is null or parent_phone_2 ~ '^[0-9]{7,15}$'),
  constraint sales_orders_parent_phone_3_format check (parent_phone_3 is null or parent_phone_3 ~ '^[0-9]{7,15}$'),
  constraint sales_orders_delivery_area_not_blank check (btrim(delivery_area) <> ''),
  constraint sales_orders_totals_nonnegative check (items_total >= 0 and shipping_price >= 0 and grand_total >= 0),
  constraint sales_orders_discount_amount_range check (discount_value >= 0 and discount_amount >= 0 and discount_amount <= items_total),
  constraint sales_orders_total_math check (grand_total = items_total - discount_amount + shipping_price),
  constraint sales_orders_advance_payment_range check (advance_payment >= 0 and advance_payment <= grand_total),
  constraint sales_orders_created_by_format check (created_by ~ '^[1-9][0-9]{4,19}$'),
  constraint sales_orders_updated_by_format check (updated_by ~ '^[1-9][0-9]{4,19}$')
);

create index if not exists sales_orders_created_by_created_idx on public.sales_orders (created_by, created_at desc);
create index if not exists sales_orders_parent_phone_idx on public.sales_orders (parent_phone);
create extension if not exists pg_trgm;
create index if not exists sales_orders_parent_phone_2_idx on public.sales_orders (parent_phone_2);
create index if not exists sales_orders_parent_phone_3_idx on public.sales_orders (parent_phone_3);
create index if not exists sales_orders_parent_name_trgm_idx on public.sales_orders using gin (parent_name gin_trgm_ops);
create index if not exists catalog_items_name_trgm_idx on public.catalog_items using gin (item_name gin_trgm_ops);
create index if not exists packages_name_trgm_idx on public.packages using gin (package_name gin_trgm_ops);
create index if not exists package_items_name_trgm_idx on public.package_items using gin (item_name gin_trgm_ops);
create index if not exists delivery_prices_area_trgm_idx on public.delivery_prices using gin (area_name gin_trgm_ops);

create table if not exists public.order_children (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.sales_orders(id) on delete cascade,
  position integer not null,
  child_name text not null,
  cartoon_character text not null,
  school_name text not null,
  school_stage text not null default '',
  clothing_label_color text not null,
  constraint order_children_position_range check (position between 1 and 6),
  constraint order_children_name_not_blank check (btrim(child_name) <> ''),
  constraint order_children_character_not_blank check (btrim(cartoon_character) <> ''),
  constraint order_children_school_not_blank check (btrim(school_name) <> ''),
  constraint order_children_label_color_not_blank check (btrim(clothing_label_color) <> ''),
  constraint order_children_order_position_unique unique (order_id, position)
);

create index if not exists order_children_order_id_idx on public.order_children (order_id);
create index if not exists order_children_name_trgm_idx on public.order_children using gin (child_name gin_trgm_ops);

create table if not exists public.order_lines (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.sales_orders(id) on delete cascade,
  child_id bigint not null references public.order_children(id) on delete cascade,
  position integer not null,
  line_type text not null check (line_type in ('item', 'package')),
  reference_id bigint,
  description text not null,
  quantity integer not null,
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) not null,
  details jsonb not null default '{}'::jsonb,
  constraint order_lines_position_positive check (position > 0),
  constraint order_lines_description_not_blank check (btrim(description) <> ''),
  constraint order_lines_quantity_positive check (quantity > 0),
  constraint order_lines_prices_nonnegative check (unit_price >= 0 and line_total >= 0),
  constraint order_lines_total_math check (line_total = unit_price * quantity),
  constraint order_lines_details_object check (jsonb_typeof(details) = 'object'),
  constraint order_lines_order_position_unique unique (order_id, position)
);

create index if not exists order_lines_order_id_idx on public.order_lines (order_id);
create index if not exists order_lines_child_id_idx on public.order_lines (child_id);

alter table public.bot_users enable row level security;
alter table public.access_requests enable row level security;
alter table public.access_events enable row level security;
alter table public.bot_conversation_states enable row level security;
alter table public.delivery_prices enable row level security;
alter table public.catalog_items enable row level security;
alter table public.packages enable row level security;
alter table public.package_items enable row level security;
alter table public.sales_orders enable row level security;
alter table public.order_children enable row level security;
alter table public.order_lines enable row level security;

revoke all on public.bot_users from anon, authenticated;
revoke all on public.access_requests from anon, authenticated;
revoke all on public.access_events from anon, authenticated;
revoke all on public.bot_conversation_states from anon, authenticated;
revoke all on public.delivery_prices from anon, authenticated;
revoke all on public.catalog_items from anon, authenticated;
revoke all on public.packages from anon, authenticated;
revoke all on public.package_items from anon, authenticated;
revoke all on public.sales_orders from anon, authenticated;
revoke all on public.order_children from anon, authenticated;
revoke all on public.order_lines from anon, authenticated;
revoke all on sequence public.access_events_id_seq from anon, authenticated;
revoke all on sequence public.delivery_prices_id_seq from anon, authenticated;
revoke all on sequence public.catalog_items_id_seq from anon, authenticated;
revoke all on sequence public.packages_id_seq from anon, authenticated;
revoke all on sequence public.package_items_id_seq from anon, authenticated;
revoke all on sequence public.sales_orders_id_seq from anon, authenticated;
revoke all on sequence public.order_children_id_seq from anon, authenticated;
revoke all on sequence public.order_lines_id_seq from anon, authenticated;

-- Supabase creates this helper when "Automatically enable RLS" is turned on.
-- The event trigger can still use it, but API roles must not call it directly.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;
