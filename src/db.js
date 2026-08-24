"use strict";

const { Pool } = require("pg");
const {
  isTelegramId,
  normalizeDigits,
  normalizeName,
  normalizePhone,
} = require("./utils");

const isSupabase = /supabase\.(com|co)|supabase\.net/i.test(
  process.env.DATABASE_URL || "",
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.VERCEL === "1" ? 1 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: process.env.VERCEL === "1",
  ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
});

let customerPool;

function getCustomerPool() {
  const connectionString = process.env.CUSTOMER_DATABASE_URL;
  if (!connectionString) return null;
  if (!customerPool) {
    customerPool = new Pool({
      connectionString,
      max: process.env.VERCEL === "1" ? 1 : 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: process.env.VERCEL === "1",
      ssl: /supabase\.(com|co)|supabase\.net/i.test(connectionString) ? { rejectUnauthorized: false } : undefined,
    });
  }
  return customerPool;
}

async function testCustomerConnection() {
  const customerDatabase = getCustomerPool();
  if (!customerDatabase) return "not_configured";
  const result = await customerDatabase.query("select to_regclass('public.customer_profiles') as customer_profiles");
  if (!result.rows[0]?.customer_profiles) throw new Error("Customer database schema is incomplete: customer_profiles is missing.");
  return "ready";
}

async function searchCustomerProfiles(query, page = 0, pageSize = 8) {
  const customerDatabase = getCustomerPool();
  if (!customerDatabase) return { configured: false, entries: [], total: 0 };
  const raw = String(query || "").trim();
  const phone = normalizePhone(raw) || "";
  const result = await customerDatabase.query(`
    select id, customer_name, primary_phone, duplicate_check_phone, phones,
           governorate, zone, area, addresses, notes,
           count(*) over()::int as total_count
    from public.customer_profiles
    where ($1 <> '' and (phones @> array[$1]::text[] or primary_phone = $1 or duplicate_check_phone = $1))
       or ($2 <> '' and customer_name ilike '%' || $2 || '%')
    order by case when primary_phone = $1 or duplicate_check_phone = $1 then 0
                  when customer_name ilike $2 || '%' then 1 else 2 end,
             updated_at desc
    limit $3 offset $4
  `, [phone, raw, pageSize, page * pageSize]);
  return { configured: true, entries: result.rows, total: result.rows[0]?.total_count || 0 };
}

async function findRecentOrdersByPhone(phone) {
  const result = await pool.query(`
    select order_code, parent_name, grand_total::text as grand_total, created_at
    from public.sales_orders
    where status = 'confirmed' and created_at >= now() - interval '7 days'
      and ($1 = parent_phone or $1 = parent_phone_2 or $1 = parent_phone_3)
    order by created_at desc limit 5
  `, [phone]);
  return result.rows;
}

async function findRecentDuplicateOrders(draft) {
  const phone = String(draft.parentPhone || "");
  if (!phone) return [];
  const total = Number(draftGrandTotalForDuplicate(draft));
  const result = await pool.query(`
    select order_code, parent_name, grand_total::text as grand_total, created_at,
           source, parent_phone, parent_phone_2, parent_phone_3, address, delivery_area,
           discount_type, discount_value::text as discount_value,
            (select jsonb_agg(jsonb_build_object('name', c.child_name, 'character', c.cartoon_character, 'school', c.school_name, 'stage', c.school_stage, 'color', c.clothing_label_color) order by c.position)
               from public.order_children c where c.order_id=o.id) as children,
           (select jsonb_agg(jsonb_build_object('type', l.line_type, 'description', l.description, 'quantity', l.quantity, 'unit_price', l.unit_price, 'line_total', l.line_total, 'child_id', l.child_id) order by l.position)
              from public.order_lines l where l.order_id=o.id) as lines
    from public.sales_orders o
    where o.status='confirmed' and o.created_at >= now() - interval '7 days'
      and (o.parent_phone=$1 or o.parent_phone_2=$1 or o.parent_phone_3=$1)
      and o.parent_name=$2 and o.grand_total=$3
    order by o.created_at desc limit 5
  `, [phone, draft.parentName, total]);
  const draftChildren = (draft.children || []).map(c => ({ name: c.childName, character: c.cartoonCharacter, school: c.schoolName, stage: c.schoolStage || "", color: c.labelColor || "غير محدد" }));
  const draftLines = (draft.lines || []).map(l => ({ type: l.type, description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unitPrice), line_total: Number(l.lineTotal), child_index: Number(l.childIndex) }));
  return result.rows.filter(row => {
    const children = row.children || [];
    const lines = row.lines || [];
    return row.source === draft.source && row.parent_phone === phone &&
      (row.parent_phone_2 || null) === (draft.parentPhone2 || null) &&
      (row.parent_phone_3 || null) === (draft.parentPhone3 || null) &&
      (row.address || null) === (draft.address || null) &&
      (row.delivery_area || null) === (draft.delivery?.areaName || null) &&
      JSON.stringify(children) === JSON.stringify(draftChildren) &&
      lines.length === draftLines.length &&
      lines.every((line, i) => line.line_type === draftLines[i].type && line.description === draftLines[i].description && Number(line.quantity) === draftLines[i].quantity && Number(line.line_total) === draftLines[i].line_total);
  });
}

function draftGrandTotalForDuplicate(draft) {
  const items = (draft.lines || []).reduce((sum, l) => sum + Number(l.lineTotal || 0), 0);
  const discount = draft.discount?.type === 'percent' ? items * Number(draft.discount.value || 0) / 100 : draft.discount?.type === 'fixed' ? Number(draft.discount.value || 0) : 0;
  return Math.round((items - Math.min(items, Math.max(0, discount)) + Number(draft.delivery?.price || 0)) * 100) / 100;
}

async function deleteAllOrders() {
  const result = await pool.query("delete from public.sales_orders returning id");
  return result.rowCount || 0;
}

