# VMM 3rd Party Attendance Control Tower

Live attendance for third-party staff (Housekeeping, Security, Travel and CDIT promoters) across all VMM stores.
Free setup: GitHub Pages (website) + Supabase free plan (database, photos). No card on any account.

Designed & Developed by Shubhendu Sinha · VMM Central Ops & BI

---

## Pages

| Page | Who | What |
|---|---|---|
| `index.html` | Store (SM / ASM / DM Apps / DM FMCG / DM GM), AM, ZFM, HO Dept, Admin | Login. Store people register themselves at first login (inside the store). AM / ZFM / HO / Admin create their first PIN with the setup code from their invite mail. Desktop / Mobile switch under Login (not for store). |
| `punch.html?s=AA01` | Associates | From the store QR. Punch IN / OUT, geo-fence, random 8 KB selfie with a live face check (blink or turn head). |
| `store.html` | Store logins | Today / any date / 1st to today, "not punched", WhatsApp share, Punch for staff (no phone), comp-off and staff-detail requests to AM (with reason), QR poster, statements. |
| `manage.html` | AM, ZFM, HO Dept | Live Dashboard (Action needed, category filter, view by ZFM / AM / Store / Dept, last 7 days), AM: Approvals + Store team, ZFM: Store team + Users & PIN, churn, statements. |
| `admin.html` | Admin | Everything + Store / Manpower / Users / HO Dept masters (Template · Import check · Export · Add · Edit), Mail Center (.eml), View as User, Settings, Access and Consent logs. |
| `statement.html` | All logged-in roles | A4 monthly statement, print / PDF / Excel. |
| `qr.html` | Store, Admin | Printable QR poster. |
| `privacy.html` | Everyone | Camera, location and live-check privacy policy (English / हिंदी). |

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

### Step 4 · Add AM, ZFM and HO people, then send invites
1. **Users & PIN** → **⬇ Template** → fill AM / ZFM / HO Dept rows (with Email) → **⬆ Import Excel** → check the "Import check" line → **Save good rows**.
2. Store logins are NOT uploaded: SM, ASM, DM Apps, DM FMCG, DM GM register themselves at first login inside the store (one login per post).
3. **Mail Center** → **Login invite** → Role AM (then ZFM, HO Dept) → **⬇ Generate ZIP**. Each mail has a one-time setup code (valid 7 days).
4. Unzip, then send the `Batch_xx` folders with your Outlook batch macro. `Mail_tracker.xlsx` lists every mail.

### Step 5 · Upload required manpower
1. **Manpower Master** → **⬇ Excel template**.
2. One row per store + category + brand: Vendor, Morning count, Evening count.
3. Pick the **effective date** next to the upload button → **⬆ Upload Excel**.

### Step 6 · Change your Admin PIN
1. Left menu → **Change PIN**.
2. Current PIN → new PIN twice → **Change PIN**. Easy PINs (1234, 0000, 1111 …) are refused.
3. Forgot it? The other Admin resets it (Users & PIN → Reset PIN) and gives you the new setup code privately.

### Sample data (for checking every screen)
- Test stores ZT01–ZT12 (+ AA01, AA05) with test AM / ZFM / HO / store logins and 14 days of attendance are tagged TEST.
- Before go-live: **Settings → Test data → Delete all test data** (tap twice).

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
- Every consent is saved: Admin → **Consent Log** (date, time, store, device, policy version). On the store phone, the store login ticks consent for the associate on every punch.
- Store login checks location inside the 500 m geo-fence (when Test mode is OFF).
- Change `policy` in `assets/app.js` when the privacy text changes; everyone is asked again.
- The privacy policy text is a draft: have VMM Legal / HR review it before go-live.

## Rules
- Only Admin can delete. Store asks AM (with a reason) for comp-off or staff-detail changes; AM approves in **Approvals**. Admin can switch more change types on in Settings.
- If a store person leaves, the **AM** marks the post vacant in **Store team** (with reason); the new person then registers.
- "Action needed" alerts start at the times set in **Settings** (default 10:00 morning, 16:00 evening).

## Load test (5000 users)
- `loadtest/k6_login_dashboard.js` (free k6 tool, run from your laptop with a TEST AM login). Steps are at the top of the file.

## Security (what protects the portal)
- No password or PIN is stored in this repo. PINs are saved only as encrypted hashes in the database.
- 3 wrong PINs → 5 min lock. 3rd lock within 24 hours → 24 hour lock (every lock is in the Access Log). ZFM / Admin can clear a store or AM lock with **Reset PIN**.
- Admin PIN: **Change PIN** (old + new). Another Admin can reset it; the new PIN then needs a fresh setup code.
- AM / ZFM / HO / Admin first PIN needs the one-time setup code from their invite mail. PINs are never mailed.
- Store registration and first PIN: with Test mode OFF, the person must be inside the store's 500 m geo-fence.
- Selfie punches run a live face check on the phone (blink or turn head, random). It stops a photo of a photo; the result (passed / failed) is shown to Admin.
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
