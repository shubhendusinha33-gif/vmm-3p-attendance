# VMM 3rd Party Attendance Control Tower

Live attendance for third-party staff (Housekeeping, Security, Travel and CDIT promoters) across all VMM stores.
Free setup: GitHub Pages (website) + Supabase free plan (database, photos). No card on any account.

Designed & Developed by Shubhendu Sinha · VMM Central Ops & BI

---

## Pages

| Page | Who | What |
|---|---|---|
| `index.html` | Store (SM / ASM / MOD), AM, ZFM, HO Dept, Admin | Login: Emp Code first, then PIN. First login creates a PIN with a math captcha. |
| `punch.html?s=AA01` | Associates | Opens from the store QR. Punch IN / OUT, geo-fence, random 8 KB photo. |
| `store.html` | SM / ASM / MOD | Today / any date / 1st to today, "not punched" list, WhatsApp share, comp-off, Punch for staff, QR poster. |
| `manage.html` | AM, ZFM, HO Dept | Live dashboard with drill-down, staff churn, statements. ZFM also resets PINs. |
| `admin.html` | Admin | Everything above + Store Master, Manpower Master, Users & PIN, View as User, Settings, Access Log, Consent Log, photo ZIP download. |
| `statement.html` | All logged-in roles | A4 monthly statement, print / PDF / Excel. |
| `qr.html` | Store login, Admin | Printable QR poster (Admin: all stores at once). |
| `privacy.html` | Everyone | Camera & location privacy policy (English / हिंदी). |

## Baby steps

### Step 1 · Open the portal
Open `https://shubhendusinha33-gif.github.io/vmm-3p-attendance/` on your phone or computer.

### Step 2 · Log in as Admin
1. Tap **Admin**.
2. Enter your Admin Emp Code → **Next** → your Admin PIN → **Login**.
3. The Admin Emp Code and PIN are given to you privately. **Never write them in this repo, in a chat group or on paper at the store.**

### Step 3 · Upload stores
1. Left menu → **Store Master** → **⬇ Excel template**.
2. Fill your stores in Excel: Store Code, Name, City, AM Emp, ZFM Emp, Lat, Lng, Active.
3. **⬆ Upload Excel**. You will see "N stores saved".

### Step 4 · Upload people who log in
1. **Users & PIN** → **⬇ Excel template**.
2. One row per SM / ASM / MOD (with Store Code and Post), AM, ZFM, HO Dept person (with Dept), Admin.
3. **⬆ Upload Excel**.

### Step 5 · Upload required manpower
1. **Manpower Master** → **⬇ Excel template**.
2. One row per store + category + brand: Vendor, Morning count, Evening count.
3. Pick the **effective date** next to the upload button → **⬆ Upload Excel**.

### Step 6 · Change your Admin PIN
1. Left menu → **Change PIN**.
2. Current PIN → new PIN twice → **Change PIN**. Easy PINs (1234, 0000, 1111 …) are refused.
3. Admin PIN cannot be reset from the portal by anyone (not even another Admin), and it cannot be "created" from the login screen. Only **Change PIN** works.

### Step 7 · Test in one store
1. **Settings** → keep **Test mode** ON for the first day (GPS not checked).
2. **Store Master** → **Poster** next to a store → print → paste near the staff entry.
3. Scan with any phone → punch → check **Live Dashboard**.

### Step 8 · Go live
1. **Settings** → turn **Test mode** OFF → **Save Settings**.
2. Admin → **Store Master** → **🖨 All QR posters** → print / save as PDF → send to stores.

### Every month · Photos
1. **Settings** → Photo storage shows how full the free 1 GB is (alert at 70%).
2. Pick dates → **⬇ Download photos ZIP** → save the ZIP on your drive.
3. Then **Downloaded, remove from portal** → tap again to confirm.

## Camera, location and consent
- First use on every phone shows a consent screen (policy summary, tick box, link to `privacy.html`). Without allowing camera and location, punch and store login do not open.
- Every consent is saved: Admin → **Consent Log** (date, time, store, device, policy version). On the MOD's phone the MOD ticks consent for the associate on every punch.
- Store login checks location inside the 500 m geo-fence (when Test mode is OFF).
- Change `policy` in `assets/app.js` when the privacy text changes; everyone is asked again.
- The privacy policy text is a draft: have VMM Legal / HR review it before go-live.

## Security (what protects the portal)
- No password or PIN is stored in this repo. PINs are saved only as encrypted hashes in the database.
- 3 wrong PINs → 5 min lock. 3rd lock within 24 hours → 24 hour lock (every lock is in the Access Log). ZFM / Admin can clear a store or AM lock with **Reset PIN**.
- Admin PIN: only **Change PIN** (old + new). No reset, no first-time PIN from the login screen.
- Store first PIN: with Test mode OFF, the SM / ASM / MOD must be inside the store's 500 m geo-fence to create it.
- Tables are locked (RLS). The website can only call checked database functions; every function checks the login token and the person's stores.
- **View as User** (Admin) opens a read-only copy of anyone's view. It cannot punch, reset or change anything, and it never blocks the store's own login.
- Pages refuse to open inside another site (no clickjacking) and only talk to this Supabase project (Content-Security-Policy).
- The Supabase key in `assets/app.js` is the public "publishable" key. It is meant to be public; it cannot read tables.

## Free plan limits (check on supabase.com/pricing)
- Database 500 MB, file storage 1 GB, 5 GB data transfer per month.
- At 850 stores: about 25 MB of photos per day → download the ZIP once a month.

## Tech (for a developer)
- `assets/app.js` → `CONFIG` holds the Supabase URL and publishable key (safe to be public).
- All data access goes through database functions (`backend/sql`), tables are locked by RLS.
- Photo upload / list / delete: Supabase Edge Function `backend/supabase/functions/photo`.
- Times are IST. Morning shift = IN before 2 PM.
