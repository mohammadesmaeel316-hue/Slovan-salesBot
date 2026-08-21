# Sales Order Telegram Bot

Arabic Telegram bot for creating customer orders, calculating package and shipping totals, saving full order data, and exporting order summaries to Excel.

## Current status

Telegram ID-based authentication and delivery-price sheet management are implemented.

Item catalog sheet management is also available to Super Admins and Managers. The
`items.xlsx` file requires `اسم الصنف` and `السعر`; `الحد الأدنى` and `الحد الأقصى`
are optional. A valid upload atomically replaces the previous catalog.

Package sheet management uses `اسم الباكدج`, `الصنف`, `الكمية`, and `السعر الإجمالي`.
The package name and total price are entered on its first row; following rows add
more item/quantity pairs. A valid upload atomically replaces all saved packages.

## Planned roles

- Super Admin
- Manager
- Sales

## Authentication milestone

1. A new user shares their own Telegram contact to request access.
2. The Super Admin receives a notification and approves the request as Manager or Sales, or rejects it.
3. The Super Admin can find saved users by name, normalized phone number, or Telegram ID.
4. The Super Admin can promote Sales to Manager, demote Manager to Sales, or remove access.
5. All access changes are saved in an audit log.

Managers cannot manage users. Super Admin IDs come only from `SUPER_ADMIN_IDS` and cannot be changed through the bot.

## Delivery prices sheet

Super Admins and Managers can open **أسعار الشحن** from the bot menu.

- **تحميل ملف أسعار الشحن** downloads `delivery-prices.xlsx` with the currently saved prices. When the table is empty, the file contains only the headers.
- **رفع ملف أسعار الشحن** accepts an `.xlsx` file up to 2 MB and 1,000 data rows.
- The required headers are `المحافظة\المنطقه` and `سعر الشحن` in that order.
- Area names must be unique and prices must be non-negative numbers with at most two decimal places.
- The complete file is validated before the old database values are atomically replaced.
- Managers and Super Admins can manage these prices; Sales users cannot.

## Local configuration

Copy `.env.example` to `.env` when the required credentials are ready. Never commit `.env`, the Telegram bot token, or the Supabase database password.

Required values:

- `BOT_TOKEN`: Telegram token from BotFather.
- `SUPER_ADMIN_IDS`: Comma-separated Telegram user IDs.
- `DATABASE_URL`: Supabase PostgreSQL connection string.
- `SUPABASE_PROJECT_REF`: Supabase project reference; currently `fmjeyzinxuzjdwnumftp`.
- `SUPABASE_URL`: Project URL; currently `https://fmjeyzinxuzjdwnumftp.supabase.co`.

`Sales.xlsx` is a private reference file and is intentionally excluded from Git.

## Run

Apply `schema.sql` to the Supabase project, fill `.env`, then install dependencies and run:

```bash
pnpm install
pnpm test
pnpm start
```

Local polling and the deployed webhook cannot run at the same time. Use `pnpm start`
only before a Telegram webhook is registered.

## Test on Vercel

The Vercel function is located at `/api/telegram`, with a database health check at
`/api/health`. The function runs in Frankfurt (`fra1`), close to the Supabase
project in `eu-central-1`.

1. Revoke any Telegram token that was shared in chat and create a new token with
   BotFather.
2. In Supabase, open **Connect**, select **Transaction pooler**, and copy the
   port `6543` connection string. Replace its password placeholder with the real
   database password.
3. Create a random webhook secret containing 16-256 letters, numbers, `_`, or `-`.
4. Put these values in the local `.env` file:

   - `BOT_TOKEN`
   - `SUPER_ADMIN_IDS`
   - `DATABASE_URL`
   - `TELEGRAM_WEBHOOK_SECRET`

5. Sign in and link the folder to a Vercel project:

```bash
corepack install
corepack pnpm dlx vercel@59.0.0 login
corepack pnpm dlx vercel@59.0.0 link
```

6. Add the same four variables under **Vercel Project → Settings → Environment
   Variables**. Enable them for Production and mark the token, database URL, and
   webhook secret as sensitive.
7. Deploy:

```bash
corepack pnpm dlx vercel@59.0.0 --prod
```

8. Open `https://YOUR-PROJECT.vercel.app/api/health`. It should return:

```json
{"ok":true,"database":"ready"}
```

9. Register the deployed Telegram webhook using the same local `.env` values:

```bash
corepack pnpm webhook -- https://YOUR-PROJECT.vercel.app
```

Finally, send `/start` to the bot and test the access-request flow.
