// strava-sync — puxa as atividades recentes do Strava do atleta logado,
// mapeia para modalidades, CONCILIA com os treinos planejados (mesma
// disciplina, data ±1 dia) e insere/atualiza os workouts com as métricas reais.
// Dedupe por (athlete_id, strava_id). verify_jwt=true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET") || "";
const DAYS = Number(Deno.env.get("STRAVA_SYNC_DAYS") || "30"); // só os últimos 30 dias

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const iso = (d: Date) => d.toISOString().slice(0, 10);
function mapDiscipline(type: string): string | null {
  const t = (type || "").toLowerCase();
  if (t.includes("run")) return "Corrida";
  if (t.includes("ride") || t.includes("bike") || t.includes("cycl")) return "Pedal";
  if (t.includes("swim")) return "Natação";
  if (t.includes("weight") || t === "workout" || t.includes("strength")) return "Força";
  return null; // ignora outros tipos
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "Strava não configurado no servidor." }, 500);

  const auth = req.headers.get("Authorization") || "";
  const { data: { user } } = await createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } }).auth.getUser();
  if (!user) return json({ error: "Não autenticado" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data: acc } = await admin.from("strava_accounts").select("*").eq("athlete_id", user.id).maybeSingle();
  if (!acc) return json({ error: "Strava não conectado" }, 400);

  // renova o token se expirado (com folga de 60s)
  let access = acc.access_token;
  if (!acc.expires_at || acc.expires_at * 1000 < Date.now() + 60000) {
    const r = await fetch("https://www.strava.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: acc.refresh_token }),
    });
    const t = await r.json();
    if (!r.ok || !t.access_token) return json({ error: "Falha ao renovar token do Strava", detail: t }, 502);
    access = t.access_token;
    await admin.from("strava_accounts").update({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at }).eq("athlete_id", user.id);
  }

  // busca atividades recentes (1ª sincronização puxa mais histórico)
  const after = Math.floor((Date.now() - DAYS * 86400000) / 1000);
  const actRes = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!actRes.ok) return json({ error: `Strava ${actRes.status}`, detail: (await actRes.text()).slice(0, 300) }, 502);
  const activities = await actRes.json();
  if (!Array.isArray(activities)) return json({ error: "Resposta inesperada do Strava" }, 502);

  let matched = 0, inserted = 0, skipped = 0;
  for (const act of activities) {
    const disc = mapDiscipline(act.type || act.sport_type);
    if (!disc) { skipped++; continue; }
    const date = String(act.start_date_local || act.start_date || "").slice(0, 10);
    if (!date) { skipped++; continue; }

    // já importado? (dedupe por strava_id)
    const { data: exists } = await admin.from("workouts").select("id").eq("athlete_id", user.id).eq("strava_id", act.id).maybeSingle();
    if (exists) { skipped++; continue; }

    const metrics = {
      duration_min: Math.round((act.moving_time || 0) / 60),
      distance: disc === "Natação" ? Math.round(act.distance || 0) : +(((act.distance || 0) / 1000).toFixed(2)),
      dist_unit: disc === "Natação" ? "m" : "km",
      avg_hr: act.average_heartrate ? Math.round(act.average_heartrate) : null,
      max_hr: act.max_heartrate ? Math.round(act.max_heartrate) : null,
      elevation_m: act.total_elevation_gain ? Math.round(act.total_elevation_gain) : null,
      avg_power: act.average_watts ? Math.round(act.average_watts) : null,
      source: "strava",
      strava_id: act.id,
      status: "concluído",
    };

    // tenta conciliar com um treino planejado (mesma disciplina, data ±1 dia, ainda sem vínculo)
    const lo = iso(new Date(Date.parse(date) - 86400000)), hi = iso(new Date(Date.parse(date) + 86400000));
    const { data: plans } = await admin.from("workouts").select("id,date").eq("athlete_id", user.id)
      .eq("discipline", disc).is("strava_id", null).neq("status", "concluído")
      .gte("date", lo).lte("date", hi).order("date", { ascending: true });
    const plan = (plans || []).sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(date)) - Math.abs(Date.parse(b.date) - Date.parse(date)))[0];

    if (plan) {
      await admin.from("workouts").update(metrics).eq("id", plan.id);
      matched++;
    } else {
      const { error } = await admin.from("workouts").insert({
        athlete_id: user.id, coach_id: null, date, discipline: disc,
        type: act.name || `${disc} (Strava)`, notes: "Importado do Strava", ...metrics,
      });
      if (error) { skipped++; continue; }
      inserted++;
    }
  }

  await admin.from("strava_accounts").update({ last_sync: new Date().toISOString() }).eq("athlete_id", user.id);
  return json({ ok: true, total: activities.length, matched, inserted, skipped });
});
