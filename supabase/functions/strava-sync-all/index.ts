// strava-sync-all — job diário: para CADA atleta com Strava conectado, puxa as
// atividades dos ÚLTIMOS 30 DIAS, mapeia, concilia com o planejado e salva no
// histórico (status concluído). Automático — não depende do aluno clicar.
// Protegida por CRON_SECRET (não usa JWT). Chamada pelo pg_cron.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const DAYS = Number(Deno.env.get("STRAVA_SYNC_DAYS") || "30");

const iso = (d: Date) => d.toISOString().slice(0, 10);
function mapDiscipline(type: string): string | null {
  const t = (type || "").toLowerCase();
  if (t.includes("run")) return "Corrida";
  if (t.includes("ride") || t.includes("bike") || t.includes("cycl")) return "Pedal";
  if (t.includes("swim")) return "Natação";
  if (t.includes("weight") || t === "workout" || t.includes("strength")) return "Força";
  return null;
}

async function syncOne(admin: any, acc: any): Promise<{ matched: number; inserted: number; skipped: number }> {
  let access = acc.access_token;
  if (!acc.expires_at || acc.expires_at * 1000 < Date.now() + 60000) {
    const r = await fetch("https://www.strava.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: acc.refresh_token }),
    });
    const t = await r.json();
    if (!r.ok || !t.access_token) throw new Error(`refresh ${r.status}`);
    access = t.access_token;
    await admin.from("strava_accounts").update({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at }).eq("athlete_id", acc.athlete_id);
  }
  const after = Math.floor((Date.now() - DAYS * 86400000) / 1000);
  const actRes = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100`, { headers: { Authorization: `Bearer ${access}` } });
  if (!actRes.ok) throw new Error(`activities ${actRes.status}`);
  const activities = await actRes.json();
  if (!Array.isArray(activities)) throw new Error("resposta inesperada");

  let matched = 0, inserted = 0, skipped = 0;
  for (const act of activities) {
    const disc = mapDiscipline(act.type || act.sport_type);
    if (!disc) { skipped++; continue; }
    const date = String(act.start_date_local || act.start_date || "").slice(0, 10);
    if (!date) { skipped++; continue; }
    const { data: exists } = await admin.from("workouts").select("id").eq("athlete_id", acc.athlete_id).eq("strava_id", act.id).maybeSingle();
    if (exists) { skipped++; continue; }
    const metrics = {
      duration_min: Math.round((act.moving_time || 0) / 60),
      distance: disc === "Natação" ? Math.round(act.distance || 0) : +(((act.distance || 0) / 1000).toFixed(2)),
      dist_unit: disc === "Natação" ? "m" : "km",
      avg_hr: act.average_heartrate ? Math.round(act.average_heartrate) : null,
      max_hr: act.max_heartrate ? Math.round(act.max_heartrate) : null,
      elevation_m: act.total_elevation_gain ? Math.round(act.total_elevation_gain) : null,
      avg_power: act.average_watts ? Math.round(act.average_watts) : null,
      source: "strava", strava_id: act.id, status: "concluído",
    };
    const lo = iso(new Date(Date.parse(date) - 86400000)), hi = iso(new Date(Date.parse(date) + 86400000));
    const { data: plans } = await admin.from("workouts").select("id,date").eq("athlete_id", acc.athlete_id)
      .eq("discipline", disc).is("strava_id", null).neq("status", "concluído").gte("date", lo).lte("date", hi).order("date", { ascending: true });
    const plan = (plans || []).sort((a: any, b: any) => Math.abs(Date.parse(a.date) - Date.parse(date)) - Math.abs(Date.parse(b.date) - Date.parse(date)))[0];
    if (plan) { await admin.from("workouts").update(metrics).eq("id", plan.id); matched++; }
    else {
      const { error } = await admin.from("workouts").insert({ athlete_id: acc.athlete_id, coach_id: null, date, discipline: disc, type: act.name || `${disc} (Strava)`, notes: "Importado do Strava", ...metrics });
      if (error) { skipped++; continue; }
      inserted++;
    }
  }
  await admin.from("strava_accounts").update({ last_sync: new Date().toISOString() }).eq("athlete_id", acc.athlete_id);
  return { matched, inserted, skipped };
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET)
    return new Response(JSON.stringify({ error: "não autorizado" }), { status: 401 });
  if (!CLIENT_ID || !CLIENT_SECRET) return new Response(JSON.stringify({ error: "Strava não configurado" }), { status: 500 });

  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data: accs } = await admin.from("strava_accounts").select("*");
  let atletas = 0, matched = 0, inserted = 0; const erros: string[] = [];
  for (const acc of accs || []) {
    try { const r = await syncOne(admin, acc); atletas++; matched += r.matched; inserted += r.inserted; }
    catch (e) { erros.push(`${acc.athlete_id}: ${String(e).slice(0, 120)}`); }
  }
  return new Response(JSON.stringify({ ok: true, atletas, matched, inserted, erros }), { headers: { "Content-Type": "application/json" } });
});