async function getPreviousMonthReport() {
  const totals = await pool.query(`
    select count(*) filter (where status='confirmed')::int as confirmed,
           count(*) filter (where status='cancelled')::int as cancelled,
           coalesce(sum(items_total) filter (where status='confirmed'),0)::text as items_total,
           coalesce(sum(discount_amount) filter (where status='confirmed'),0)::text as discounts,
           coalesce(sum(shipping_price) filter (where status='confirmed'),0)::text as shipping,
           coalesce(sum(grand_total) filter (where status='confirmed'),0)::text as grand_total
    from public.sales_orders
    where created_at >= date_trunc('month', now() at time zone 'Africa/Cairo') - interval '1 month'
      and created_at < date_trunc('month', now() at time zone 'Africa/Cairo')
  `);
  const top = await pool.query(`
    select l.description, sum(l.quantity)::int as quantity
    from public.order_lines l join public.sales_orders o on o.id=l.order_id
    where o.status='confirmed' and o.created_at >= date_trunc('month', now() at time zone 'Africa/Cairo') - interval '1 month'
      and o.created_at < date_trunc('month', now() at time zone 'Africa/Cairo')
    group by l.description order by quantity desc, l.description asc limit 5
  `);
  return { ...totals.rows[0], top: top.rows };
}

async function schemaReady() {
  const result = await pool.query(`
    select (
      (select count(*)::int from information_schema.tables
        where table_schema = 'public' and table_name in (
          'bot_users', 'access_requests', 'access_events', 'bot_conversation_states',
          'delivery_prices', 'catalog_items', 'packages', 'package_items',
          'sales_orders', 'order_children', 'order_lines'
        )) = 11
      and (select count(*)::int from information_schema.columns
        where table_schema = 'public' and table_name = 'order_children'
          and column_name = 'school_stage') = 1
      and (select count(*)::int from information_schema.columns
        where table_schema = 'public' and table_name = 'sales_orders'
          and column_name in (
            'parent_phone_2', 'parent_phone_3', 'address', 'notes', 'discount_type',
            'discount_value', 'discount_amount', 'advance_payment', 'advance_payment_details'
          )) = 9
      and (select count(*)::int from information_schema.columns
        where table_schema = 'public' and column_name = 'requires_label_color'
          and table_name in ('catalog_items', 'packages')) = 2
      and (select count(*)::int from pg_constraint
        where conname in (
          'sales_orders_parent_phone_2_format', 'sales_orders_parent_phone_3_format',
          'sales_orders_discount_type_check', 'sales_orders_discount_amount_range',
          'sales_orders_advance_payment_range'
        )) = 5
      and (select count(*)::int from pg_indexes
        where schemaname = 'public' and indexname in (
          'catalog_items_name_trgm_idx', 'packages_name_trgm_idx', 'package_items_name_trgm_idx',
          'delivery_prices_area_trgm_idx', 'sales_orders_parent_name_trgm_idx',
          'sales_orders_parent_phone_2_idx', 'sales_orders_parent_phone_3_idx',
          'order_children_name_trgm_idx'
        )) = 8
      and exists (select 1 from pg_extension where extname = 'pg_trgm')
    ) as ready
  `);
  return Boolean(result.rows[0]?.ready);
}

async function testConnection() {
  await pool.query("select 1");
  if (await schemaReady()) {
    return;
  }
  await pool.query(`
    create extension if not exists pg_trgm;
    create index if not exists catalog_items_name_trgm_idx on public.catalog_items using gin (item_name gin_trgm_ops);
    create index if not exists packages_name_trgm_idx on public.packages using gin (package_name gin_trgm_ops);
    create index if not exists package_items_name_trgm_idx on public.package_items using gin (item_name gin_trgm_ops);
    create index if not exists delivery_prices_area_trgm_idx on public.delivery_prices using gin (area_name gin_trgm_ops);
    create index if not exists sales_orders_parent_name_trgm_idx on public.sales_orders using gin (parent_name gin_trgm_ops);
    create index if not exists sales_orders_parent_phone_2_idx on public.sales_orders (parent_phone_2);
    create index if not exists sales_orders_parent_phone_3_idx on public.sales_orders (parent_phone_3);
    create index if not exists order_children_name_trgm_idx on public.order_children using gin (child_name gin_trgm_ops);
  `);
  await pool.query(`
    alter table public.sales_orders
      add column if not exists parent_phone_2 text,
      add column if not exists parent_phone_3 text,
      add column if not exists address text not null default '',
      add column if not exists notes text,
      add column if not exists discount_type text,
      add column if not exists discount_value numeric(12,2) not null default 0,
      add column if not exists discount_amount numeric(12,2) not null default 0,
      add column if not exists advance_payment numeric(12,2) not null default 0,
      add column if not exists advance_payment_details text
  `);
  await pool.query(`
    alter table public.catalog_items add column if not exists requires_label_color boolean not null default false;
    alter table public.packages add column if not exists requires_label_color boolean not null default false;
  `);
  await pool.query(`alter table public.order_children add column if not exists school_stage text not null default ''`);
  await pool.query(`
    do $$ begin
      if not exists (select 1 from pg_constraint where conname = 'sales_orders_parent_phone_2_format') then
        alter table public.sales_orders add constraint sales_orders_parent_phone_2_format check (parent_phone_2 is null or parent_phone_2 ~ '^[0-9]{7,15}$');
      end if;
      if not exists (select 1 from pg_constraint where conname = 'sales_orders_parent_phone_3_format') then
        alter table public.sales_orders add constraint sales_orders_parent_phone_3_format check (parent_phone_3 is null or parent_phone_3 ~ '^[0-9]{7,15}$');
      end if;
      if not exists (select 1 from pg_constraint where conname = 'sales_orders_discount_type_check') then
        alter table public.sales_orders add constraint sales_orders_discount_type_check check (discount_type is null or discount_type in ('percent', 'fixed'));
      end if;
      if not exists (select 1 from pg_constraint where conname = 'sales_orders_discount_amount_range') then
        alter table public.sales_orders add constraint sales_orders_discount_amount_range check (discount_value >= 0 and discount_amount >= 0 and discount_amount <= items_total);
      end if;
      if not exists (select 1 from pg_constraint where conname = 'sales_orders_advance_payment_range') then
        alter table public.sales_orders add constraint sales_orders_advance_payment_range check (advance_payment >= 0 and advance_payment <= grand_total);
      end if;
    end $$;
  `);
  await pool.query(`alter table public.sales_orders drop constraint if exists sales_orders_total_math; alter table public.sales_orders add constraint sales_orders_total_math check (grand_total = items_total - discount_amount + shipping_price)`);
  const result = await pool.query(`
    select count(*)::int as table_count
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'bot_users',
        'access_requests',
        'access_events',
        'bot_conversation_states',
        'delivery_prices',
        'catalog_items',
        'packages',
        'package_items',
        'sales_orders',
        'order_children',
        'order_lines'
      )
  `);

  if (result.rows[0].table_count !== 11) {
    throw new Error("Authentication schema is incomplete. Apply schema.sql first.");
  }
}

