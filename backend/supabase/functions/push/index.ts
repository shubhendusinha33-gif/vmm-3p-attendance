// VMM 3rd Party Attendance — phone punch alerts (web push) for store management.
// POST {action:'notify', store:'HY10'} right after a punch. Sends every punch of that store from the last
// 10 minutes that has not been notified yet (each punch once), to every subscribed store login of the store.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
let vapidReady = false;

async function vapid() {
  if (vapidReady) return true;
  const { data } = await sb.from("app_secrets").select("name, value").in("name", ["vapid_public", "vapid_private", "vapid_subject"]);
  const m = Object.fromEntries((data || []).map((r: { name: string; value: string }) => [r.name, r.value]));
  if (!m.vapid_public || !m.vapid_private) return false;
  webpush.setVapidDetails(m.vapid_subject || "https://shubhendusinha33-gif.github.io/vmm-3p-attendance/", m.vapid_public, m.vapid_private);
  vapidReady = true;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "BAD_JSON" }, 400); }
  if (body.action !== "notify") return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  const store = String(body.store || "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}$/.test(store)) return json({ ok: false, error: "BAD_STORE" }, 400);
  if (!(await vapid())) return json({ ok: false, error: "NO_VAPID" }, 500);

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: punches } = await sb.from("punches")
    .select("id, kind, ts, device_kind, mod_emp, dist_m, store_code, vendor, associates(name, store_code, category_id, vendor), categories(name)")
    .eq("store_code", store).is("notified_at", null).gte("ts", since).order("id").limit(20);
  if (!punches || !punches.length) return json({ ok: true, sent: 0 });
  await sb.from("punches").update({ notified_at: new Date().toISOString() }).in("id", punches.map((p) => p.id));

  const { data: subs } = await sb.from("push_subs").select("id, endpoint, p256dh, auth, emp_code, users!inner(active)").eq("store_code", store);
  const live = (subs || []).filter((s: any) => s.users?.active !== false);
  if (!live.length) return json({ ok: true, sent: 0, punches: punches.length });

  const mods = [...new Set(punches.map((p) => p.mod_emp).filter(Boolean))];
  const names: Record<string, string> = {};
  if (mods.length) { const { data: us } = await sb.from("users").select("emp_code, name, post").in("emp_code", mods); (us || []).forEach((u) => names[u.emp_code] = `${u.name}${u.post ? " (" + u.post + ")" : ""}`); }

  let sent = 0;
  for (const p of punches as any[]) {
    const a = p.associates || {};
    const t = new Date(new Date(p.ts).getTime() + 5.5 * 3600 * 1000).toISOString().slice(11, 16);
    const src = p.device_kind === "mod" ? `Store phone${names[p.mod_emp] ? " · " + names[p.mod_emp] : ""}` : a.store_code && a.store_code !== p.store_code ? `Other-store phone (${a.store_code})` : `Own phone${p.dist_m != null ? " · " + p.dist_m + " m" : ""}`;
    const payload = JSON.stringify({
      title: `Punch ${p.kind} · ${a.name || ""}`,
      body: `${p.categories?.name || a.category_id || ""}${p.vendor || a.vendor ? " · " + (p.vendor || a.vendor) : ""} · ${p.kind === "IN" ? t : "OUT ✓"} · ${src}`,
      tag: `p${p.id}`, url: "store.html#td",
    });
    for (const s of live as any[]) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 600, urgency: "high" });
        sent++;
        await sb.from("push_subs").update({ last_ok: new Date().toISOString(), fails: 0 }).eq("id", s.id);
      } catch (e: any) {
        const code = e?.statusCode || 0;
        if (code === 404 || code === 410) await sb.from("push_subs").delete().eq("id", s.id);
        else await sb.from("push_subs").update({ fails: (s.fails || 0) + 1 }).eq("id", s.id);
      }
    }
  }
  return json({ ok: true, sent, punches: punches.length });
});
