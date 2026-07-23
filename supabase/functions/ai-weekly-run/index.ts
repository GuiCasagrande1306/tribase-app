// ai-weekly-run — job semanal (domingo à noite): para cada atleta, analisa a
// semana e gera uma PROPOSTA de plano (pendente) para o treinador aprovar.
// Protegida por CRON_SECRET (não usa JWT). Chamada pelo pg_cron.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const responseSchema = {
  type: "object",
  properties: {
    analise: { type: "string" }, aderencia: { type: "string" },
    ajustes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" }, discipline: { type: "string" }, type: { type: "string" },
          duration_min: { type: "integer" }, distance: { type: "number" }, dist_unit: { type: "string" },
          target: { type: "string" }, notes: { type: "string" },
        },
        required: ["date", "discipline", "type", "duration_min", "target", "notes"],
      },
    },
  },
  required: ["analise", "ajustes"],
};

const SYSTEM = `Você é um treinador de triathlon/corrida experiente e baseado em ciência do esporte.
Recebe os dados REAIS da última(s) semana(s) de um atleta (planejado × realizado, com FC, distância, ritmo e RPE) e o perfil/meta dele.
Analise a semana e PROPONHA os treinos da PRÓXIMA semana, ajustados à performance e à fadiga.
PRINCÍPIOS: distribuição polarizada (~80% fácil/20% forte); sobrecarga gradual (recue se aderência baixa ou sinais de fadiga; progrida ~5-10% se respondeu bem); VARIE o formato das sessões vs. a semana anterior; planeje EXATAMENTE "treinosPorSemana" sessões; respeite a MODALIDADE (Triathlon: nado/bike/corrida + brick e sábado com 2 modalidades/transição; Corrida/Natação/Ciclismo: foco só nesse esporte, sem brick); tire ritmos/FC dos dados reais (não invente); use as datas reais a partir de "hoje".
Escreva a "analise" em português, curta e direta (o treinador humano vai revisar). Devolva SOMENTE o JSON no schema.`;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
function paceStr(w: any): string | null {
  if (!w.duration_min || !w.distance) return null;
  if (w.discipline === "Pedal" || w.discipline === "Brick") { const k = w.distance / (w.duration_min / 60); return isFinite(k) ? `${k.toFixed(1)} km/h` : null; }
  if (w.discipline === "Natação") return `${mmss((w.duration_min * 60) / (w.distance / 100))}/100m`;
  return `${mmss((w.duration_min * 60) / w.distance)}/km`;
}
function bestPaces(done: any[]) {
  const out: Record<string, string> = {};
  const by: Record<string, any[]> = {};
  for (const w of done) { if (w.distance && w.duration_min) (by[w.discipline] ||= []).push(w); }
  for (const [disc, ws] of Object.entries(by)) {
    const faster = disc === "Pedal" || disc === "Brick"
      ? ws.reduce((a, b) => (b.distance / b.duration_min > a.distance / a.duration_min ? b : a))
      : ws.reduce((a, b) => (b.duration_min / b.distance < a.duration_min / a.distance ? b : a));
    const p = paceStr(faster); if (p) out[disc] = p;
  }
  return out;
}

async function gemini(payload: unknown) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${SYSTEM}\n\nDADOS DO ATLETA (JSON):\n${JSON.stringify(payload, null, 2)}` }] }],
      generationConfig: { temperature: 0.6, responseMimeType: "application/json", responseSchema },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const t = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(t);
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET)
    return new Response(JSON.stringify({ error: "não autorizado" }), { status: 401 });
  if (!GEMINI_KEY) return new Response(JSON.stringify({ error: "GEMINI_API_KEY ausente" }), { status: 500 });

  const admin = createClient(SUPABASE_URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  const today = iso(new Date());
  // próxima segunda (início da semana que o plano cobre)
  const d = new Date(); const dow = d.getUTCDay(); const add = ((8 - dow) % 7) || 7;
  const weekStart = iso(new Date(Date.now() + add * 86400000));

  let atletas = admin.from("profiles").select("id,full_name,email,coach_id,modality,race,race_date,goal,days_per_week")
    .eq("role", "athlete").not("coach_id", "is", null);
  if (body.athlete_id) atletas = admin.from("profiles").select("id,full_name,email,coach_id,modality,race,race_date,goal,days_per_week").eq("id", body.athlete_id);
  const { data: list } = await atletas;
  if (!list?.length) return new Response(JSON.stringify({ ok: true, gerados: 0, msg: "sem atletas" }), { headers: { "Content-Type": "application/json" } });

  let gerados = 0; const erros: string[] = [];
  for (const a of list) {
    try {
      // já existe proposta pendente pra essa semana?
      const { data: exist } = await admin.from("ai_proposals").select("id").eq("athlete_id", a.id).eq("week_start", weekStart).eq("status", "pending").maybeSingle();
      if (exist) continue;

      const from = iso(new Date(Date.now() - 60 * 86400000));
      const { data: ws } = await admin.from("workouts").select("date,discipline,type,duration_min,distance,dist_unit,avg_hr,rpe,status").eq("athlete_id", a.id).gte("date", from).order("date");
      const all = ws || [];
      const compact = (w: any) => ({ data: w.date, modalidade: w.discipline, sessao: w.type, duracaoMin: w.duration_min || null, distancia: w.distance || null, unidade: w.dist_unit, ritmo: paceStr(w), fcMedia: w.avg_hr || null, rpe: w.rpe || null, status: w.status });
      const done = all.filter((w) => w.status === "concluído");
      const win = all.filter((w) => w.date >= iso(new Date(Date.now() - 14 * 86400000)));
      const weeksToRace = a.race_date ? Math.max(0, Math.ceil((Date.parse(a.race_date) - Date.now()) / (86400000 * 7))) : null;
      const payload = {
        hoje: today,
        atleta: { nome: a.full_name || a.email, modalidade: a.modality || null, prova: a.race || null, dataProva: a.race_date || null, meta: a.goal || null, semanasParaProva: weeksToRace, treinosPorSemana: a.days_per_week || null },
        melhoresRitmos: bestPaces(done),
        ultimasDuasSemanas: { planejados: win.filter((w) => w.status !== "concluído" && w.date < today).map(compact), realizados: win.filter((w) => w.status === "concluído").map(compact) },
      };

      const result = await gemini(payload);
      await admin.from("ai_proposals").insert({
        athlete_id: a.id, coach_id: a.coach_id, week_start: weekStart, status: "pending",
        source: body.athlete_id ? "manual" : "auto", analysis: result.analise, adherence: result.aderencia || null, workouts: result.ajustes || [],
      });
      gerados++;
    } catch (e) { erros.push(`${a.email}: ${String(e).slice(0, 120)}`); }
  }
  return new Response(JSON.stringify({ ok: true, gerados, total: list.length, erros }), { headers: { "Content-Type": "application/json" } });
});