async function listItems() {
  const result = await pool.query(`
    select id, item_name, price::text as price, min_quantity, max_quantity, requires_label_color
    from public.catalog_items
    order by id asc
  `);
  return result.rows;
}

async function getItemById(id) {
  const result = await pool.query(`
    select id, item_name, price::text as price, min_quantity, max_quantity, requires_label_color
    from public.catalog_items
    where id = $1
    limit 1
  `, [String(id)]);
  return result.rows[0] || null;
}

async function getPackageById(id) {
  const result = await pool.query(`
    select p.id, p.package_name, p.total_price::text as total_price, p.requires_label_color,
           coalesce(json_agg(json_build_object('item_name', pi.item_name, 'quantity', pi.quantity) order by pi.position) filter (where pi.id is not null), '[]'::json) as items
    from public.packages p
    left join public.package_items pi on pi.package_id = p.id
    where p.id = $1
    group by p.id
    limit 1
  `, [String(id)]);
  return result.rows[0] || null;
}

function searchPattern(query) { return `%${String(query || "").trim()}%`; }

async function searchItems(query, page = 0, pageSize = 8) {
  const term = String(query || "").trim();
  const result = await pool.query(`
    select id, item_name, price::text as price, min_quantity, max_quantity, requires_label_color,
           count(*) over()::int as total_count
    from public.catalog_items
    where $1 = '' or item_name ilike $2
    order by case when lower(item_name) = lower($1) then 0 when lower(item_name) like lower($1) || '%' then 1 else 2 end,
             item_name asc
    limit $3 offset $4
  `, [term, searchPattern(term), pageSize, page * pageSize]);
  return { entries: result.rows, total: result.rows[0]?.total_count || 0 };
}

async function replaceItems(rows, actorTelegramId) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("At least one item is required.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('sales_bot_catalog_items_replace'))");
    await client.query("delete from public.catalog_items");
    await client.query(`
      insert into public.catalog_items
        (item_name, price, min_quantity, max_quantity, requires_label_color, uploaded_by)
      select imported.item_name, imported.price, imported.min_quantity, imported.max_quantity, imported.requires_label_color, $6
      from unnest($1::text[], $2::numeric[], $3::integer[], $4::integer[], $5::boolean[])
        as imported(item_name, price, min_quantity, max_quantity, requires_label_color)
    `, [
      rows.map((row) => row.itemName), rows.map((row) => String(row.price)),
      rows.map((row) => row.minQuantity), rows.map((row) => row.maxQuantity), rows.map((row) => Boolean(row.requiresLabelColor)),
      String(actorTelegramId),
    ]);
    await client.query("commit");
    return rows.length;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function listPackages() {
  const result = await pool.query(`
    select p.id, p.package_name, p.total_price::text as total_price, p.requires_label_color,
           coalesce(json_agg(json_build_object(
             'item_name', pi.item_name,
             'quantity', pi.quantity
           ) order by pi.position) filter (where pi.id is not null), '[]'::json) as items
    from public.packages p
    left join public.package_items pi on pi.package_id = p.id
    group by p.id
    order by p.id asc
  `);
  return result.rows;
}

async function searchPackages(query, page = 0, pageSize = 8) {
  const term = String(query || "").trim();
  const result = await pool.query(`
    with matching as (
      select p.id, p.package_name, p.total_price, p.requires_label_color,
             count(*) over()::int as total_count,
             case when lower(p.package_name) = lower($1) then 0 when lower(p.package_name) like lower($1) || '%' then 1 else 2 end as rank
      from public.packages p
      where $1 = '' or p.package_name ilike $2
        or exists (select 1 from public.package_items pi where pi.package_id = p.id and pi.item_name ilike $2)
      order by rank, p.package_name asc
      limit $3 offset $4
    )
    select m.id, m.package_name, m.total_price::text as total_price, m.requires_label_color, m.total_count,
           coalesce(json_agg(json_build_object('item_name', pi.item_name, 'quantity', pi.quantity) order by pi.position) filter (where pi.id is not null), '[]'::json) as items
    from matching m
    left join public.package_items pi on pi.package_id = m.id
    group by m.id, m.package_name, m.total_price, m.requires_label_color, m.total_count, m.rank
    order by m.rank, m.package_name asc
  `, [term, searchPattern(term), pageSize, page * pageSize]);
  return { entries: result.rows, total: result.rows[0]?.total_count || 0 };
}

