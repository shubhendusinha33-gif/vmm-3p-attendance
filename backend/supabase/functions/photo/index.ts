// VMM 3rd Party Attendance — photo upload / list / delete / usage
// Auth is done inside: uploads need a one-time photo token from punch_submit;
// list / delete / usage need an active Admin session token.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const BUCKET = "selfies";
const MAX_BYTES = 20 * 1024;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function adminOk(token: string) {
  if (!token) return false;
  const { data } = await sb.from("sessions").select("role, ended_at, last_seen").eq("token", token).maybeSingle();
  if (!data || data.ended_at || data.role !== "admin") return false;
  if (Date.now() - new Date(data.last_seen).getTime() > 12 * 3600 * 1000) return false;
  await sb.from("sessions").update({ last_seen: new Date().toISOString() }).eq("token", token);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "BAD_JSON" }, 400); }
  const action = String(body.action || "");

  // ---------- upload (associate) ----------
  if (action === "upload") {
    const token = String(body.token || "");
    const b64 = String(body.b64 || "").replace(/^data:image\/\w+;base64,/, "");
    if (!/^[0-9a-f-]{36}$/i.test(token) || !b64) return json({ ok: false, error: "BAD_INPUT" }, 400);
    const { data: p } = await sb.from("punches")
      .select("id, store_code, work_date, ts, photo_status, associate_id, associates(code)")
      .eq("photo_token", token).maybeSingle();
    if (!p || p.photo_status !== "pending") return json({ ok: false, error: "TOKEN_INVALID" }, 400);
    if (Date.now() - new Date(p.ts).getTime() > 15 * 60 * 1000) return json({ ok: false, error: "TOKEN_EXPIRED" }, 400);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (bytes.length > MAX_BYTES) return json({ ok: false, error: "TOO_BIG" }, 400);
    const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    const ext = isWebp ? "webp" : "jpg";
    const hhmm = new Date(new Date(p.ts).getTime() + 5.5 * 3600 * 1000).toISOString().slice(11, 16).replace(":", "");
    // deno-lint-ignore no-explicit-any
    const code = (p as any).associates?.code || String(p.associate_id);
    const path = `${String(p.work_date).slice(0, 7)}/${p.store_code}/${p.work_date}_${code}_${hhmm}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: isWebp ? "image/webp" : "image/jpeg", upsert: true });
    if (up.error) return json({ ok: false, error: up.error.message }, 500);
    await sb.from("punches").update({ photo_status: "done", photo_path: path, photo_token: null }).eq("id", p.id);
    return json({ ok: true, path, bytes: bytes.length });
  }

  // ---------- admin actions ----------
  if (!(await adminOk(String(body.session || "")))) return json({ ok: false, error: "FORBIDDEN" }, 403);

  if (action === "usage") {
    const { data, error } = await sb.rpc("_storage_usage");
    if (error) return json({ ok: false, error: error.message }, 500);
    const { count } = await sb.from("punches").select("id", { count: "exact", head: true }).eq("photo_status", "done");
    return json({ ok: true, bytes: Number(data || 0), limit: 1024 * 1024 * 1024, photos: count || 0 });
  }

  const from = String(body.from || ""), to = String(body.to || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return json({ ok: false, error: "BAD_DATES" }, 400);

  if (action === "list") {
    const { data: rows, error } = await sb.from("punches")
      .select("photo_path, store_code, work_date, category_id, associates(code, name)")
      .eq("photo_status", "done").gte("work_date", from).lte("work_date", to).order("work_date").limit(20000);
    if (error) return json({ ok: false, error: error.message }, 500);
    const paths = (rows || []).map((r) => r.photo_path as string);
    const urls: Record<string, string> = {};
    for (let i = 0; i < paths.length; i += 500) {
      const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 500), 3600);
      (data || []).forEach((d) => { if (d.path && d.signedUrl) urls[d.path] = d.signedUrl; });
    }
    // deno-lint-ignore no-explicit-any
    return json({ ok: true, files: (rows || []).map((r: any) => ({ path: r.photo_path, url: urls[r.photo_path], store: r.store_code,
      date: r.work_date, category: r.category_id, code: r.associates?.code, name: r.associates?.name })) });
  }

  if (action === "delete") {
    const { data: rows, error } = await sb.from("punches").select("id, photo_path")
      .eq("photo_status", "done").gte("work_date", from).lte("work_date", to).limit(20000);
    if (error) return json({ ok: false, error: error.message }, 500);
    const list = rows || [];
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const rm = await sb.storage.from(BUCKET).remove(chunk.map((r) => r.photo_path as string));
      if (rm.error) return json({ ok: false, error: rm.error.message, deleted: i }, 500);
      await sb.from("punches").update({ photo_status: "deleted" }).in("id", chunk.map((r) => r.id));
    }
    await sb.from("access_log").insert({ event: "photos_deleted", role: "admin", detail: `${from}..${to}: ${list.length}` });
    return json({ ok: true, deleted: list.length });
  }

  return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
});
