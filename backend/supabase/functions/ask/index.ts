// VMM 3rd Party Attendance — "Ask the data" bot (Admin only)
// The Google Gemini key lives ONLY here, as the edge-function secret GEMINI_API_KEY.
// It is never sent to the browser, never in GitHub. The browser sends: session token + question.
// This function checks the token is a live Admin session, applies a daily limit, builds a
// store-level summary from the same RPCs the dashboard uses (no associate names / phones),
// and asks Gemini to answer only from that summary.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const svc = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const anon = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_KRASYzbWRPYoKzJItq-Gqw_zLwUvnX-", { auth: { persistSession: false } });
const KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
const DAY_LIMIT = Number(Deno.env.get("BOT_DAY_LIMIT") || 60);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const istDate = (off = 0) => new Date(Date.now() + 5.5 * 3600e3 + off * 864e5).toISOString().slice(0, 10);

async function adminOf(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data } = await svc.from("sessions").select("role, emp_code, ended_at, last_seen").eq("token", token).maybeSingle();
  if (!data || data.ended_at || data.role !== "admin") return null;
  if (Date.now() - new Date(data.last_seen).getTime() > 12 * 3600 * 1000) return null;
  return data.emp_code as string;
}

// summary cache per isolate (2 min) so a burst of questions does not re-read the DB
let CACHE: { at: number; text: string } | null = null;
async function summary(token: string) {
  if (CACHE && Date.now() - CACHE.at < 120000) return CACHE.text;
  const today = istDate();
  const [ov, dd, rt] = await Promise.all([
    anon.rpc("dash_overview", { p_token: token, p_date: today, p_shift: "B", p_upto: null }),
    anon.rpc("dash_days", { p_token: token, p_end: today, p_shift: "B", p_days: 7 }),
    anon.rpc("rating_tasks", { p_token: token, p_from: istDate(-7), p_to: istDate(-1) }),
  ]);
  const o = ov.data as any, d = dd.data as any, r = rt.data as any;
  if (!o || o.ok === false) throw new Error("DATA " + (o && o.error || ov.error?.message || ""));
  const cat: Record<string, string> = {}; (o.categories || []).forEach((c: any) => { cat[c.id] = c.name; });
  const L: string[] = [];
  L.push(`TODAY ${o.today} · time now ${o.now} IST · dashboard date ${o.date}. Morning alert ${o.alert_m}, evening alert ${o.alert_e}. Low % threshold ${o.low_pct}%.`);
  L.push(`DEPARTMENTS: ${Object.entries(cat).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (o.sg_counts) L.push(`SECURITY TODAY: required ${o.sg_counts.req}, present ${o.sg_counts.P}, half-day ${o.sg_counts.H}, P* ${o.sg_counts.Pstar}, mispunch ${o.sg_counts.MP}, absent ${o.sg_counts.A}`);
  L.push("STORES (code|name|AM|ZFM|RLPO|HK split set):");
  (o.stores || []).forEach((s: any) => L.push(`${s.code}|${s.name || ""}|${s.am_name || s.am || ""}|${s.zfm_name || s.zfm || ""}|${s.rlpo_name || ""}|${s.hk_split_set ? "Y" : "N"}`));
  L.push("TODAY BY STORE & DEPT (store|dept|required|present):");
  (o.rows || []).forEach((x: any) => L.push(`${x.s}|${x.c}|${x.req}|${x.p}`));
  if (d && d.ok !== false && d.rows) {
    const days: string[] = []; for (let i = (d.days || 7) - 1; i >= 0; i--) days.push(istDate(-i));
    L.push(`LAST ${days.length} DAYS (store|dept|required per day|present per day) days=${days.join(",")}:`);
    d.rows.forEach((x: any) => L.push(`${x.s}|${x.c}|${(x.r || []).join(",")}|${(x.p || []).join(",")}`));
  }
  if (r && r.ok !== false) {
    L.push("STAFF RATING LAST 7 DAYS by store (store|date|staff|rated|avg stars|low 1-2★|status):");
    (r.stores || []).forEach((x: any) => L.push(`${x.s}|${x.d}|${x.n}|${x.rated}|${x.avg ?? ""}|${x.low}|${x.st}`));
    L.push("RATING by brand/vendor (dept|brand|staff|rated|avg|low):");
    (r.brands || []).forEach((x: any) => L.push(`${x.c}|${x.b}|${x.n}|${x.rated}|${x.avg ?? ""}|${x.low}`));
  }
  CACHE = { at: Date.now(), text: L.join("\n") };
  return CACHE.text;
}

const SYS = `You are the analyst bot of the VMM "3rd Party Attendance" control tower (Housekeeping, Security, Travel and CDIT promoters in Vishal Mega Mart stores).
Answer ONLY from the DATA block. If the data cannot answer, say so and say which report in the portal would.
Attendance % = present ÷ required (cap present at required per store-dept). Use short answers, Indian number format, and small markdown tables when listing stores.
Mention store code and name, and AM / ZFM when ranking. Never invent numbers. If asked in Hindi, answer in Hindi.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD" }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, error: "BAD_JSON" }, 400); }
  const token = String(b.token || ""), q = String(b.q || "").trim().slice(0, 600);
  const emp = await adminOf(token);
  if (!emp) return json({ ok: false, error: "FORBIDDEN" }, 403);
  if (!q) return json({ ok: false, error: "EMPTY" }, 400);
  if (!KEY) return json({ ok: false, error: "BOT_KEY_MISSING" });
  const { count } = await svc.from("bot_log").select("id", { count: "exact", head: true }).eq("emp_code", emp).gte("created_at", istDate() + "T00:00:00+05:30");
  if ((count || 0) >= DAY_LIMIT) return json({ ok: false, error: "BOT_LIMIT", limit: DAY_LIMIT });
  const t0 = Date.now();
  try {
    const data = await summary(token);
    const hist = (Array.isArray(b.history) ? b.history : []).slice(-6).map((h: any) => ({ role: h.role === "model" ? "model" : "user", parts: [{ text: String(h.text || "").slice(0, 2000) }] }));
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYS + "\n\nDATA:\n" + data }] },
        contents: [...hist, { role: "user", parts: [{ text: q }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1500 },
      }),
    });
    const g = await res.json().catch(() => null) as any;
    const answer = g?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
    const ok = res.ok && !!answer;
    await svc.from("bot_log").insert({ emp_code: emp, q, ok, ms: Date.now() - t0 });
    if (!ok) return json({ ok: false, error: res.status === 429 ? "BOT_BUSY" : "BOT_FAIL", detail: g?.error?.message?.slice(0, 200) });
    return json({ ok: true, answer, left: DAY_LIMIT - (count || 0) - 1 });
  } catch (e) {
    await svc.from("bot_log").insert({ emp_code: emp, q, ok: false, ms: Date.now() - t0 });
    return json({ ok: false, error: "BOT_FAIL", detail: String((e as Error).message || e).slice(0, 200) });
  }
});