async function replacePackages(packages, actorTelegramId) {
  if (!Array.isArray(packages) || !packages.length) throw new Error("At least one package is required.");
  const itemRows = packages.flatMap((packageRow) => packageRow.items.map((item, index) => ({
    packageName: packageRow.packageName, itemName: item.itemName,
    quantity: item.quantity, position: index + 1,
  })));
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('sales_bot_packages_replace'))");
    await client.query("delete from public.packages");
    await client.query(`
      insert into public.packages (package_name, total_price, requires_label_color, uploaded_by)
      select imported.package_name, imported.total_price, imported.requires_label_color, $4
      from unnest($1::text[], $2::numeric[], $3::boolean[]) as imported(package_name, total_price, requires_label_color)
    `, [packages.map((row) => row.packageName), packages.map((row) => String(row.totalPrice)), packages.map((row) => Boolean(row.requiresLabelColor)), String(actorTelegramId)]);
    await client.query(`
      insert into public.package_items (package_id, item_name, quantity, position)
      select p.id, imported.item_name, imported.quantity, imported.position
      from unnest($1::text[], $2::text[], $3::integer[], $4::integer[])
        as imported(package_name, item_name, quantity, position)
      join public.packages p on lower(p.package_name) = lower(imported.package_name)
    `, [
      itemRows.map((row) => row.packageName), itemRows.map((row) => row.itemName),
      itemRows.map((row) => row.quantity), itemRows.map((row) => row.position),
    ]);
    await client.query("commit");
    return packages.length;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

