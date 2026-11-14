// Load test for the 3rd Party Attendance portal (run from your laptop, free):
//   1. Install k6: https://k6.io/docs/get-started/installation/  (Windows: winget install k6)
//   2. k6 run -e EMP=29001 -e PIN=xxxx -e USERS=5000 -e MODE=spike  k6_login_dashboard.js
//      MODE=spike  → all USERS start within ~10 s ("5000 at the same time")
//      MODE=steady → USERS spread over 10 minutes (real morning peak)
// Use a TEST AM login only. Never put a real PIN in this file.
import http from 'k6/http';
import { check, sleep } from 'k6';

const URL = 'https://phyllziizajuphenpwxz.supabase.co/rest/v1/rpc/';
const KEY = 'sb_publishable_KRASYzbWRPYoKzJItq-Gqw_zLwUvnX-';
const USERS = Number(__ENV.USERS || 5000);
const spike = (__ENV.MODE || 'spike') === 'spike';

export const options = {
  scenarios: { load: spike
    ? { executor: 'per-vu-iterations', vus: Math.min(USERS, 1000), iterations: Math.ceil(USERS / Math.min(USERS, 1000)), maxDuration: '5m' }
    : { executor: 'constant-arrival-rate', rate: Math.ceil(USERS / 600), timeUnit: '1s', duration: '10m', preAllocatedVUs: 200 } },
  thresholds: { http_req_failed: ['rate<0.02'], 'http_req_duration{fn:dash_overview}': ['p(95)<3000'] },
};
const H = { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' } };
const call = (fn, body) => http.post(URL + fn, JSON.stringify(body), { ...H, tags: { fn } });

export default function () {
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const login = call('auth_login', { p_role: 'am', p_emp: __ENV.EMP, p_post: null, p_store: null, p_dept: null, p_pin: __ENV.PIN, p_device: `k6-${__VU}-${__ITER}` });
  const tok = login.json('token');
  check(login, { 'login ok': (r) => r.status === 200 && !!tok });
  if (!tok) return;
  const d = call('dash_overview', { p_token: tok, p_date: today, p_shift: 'B', p_upto: null });
  check(d, { 'dashboard ok': (r) => r.status === 200 && r.json('ok') === true });
  call('dash_week', { p_token: tok, p_end: today, p_shift: 'B' });
  sleep(1);
  call('auth_logout', { p_token: tok });
}
