// VMM 3rd Party Attendance — "Ask the data" bot (Admin only)
// Provider: Anthropic Claude (secret ANTHROPIC_API_KEY, model ANTHROPIC_MODEL, default claude-haiku-5-5).
// If that key is not set, falls back to Google Gemini (secret GEMINI_API_KEY, model GEMINI_MODEL).
// Keys live ONLY here as Supabase secrets — never in the browser or in GitHub.
// The browser sends: session token + question + short history. This function checks the token is a live
// Admin session, applies a daily limit, builds a store-level summary (no associate names / phones),
// and asks the model to answer only from that summary.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const svc = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const anon = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_KRASYzbWRPYoKzJItq-Gqw_zLwUvnX-", { auth: { persistSession: false } });
const A_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const A_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5";
const G_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const G_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
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
Mention store code and name, and AM / ZFM when ranking. Never invent numbers. If asked in Hindi, answer in Hindi.
FORMAT (strict): line 1 = the direct answer in one short sentence with the key number in **bold**.
Then, only if it helps, ONE markdown table (max 15 rows, short column names, % as the last column, best/worst order as asked).
Then at most 3 short bullet points ("- ") with what to act on. No headings, no code blocks, no long paragraphs, no closing pleasantries.`;

type Turn = { role: "user" | "assistant"; text: string };

// Claude needs alternating user / assistant turns, starting with the user
function claudeTurns(hist: Turn[], q: string): Turn[] {
  const all: Turn[] = [...hist.filter((t) => t.text), { role: "user", text: q }];
  const out: Turn[] = [];
  for (const t of all) {
    if (!out.length && t.role !== "user") continue;
    if (out.length && out[out.length - 1].role === t.role) out[out.length - 1].text += "\n\n" + t.text;
    else out.push({ ...t });
  }
  return out;
}

async function callModel(system: string, hist: Turn[], q: string): Promise<{ ok: boolean; text: string; status: number; detail?: string }> {
  if (A_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": A_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: A_MODEL, max_tokens: 4000, system, messages: claudeTurns(hist, q).map((t) => ({ role: t.role, content: t.text })) }),
    });
    const g = (await res.json().catch(() => null)) as any;
    const blocks = (g && g.content) || [];
    const text = blocks.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    const detail = g && g.error ? g.error.message : !text ? `empty answer (stop: ${g && g.stop_reason}, blocks: ${blocks.map((c: any) => c.type).join(",") || "none"}, HTTP ${res.status})` : undefined;
    return { ok: res.ok && !!text, text, status: res.status, detail };
  }
  if (G_KEY) {
    const contents = [
      ...hist.filter((t) => t.text).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
      { role: "user", parts: [{ text: q }] },
    ];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${G_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": G_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: 1500 } }),
    });
    const g = (await res.json().catch(() => null)) as any;
    const text = ((g && g.candidates && g.candidates[0] && g.candidates[0].content && g.candidates[0].content.parts) || []).map((p: any) => p.text || "").join("");
    return { ok: res.ok && !!text, text, status: res.status, detail: g && g.error ? g.error.message : undefined };
  }
  return { ok: false, text: "", status: 0, detail: "NO_KEY" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD" }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, error: "BAD_JSON" }, 400); }
  const token = String(b.token || ""), q = String(b.q || "").trim().slice(0, 600);
  const emp = await adminOf(token);
  if (!emp) return json({ ok: false, error: "FORBIDDEN" }, 403);
  if (b.action === "fb") {   // thumbs up / down on one answer
    const id = Number(b.id), v = Number(b.v);
    if (!id || (v !== 1 && v !== -1)) return json({ ok: false, error: "BAD_INPUT" }, 400);
    const { error } = await svc.from("bot_log").update({ fb: v, fb_at: new Date().toISOString() }).eq("id", id).eq("emp_code", emp);
    return json(error ? { ok: false, error: "BOT_FAIL", detail: error.message } : { ok: true });
  }
  if (!q) return json({ ok: false, error: "EMPTY" }, 400);
  if (!A_KEY && !G_KEY) return json({ ok: false, error: "BOT_KEY_MISSING" });
  const { count } = await svc.from("bot_log").select("id", { count: "exact", head: true }).eq("emp_code", emp).gte("created_at", istDate() + "T00:00:00+05:30");
  if ((count || 0) >= DAY_LIMIT) return json({ ok: false, error: "BOT_LIMIT", limit: DAY_LIMIT });
  const t0 = Date.now();
  try {
    const data = await summary(token);
    const hist: Turn[] = (Array.isArray(b.history) ? b.history : []).slice(-6).map((h: any) => ({
      role: h.role === "model" ? "assistant" : "user", text: String(h.text || "").slice(0, 2000),
    }));
    const r = await callModel(SYS + "\n\nDATA:\n" + data, hist, q);
    const { data: row } = await svc.from("bot_log").insert({ emp_code: emp, q, ok: r.ok, ms: Date.now() - t0, a: r.ok ? r.text.slice(0, 8000) : null,
      err: r.ok ? null : (r.detail || `HTTP ${r.status}`).slice(0, 500) }).select("id").single();
    if (!r.ok) return json({ ok: false, error: r.status === 429 ? "BOT_BUSY" : "BOT_FAIL", detail: (r.detail || `HTTP ${r.status}`).slice(0, 200) });
    return json({ ok: true, id: row && row.id, answer: r.text, left: DAY_LIMIT - (count || 0) - 1 });
  } catch (e) {
    await svc.from("bot_log").insert({ emp_code: emp, q, ok: false, ms: Date.now() - t0, err: String((e as Error).message || e).slice(0, 500) });
    return json({ ok: false, error: "BOT_FAIL", detail: String((e as Error).message || e).slice(0, 200) });
  }
});