async function saveOrder(draft, actorTelegramId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const itemsTotal = draft.lines.reduce((sum, line) => sum + Math.round(Number(line.lineTotal) * 100), 0) / 100;
    const discount = draft.discount || {};
    const rawDiscount = Number(discount.value || 0);
    const discountAmount = Math.min(itemsTotal, Math.max(0, Math.round((discount.type === "percent" ? itemsTotal * rawDiscount / 100 : discount.type === "fixed" ? rawDiscount : 0) * 100) / 100));
    const grandTotal = (Math.round((itemsTotal - discountAmount) * 100) + Math.round(Number(draft.delivery.price) * 100)) / 100;
    const advancePayment = Math.min(grandTotal, Math.max(0, Number(draft.advancePayment || 0)));
    const orderResult = await client.query(`
      insert into public.sales_orders (
        source, parent_name, parent_phone, parent_phone_2, parent_phone_3, address, notes, delivery_area, items_total,
        discount_type, discount_value, discount_amount, shipping_price, grand_total, advance_payment, advance_payment_details, created_by, updated_by
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
      returning id, created_at
    `, [draft.source, draft.parentName, draft.parentPhone, draft.parentPhone2 || null, draft.parentPhone3 || null,
      draft.address, draft.notes || null, draft.delivery.areaName,
      String(itemsTotal), discount.type || null, String(rawDiscount), String(discountAmount), String(draft.delivery.price), String(grandTotal),
      String(advancePayment), draft.advancePaymentDetails || null, String(actorTelegramId)]);
    const order = orderResult.rows[0];
    // The database identity is already unique; keep the customer-facing ID short.
    // Note: a WITH-ins/UPDATE CTE cannot be used here - the UPDATE would not see
    // the newly inserted row within the same statement snapshot.
    const orderCode = `ORD#${String(order.id).padStart(3, "0")}`;
    await client.query("update public.sales_orders set order_code=$2 where id=$1", [order.id, orderCode]);

    const childResult = await client.query(`
      insert into public.order_children (
        order_id, position, child_name, cartoon_character, school_name, school_stage, clothing_label_color
      ) select $1, imported.position, imported.child_name, imported.cartoon_character,
               imported.school_name, imported.school_stage, imported.clothing_label_color
      from unnest($2::integer[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
        as imported(position, child_name, cartoon_character, school_name, school_stage, clothing_label_color)
      returning id, position
    `, [order.id, draft.children.map((_, i) => i + 1), draft.children.map(c => c.childName),
      draft.children.map(c => c.cartoonCharacter), draft.children.map(c => c.schoolName),
      draft.children.map(c => c.schoolStage || ""), draft.children.map(c => c.labelColor || "غير محدد")]);
    const childIds = new Map(childResult.rows.map(row => [row.position, row.id]));
    await client.query(`
      insert into public.order_lines (
        order_id, child_id, position, line_type, reference_id, description,
        quantity, unit_price, line_total, details
      ) select $1, imported.child_id, imported.position, imported.line_type,
               imported.reference_id, imported.description, imported.quantity,
               imported.unit_price, imported.line_total, imported.details
      from unnest($2::bigint[], $3::integer[], $4::text[], $5::bigint[],
                  $6::text[], $7::integer[], $8::numeric[], $9::numeric[], $10::jsonb[])
        as imported(child_id, position, line_type, reference_id, description,
                    quantity, unit_price, line_total, details)
    `, [order.id, draft.lines.map(line => childIds.get(line.childIndex + 1)),
      draft.lines.map((_, i) => i + 1), draft.lines.map(line => line.type),
      draft.lines.map(line => line.referenceId || null), draft.lines.map(line => line.description),
      draft.lines.map(line => line.quantity), draft.lines.map(line => String(line.unitPrice)),
      draft.lines.map(line => String(line.lineTotal)), draft.lines.map(line => JSON.stringify(line.details || {}))]);
    await client.query("commit");
    return { orderCode, itemsTotal, discountAmount, grandTotal };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

async function getOrderByCode(orderCode) {
  const orderResult = await pool.query(`select * from public.sales_orders where upper(order_code)=upper($1) limit 1`, [String(orderCode).trim()]);
  const order = orderResult.rows[0];
  if (!order) return null;
  const [children, lines] = await Promise.all([
    pool.query(`select * from public.order_children where order_id=$1 order by position`, [order.id]),
    pool.query(`select * from public.order_lines where order_id=$1 order by position`, [order.id]),
  ]);
  return { ...order, children: children.rows, lines: lines.rows };
}

async function listOrdersForExport() {
  const result = await pool.query(`
    select o.order_code, o.source, o.parent_name, o.parent_phone,
           o.parent_phone_2, o.parent_phone_3, o.address, o.notes,
           o.delivery_area, o.items_total::text as items_total,
           o.discount_type, o.discount_value::text as discount_value, o.discount_amount::text as discount_amount,
           o.shipping_price::text as shipping_price,
           o.grand_total::text as grand_total, o.advance_payment::text as advance_payment, o.advance_payment_details, o.status,
           o.created_at, o.updated_at, o.created_by,
           creator.display_name as creator_name,
           creator.phone as creator_phone,
            c.position as child_position, c.child_name,
            c.cartoon_character, c.school_name, c.school_stage, c.clothing_label_color,
           l.position as line_position, l.line_type, l.description,
           l.quantity, l.unit_price::text as unit_price,
           l.line_total::text as line_total
    from public.sales_orders o
    left join public.bot_users creator on creator.telegram_id = o.created_by
    left join public.order_children c on c.order_id = o.id
    left join public.order_lines l on l.order_id = o.id and l.child_id = c.id
    order by o.created_at desc, c.position asc nulls last, l.position asc nulls last
  `);
  return result.rows;
}

async function searchOrders(query, page = 0, pageSize = 8) {
  const raw = String(query || "").trim();
  const digits = normalizeDigits(raw).replace(/\D/g, "");
  const numericId = digits ? Number(digits) : null;
  const result = await pool.query(`
    select o.order_code, o.parent_name, o.parent_phone, o.status, o.created_at,
           count(*) over()::int as total_count,
           case
             when upper(o.order_code) = upper($1) then 0
             when $2::bigint is not null and regexp_replace(o.order_code, '\\D', '', 'g')::bigint = $2 then 0
             when o.parent_phone = $3 or o.parent_phone_2 = $3 or o.parent_phone_3 = $3 then 1
             when o.parent_name ilike $1 || '%' then 2
             when exists (select 1 from public.order_children c where c.order_id=o.id and c.child_name ilike $1 || '%') then 2
             else 3
           end as rank
    from public.sales_orders o
    where upper(o.order_code) like '%' || upper($1) || '%'
       or ($2::bigint is not null and regexp_replace(o.order_code, '\\D', '', 'g')::bigint = $2)
       or ($3 <> '' and (o.parent_phone like '%' || $3 || '%' or o.parent_phone_2 like '%' || $3 || '%' or o.parent_phone_3 like '%' || $3 || '%'))
       or o.parent_name ilike '%' || $1 || '%'
       or exists (select 1 from public.order_children c where c.order_id=o.id and c.child_name ilike '%' || $1 || '%')
    order by rank, o.created_at desc
    limit $4 offset $5
  `, [raw, Number.isSafeInteger(numericId) ? numericId : null, digits, pageSize, page * pageSize]);
  return { entries: result.rows, total: result.rows[0]?.total_count || 0 };
}

async function updateOrderField(orderCode, field, value, actorTelegramId) {
  const columns = { source: "source", parentName: "parent_name", parentPhone: "parent_phone" };
  const column = columns[field];
  if (!column) throw new Error("Unsupported order field.");
  const result = await pool.query(`update public.sales_orders set ${column}=$2, updated_by=$3, updated_at=now() where upper(order_code)=upper($1) returning order_code`, [String(orderCode), value, String(actorTelegramId)]);
  return result.rows[0] || null;
}

async function updateOrderAdvancePayment(orderCode, amount, details, actorTelegramId) {
  const result = await pool.query(`
    update public.sales_orders
    set advance_payment=$2, advance_payment_details=$3, updated_by=$4, updated_at=now()
    where upper(order_code)=upper($1) and status='confirmed' and $2 >= 0 and $2 <= grand_total
    returning order_code
  `, [String(orderCode), String(amount), details || null, String(actorTelegramId)]);
  return result.rows[0] || null;
}

async function recalculateOrder(client, orderId, actorTelegramId) {
  await client.query(`
    update public.sales_orders o set
      items_total = totals.items_total,
      discount_amount = least(o.discount_amount, totals.items_total),
      grand_total = totals.items_total - least(o.discount_amount, totals.items_total) + o.shipping_price,
      updated_by = $2,
      updated_at = now()
    from (
      select coalesce(sum(line_total), 0)::numeric(12,2) as items_total
      from public.order_lines where order_id = $1
    ) totals
    where o.id = $1
  `, [orderId, String(actorTelegramId)]);
}

async function updateOrderDelivery(orderCode, delivery, actorTelegramId) {
  const result = await pool.query(`
    update public.sales_orders set delivery_area=$2, shipping_price=$3,
      grand_total=items_total-discount_amount+$3, updated_by=$4, updated_at=now()
    where upper(order_code)=upper($1) and status='confirmed'
    returning order_code
  `, [String(orderCode), delivery.areaName, String(delivery.price), String(actorTelegramId)]);
  return result.rows[0] || null;
}

async function updateOrderChild(orderCode, childId, field, value, actorTelegramId) {
  const columns = { childName: "child_name", cartoonCharacter: "cartoon_character", schoolName: "school_name", schoolStage: "school_stage", labelColor: "clothing_label_color" };
  const column = columns[field];
  if (!column) throw new Error("Unsupported child field.");
  const result = await pool.query(`
    update public.order_children c set ${column}=$3
    from public.sales_orders o
    where c.id=$2 and c.order_id=o.id and upper(o.order_code)=upper($1) and o.status='confirmed'
    returning c.id
  `, [String(orderCode), String(childId), value]);
  if (result.rows.length) await pool.query(`update public.sales_orders set updated_by=$2, updated_at=now() where upper(order_code)=upper($1)`, [String(orderCode), String(actorTelegramId)]);
  return result.rows[0] || null;
}

async function addOrderChild(orderCode, child, actorTelegramId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(`
      insert into public.order_children (order_id, position, child_name, cartoon_character, school_name, school_stage, clothing_label_color)
      select o.id, (select min(slot) from generate_series(1,6) as slot
                    where not exists (select 1 from public.order_children c2 where c2.order_id=o.id and c2.position=slot)), $2,$3,$4,$5,$6
      from public.sales_orders o
      where upper(o.order_code)=upper($1) and o.status='confirmed'
        and (select count(*) from public.order_children where order_id=o.id) < 6
      returning id
    `, [String(orderCode), child.childName, child.cartoonCharacter, child.schoolName, child.schoolStage || "", child.labelColor]);
    if (result.rows.length) await client.query(`update public.sales_orders set updated_by=$2, updated_at=now() where upper(order_code)=upper($1)`, [String(orderCode), String(actorTelegramId)]);
    await client.query("commit"); return result.rows[0] || null;
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

async function deleteOrderChild(orderCode, childId, actorTelegramId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const orderResult = await client.query(`select id from public.sales_orders where upper(order_code)=upper($1) and status='confirmed' for update`, [String(orderCode)]);
    if (!orderResult.rows.length) { await client.query("rollback"); return null; }
    const orderId = orderResult.rows[0].id;
    const countResult = await client.query(`select count(*)::int as count from public.order_children where order_id=$1`, [orderId]);
    if (countResult.rows[0].count <= 1) { await client.query("rollback"); return { lastChild: true }; }
    const deleted = await client.query(`delete from public.order_children where id=$1 and order_id=$2 returning id`, [String(childId), orderId]);
    if (!deleted.rows.length) { await client.query("rollback"); return null; }
    await recalculateOrder(client, orderId, actorTelegramId);
    await client.query("commit"); return { deleted: true };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

async function addOrderLine(orderCode, childId, line, actorTelegramId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(`
      insert into public.order_lines (order_id, child_id, position, line_type, reference_id, description, quantity, unit_price, line_total, details)
      select o.id, c.id, coalesce((select max(position)+1 from public.order_lines where order_id=o.id),1), $3,$4,$5,$6,$7,$8,$9::jsonb
      from public.sales_orders o join public.order_children c on c.order_id=o.id
      where upper(o.order_code)=upper($1) and c.id=$2 and o.status='confirmed'
      returning order_id, id
    `, [String(orderCode), String(childId), line.type, line.referenceId || null, line.description,
      line.quantity, String(line.unitPrice), String(line.lineTotal), JSON.stringify(line.details || {})]);
    if (!result.rows.length) { await client.query("rollback"); return null; }
    await recalculateOrder(client, result.rows[0].order_id, actorTelegramId);
    await client.query("commit"); return result.rows[0];
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

async function updateOrderLineQuantity(orderCode, lineId, quantity, actorTelegramId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(`
      update public.order_lines l set quantity=$3, line_total=unit_price*$3
      from public.sales_orders o
      where l.id=$2 and l.order_id=o.id and upper(o.order_code)=upper($1) and o.status='confirmed'
      returning l.order_id, l.id
    `, [String(orderCode), String(lineId), quantity]);
    if (!result.rows.length) { await client.query("rollback"); return null; }
    await recalculateOrder(client, result.rows[0].order_id, actorTelegramId);
    await client.query("commit"); return result.rows[0];
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

async function updateOrderLineDetails(orderCode, lineId, details, actorTelegramId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(`
      update public.order_lines l set details=$3::jsonb
      from public.sales_orders o
      where l.id=$2 and l.order_id=o.id and upper(o.order_code)=upper($1) and o.status='confirmed'
      returning l.order_id, l.id
    `, [String(orderCode), String(lineId), JSON.stringify(details || {})]);
    if (!result.rows.length) { await client.query("rollback"); return null; }
    await recalculateOrder(client, result.rows[0].order_id, actorTelegramId);
    await client.query("commit"); return result.rows[0];
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

async function deleteOrderLine(orderCode, lineId, actorTelegramId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const orderResult = await client.query(`select id from public.sales_orders where upper(order_code)=upper($1) and status='confirmed' for update`, [String(orderCode)]);
    if (!orderResult.rows.length) { await client.query("rollback"); return null; }
    const orderId = orderResult.rows[0].id;
    const countResult = await client.query(`select count(*)::int as count from public.order_lines where order_id=$1`, [orderId]);
    if (countResult.rows[0].count <= 1) { await client.query("rollback"); return { lastLine: true }; }
    const deleted = await client.query(`delete from public.order_lines where id=$1 and order_id=$2 returning id`, [String(lineId), orderId]);
    if (!deleted.rows.length) { await client.query("rollback"); return null; }
    await recalculateOrder(client, orderId, actorTelegramId);
    await client.query("commit"); return { deleted: true };
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

async function cancelSavedOrder(orderCode, actorTelegramId) {
  const result = await pool.query(`update public.sales_orders set status='cancelled', updated_by=$2, updated_at=now() where upper(order_code)=upper($1) and status='confirmed' returning order_code`, [String(orderCode), String(actorTelegramId)]);
  return result.rows[0] || null;
}

async function getConversationState(telegramId) {
  const result = await pool.query(
    `
      select state
      from public.bot_conversation_states
      where telegram_id = $1
        and updated_at > now() - interval '24 hours'
      limit 1
    `,
    [String(telegramId)],
  );
  return result.rows[0]?.state || null;
}

async function setConversationState(telegramId, state) {
  await pool.query(
    `
      insert into public.bot_conversation_states (telegram_id, state, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (telegram_id) do update set
        state = excluded.state,
        updated_at = now()
    `,
    [String(telegramId), JSON.stringify(state)],
  );
}

async function clearConversationState(telegramId) {
  await pool.query(
    `delete from public.bot_conversation_states where telegram_id = $1`,
    [String(telegramId)],
  );
}

async function listDeliveryPrices() {
  const result = await pool.query(`
    select area_name, price::text as price
    from public.delivery_prices
    order by id asc
  `);
  return result.rows;
}

async function searchDeliveryPrices(query, page = 0, pageSize = 8) {
  const term = String(query || "").trim();
  const result = await pool.query(`
    select area_name, price::text as price, count(*) over()::int as total_count
    from public.delivery_prices
    where $1 = '' or area_name ilike $2
    order by case when lower(area_name) = lower($1) then 0 when lower(area_name) like lower($1) || '%' then 1 else 2 end, area_name asc
    limit $3 offset $4
  `, [term, searchPattern(term), pageSize, page * pageSize]);
  return { entries: result.rows, total: result.rows[0]?.total_count || 0 };
}

async function replaceDeliveryPrices(rows, actorTelegramId) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("At least one delivery price is required.");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtext('sales_bot_delivery_prices_replace'))",
    );
    await client.query("delete from public.delivery_prices");
    await client.query(
      `
        insert into public.delivery_prices (area_name, price, uploaded_by)
        select imported.area_name, imported.price, $3
        from unnest($1::text[], $2::numeric[]) as imported(area_name, price)
      `,
      [
        rows.map((row) => row.areaName),
        rows.map((row) => String(row.price)),
        String(actorTelegramId),
      ],
    );
    await client.query("commit");
    return rows.length;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function getAccessUser(telegramId, client = pool) {
  const result = await client.query(
    `
      select telegram_id, phone, display_name, username, role, granted_by,
             created_at, updated_at
      from public.bot_users
      where telegram_id = $1 and is_active
      limit 1
    `,
    [String(telegramId)],
  );
  return result.rows[0] || null;
}

async function getAccessRequest(telegramId) {
  const result = await pool.query(
    `select * from public.access_requests where telegram_id = $1 limit 1`,
    [String(telegramId)],
  );
  return result.rows[0] || null;
}

async function submitAccessRequest(profile) {
  const telegramId = String(profile.telegramId);
  const activeUser = await getAccessUser(telegramId);
  if (activeUser) return { status: "approved", isNew: false, request: null };

  const existing = await getAccessRequest(telegramId);
  if (existing?.status === "pending") {
    await pool.query(
      `
        update public.access_requests
        set phone = $2, display_name = $3, username = $4
        where telegram_id = $1
      `,
      [telegramId, profile.phone, profile.displayName, profile.username],
    );
    return { status: "pending", isNew: false, request: existing };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `
        insert into public.access_requests (
          telegram_id, phone, display_name, username, status, granted_role,
          requested_at, reviewed_by, reviewed_at
        )
        values ($1, $2, $3, $4, 'pending', null, now(), null, null)
        on conflict (telegram_id) do update set
          phone = excluded.phone,
          display_name = excluded.display_name,
          username = excluded.username,
          status = 'pending',
          granted_role = null,
          requested_at = now(),
          reviewed_by = null,
          reviewed_at = null
        returning *
      `,
      [telegramId, profile.phone, profile.displayName, profile.username],
    );
    await client.query(
      `
        insert into public.access_events (
          target_telegram_id, actor_telegram_id, action, details
        ) values ($1, $1, 'request', jsonb_build_object('phone', $2::text))
      `,
      [telegramId, profile.phone],
    );
    await client.query("commit");
    return { status: "pending", isNew: true, request: result.rows[0] };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function listPendingRequests() {
  const result = await pool.query(`
    select telegram_id, phone, display_name, username, requested_at
    from public.access_requests
    where status = 'pending'
    order by requested_at asc
  `);
  return result.rows;
}

async function listActiveUsers() {
  const result = await pool.query(`
    select telegram_id, phone, display_name, username, role, granted_by,
           created_at, updated_at
    from public.bot_users
    where is_active
    order by role, lower(display_name), telegram_id
  `);
  return result.rows;
}

function buildIdentifier(input) {
  const text = String(input || "").trim();
  const normalizedDigits = normalizeDigits(text).trim();
  const phone = normalizePhone(text);
  return {
    text,
    telegramId:
      isTelegramId(text) && !/^01\d{9}$/.test(phone || "")
        ? normalizedDigits
        : null,
    phone,
    name: normalizeName(text),
  };
}

async function findUsersByIdentifier(input) {
  const value = buildIdentifier(input);
  if (!value.text) return [];

  if (value.telegramId) {
    const user = await getAccessUser(value.telegramId);
    return user ? [user] : [];
  }

  if (value.phone) {
    const result = await pool.query(
      `
        select telegram_id, phone, display_name, username, role, granted_by,
               created_at, updated_at
        from public.bot_users
        where phone = $1 and is_active
        order by telegram_id
      `,
      [value.phone],
    );
    if (result.rows.length) return result.rows;
  }

  const exact = await pool.query(
    `
      select telegram_id, phone, display_name, username, role, granted_by,
             created_at, updated_at
      from public.bot_users
      where lower(display_name) = lower($1) and is_active
      order by telegram_id
      limit 20
    `,
    [value.name],
  );
  if (exact.rows.length) return exact.rows;

  const partial = await pool.query(
    `
      select telegram_id, phone, display_name, username, role, granted_by,
             created_at, updated_at
      from public.bot_users
      where display_name ilike $1 and is_active
      order by lower(display_name), telegram_id
      limit 20
    `,
    [`%${value.name}%`],
  );
  return partial.rows;
}

async function findPendingRequestsByIdentifier(input) {
  const value = buildIdentifier(input);
  if (!value.text) return [];

  const result = await pool.query(
    `
      select telegram_id, phone, display_name, username, requested_at
      from public.access_requests
      where status = 'pending'
        and (
          ($1::text is not null and telegram_id = $1)
          or ($2::text is not null and phone = $2)
          or lower(display_name) = lower($3)
          or display_name ilike $4
        )
      order by
        case when lower(display_name) = lower($3) then 0 else 1 end,
        requested_at asc
      limit 20
    `,
    [value.telegramId, value.phone, value.name, `%${value.name}%`],
  );
  return result.rows;
}

async function approveRequest(telegramId, role, actorTelegramId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const requestResult = await client.query(
      `
        select telegram_id, phone, display_name, username
        from public.access_requests
        where telegram_id = $1 and status = 'pending'
        for update
      `,
      [String(telegramId)],
    );
    if (!requestResult.rows.length) {
      await client.query("rollback");
      return null;
    }

    const request = requestResult.rows[0];
    await client.query(
      `
        insert into public.bot_users (
          telegram_id, phone, display_name, username, role, is_active, granted_by, updated_at
        ) values ($1, $2, $3, $4, $5, true, $6, now())
        on conflict (telegram_id) do update set
          phone = excluded.phone,
          display_name = excluded.display_name,
          username = excluded.username,
          role = excluded.role,
          is_active = true,
          granted_by = excluded.granted_by,
          updated_at = now()
      `,
      [request.telegram_id, request.phone, request.display_name, request.username, role, String(actorTelegramId)],
    );
    await client.query(
      `
        update public.access_requests
        set status = 'approved', granted_role = $2, reviewed_by = $3, reviewed_at = now()
        where telegram_id = $1
      `,
      [request.telegram_id, role, String(actorTelegramId)],
    );
    await client.query(
      `
        insert into public.access_events (
          target_telegram_id, actor_telegram_id, action, new_role
        ) values ($1, $2, 'approve', $3)
      `,
      [request.telegram_id, String(actorTelegramId), role],
    );
    await client.query("commit");
    return { ...request, role };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function rejectRequest(telegramId, actorTelegramId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `
        update public.access_requests
        set status = 'rejected', granted_role = null,
            reviewed_by = $2, reviewed_at = now()
        where telegram_id = $1 and status = 'pending'
        returning telegram_id, phone, display_name, username
      `,
      [String(telegramId), String(actorTelegramId)],
    );
    if (!result.rows.length) {
      await client.query("rollback");
      return null;
    }
    await client.query(
      `
        insert into public.access_events (
          target_telegram_id, actor_telegram_id, action
        ) values ($1, $2, 'reject')
      `,
      [String(telegramId), String(actorTelegramId)],
    );
    await client.query("commit");
    return result.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function changeUserRole(telegramId, newRole, actorTelegramId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await getAccessUser(telegramId, client);
    if (!current || current.role === newRole) {
      await client.query("rollback");
      return current ? { unchanged: true, user: current } : null;
    }

    const action = newRole === "manager" ? "promote" : "demote";
    const result = await client.query(
      `
        update public.bot_users
        set role = $2, updated_at = now()
        where telegram_id = $1 and is_active
        returning telegram_id, phone, display_name, username, role
      `,
      [String(telegramId), newRole],
    );
    await client.query(
      `
        update public.access_requests
        set granted_role = $2, reviewed_by = $3, reviewed_at = now()
        where telegram_id = $1
      `,
      [String(telegramId), newRole, String(actorTelegramId)],
    );
    await client.query(
      `
        insert into public.access_events (
          target_telegram_id, actor_telegram_id, action, old_role, new_role
        ) values ($1, $2, $3, $4, $5)
      `,
      [String(telegramId), String(actorTelegramId), action, current.role, newRole],
    );
    await client.query("commit");
    return { unchanged: false, user: result.rows[0], oldRole: current.role };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function removeUserAccess(telegramId, actorTelegramId) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await getAccessUser(telegramId, client);
    if (!current) {
      await client.query("rollback");
      return null;
    }
    await client.query(
      `
        update public.bot_users
        set is_active = false, updated_at = now()
        where telegram_id = $1
      `,
      [String(telegramId)],
    );
    await client.query(
      `
        update public.access_requests
        set status = 'revoked', granted_role = null,
            reviewed_by = $2, reviewed_at = now()
        where telegram_id = $1
      `,
      [String(telegramId), String(actorTelegramId)],
    );
    await client.query(
      `
        insert into public.access_events (
          target_telegram_id, actor_telegram_id, action, old_role
        ) values ($1, $2, 'remove', $3)
      `,
      [String(telegramId), String(actorTelegramId), current.role],
    );
    await client.query("commit");
    return current;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  approveRequest,
  changeUserRole,
  clearConversationState,
  findPendingRequestsByIdentifier,
  findUsersByIdentifier,
  getAccessRequest,
  getAccessUser,
  getConversationState,
  getItemById,
  getPackageById,
  schemaReady,
  listDeliveryPrices,
  listItems,
  listPackages,
  searchDeliveryPrices,
  searchItems,
  searchOrders,
  searchPackages,
  listActiveUsers,
  listPendingRequests,
  pool,
  rejectRequest,
  removeUserAccess,
  replaceDeliveryPrices,
  replaceItems,
  replacePackages,
  searchCustomerProfiles,
  findRecentOrdersByPhone,
  findRecentDuplicateOrders,
  deleteAllOrders,
  getPreviousMonthReport,
  testCustomerConnection,
  saveOrder,
  getOrderByCode,
  listOrdersForExport,
  updateOrderField,
  updateOrderAdvancePayment,
  updateOrderDelivery,
  updateOrderChild,
  addOrderChild,
  deleteOrderChild,
  addOrderLine,
  updateOrderLineQuantity,
  updateOrderLineDetails,
  deleteOrderLine,
  cancelSavedOrder,
  setConversationState,
  submitAccessRequest,
  testConnection,
};
