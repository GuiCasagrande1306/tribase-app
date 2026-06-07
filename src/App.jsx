import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { supabase } from "./supabaseClient.js";
import { parseImportFiles, parsePlanText, matchPlan } from "./import.js";

// gráficos (recharts) carregados sob demanda → fora do bundle inicial
const Reports = lazy(() => import("./charts.jsx").then((m) => ({ default: m.Reports })));
const Evolution = lazy(() => import("./charts.jsx").then((m) => ({ default: m.Evolution })));
const PlanVsActual = lazy(() => import("./charts.jsx").then((m) => ({ default: m.PlanVsActual })));
import {
  Waves, Bike, Footprints, Layers, Dumbbell, Moon, Plus, Trash2, Check,
  ChevronLeft, Users, LogOut, Activity, Calendar, BarChart3, Flag, Mail, Copy, Upload,
  Flame, Trophy, X, Heart, Mountain, Zap, FileText, Gauge, Download, AlertTriangle, CheckCircle2, ChevronRight,
  TrendingUp, TrendingDown,
} from "lucide-react";

/* ================= tema ================= */
export const INK = "#0a0e1a", PANEL = "#0f1626", PANEL2 = "#141d31", LINE = "#1e2a44";
export const TEXT = "#e7ecf5", MUTE = "#8a98b4", ACCENT = "#ff5a3c";
export const DISC = {
  "Natação": { c: "#22d3ee", icon: Waves },
  "Pedal": { c: "#f5a524", icon: Bike },
  "Corrida": { c: "#a3e635", icon: Footprints },
  "Brick": { c: "#c084fc", icon: Layers },
  "Força": { c: "#7dd3fc", icon: Dumbbell },
  "Descanso": { c: "#64748b", icon: Moon },
};
export const DISCIPLINES = Object.keys(DISC);
const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;900&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
html,body{margin:0;background:#0a0e1a}
*{-webkit-tap-highlight-color:transparent}
button{touch-action:manipulation}
::-webkit-scrollbar{width:9px;height:9px}::-webkit-scrollbar-thumb{background:#23314f;border-radius:9px}
input,select,textarea,button{font-family:inherit}
.disp{font-family:'Archivo',system-ui,sans-serif}.mono{font-family:'JetBrains Mono',ui-monospace,monospace}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}.rise{animation:rise .5s cubic-bezier(.2,.7,.3,1) both}
`;

/* ================= helpers ================= */
export function toDate(s) { return new Date(s + "T00:00:00"); }
export function weekStart(s) { const d = toDate(s); const o = (d.getDay() + 6) % 7; d.setDate(d.getDate() - o); return d; }
export function dm(d) { return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; }
export function todayISO() { return new Date().toISOString().slice(0, 10); }
export function addDays(iso, n) { const d = toDate(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
export function sum(a) { return a.reduce((x, y) => x + (y || 0), 0); }
export function mmss(totalSec) { const s = Math.round(totalSec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
/* formata tempo: 6h, 6h30, 48min (nunca decimal tipo 6.0h) */
export function fmtDur(min) {
  const m = Math.round(min || 0);
  if (m <= 0) return "0min";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r === 0 ? `${h}h` : `${h}h${String(r).padStart(2, "0")}`;
}
/* ritmo/velocidade por modalidade (a partir de duração + distância) */
function paceStr(w) {
  if (!w.durationMin || !w.distance) return null;
  if (w.discipline === "Pedal" || w.discipline === "Brick") {
    const kmh = w.distance / (w.durationMin / 60);
    return isFinite(kmh) ? `${kmh.toFixed(1)} km/h` : null;
  }
  if (w.discipline === "Natação") {
    return `${mmss((w.durationMin * 60) / (w.distance / 100))}/100m`;
  }
  return `${mmss((w.durationMin * 60) / w.distance)}/km`;
}
/* sequência de dias com ao menos um treino concluído, contando de hoje pra trás */
function computeStreak(workouts) {
  const done = new Set(workouts.filter((w) => w.status === "concluído").map((w) => w.date));
  if (!done.size) return 0;
  let streak = 0, cur = todayISO();
  if (!done.has(cur)) cur = addDays(cur, -1); // tolera ainda não ter treinado hoje
  while (done.has(cur)) { streak++; cur = addDays(cur, -1); }
  return streak;
}
/* hook simples de media query (para layouts responsivos sem CSS framework) */
function useMediaQuery(query) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener ? m.addEventListener("change", on) : m.addListener(on);
    window.addEventListener("resize", on);
    return () => {
      m.removeEventListener ? m.removeEventListener("change", on) : m.removeListener(on);
      window.removeEventListener("resize", on);
    };
  }, [query]);
  return match;
}
function mapW(r) {
  return {
    id: r.id, date: r.date, discipline: r.discipline, type: r.type,
    durationMin: r.duration_min || 0, distance: Number(r.distance) || 0,
    distUnit: r.dist_unit || "km", target: r.target || "", notes: r.notes || "",
    status: r.status, rpe: r.rpe, source: r.source || null,
    avgHr: r.avg_hr ?? null, maxHr: r.max_hr ?? null, elevationM: r.elevation_m ?? null,
    calories: r.calories ?? null, avgPower: r.avg_power ?? null,
  };
}

/* ================= modo demo (login desativado) =================
   Com DEMO=true o app abre direto como atleta, com dados de exemplo em memória —
   sem Supabase, sem login. Para ligar o backend real: troque para false e
   configure o .env (ver README). */
export const DEMO = false;

const _diso = (n) => addDays(todayISO(), n); // datas de exemplo relativas a hoje
const demoCoachProfile = {
  id: "demo-coach", email: "treinador@demo.tribase", full_name: "Treinador Demo", role: "coach", coach_id: null,
};
const demoProfile = {
  id: "demo-athlete", email: "atleta@demo.tribase", full_name: "Atleta Demo",
  role: "athlete", coach_id: "demo-coach", race: "Meio Ironman 70.3",
  race_date: _diso(84), goal: "5h30",
};
const _athlete2 = {
  id: "demo-a2", email: "marina@demo.tribase", full_name: "Marina Costa",
  role: "athlete", coach_id: "demo-coach", race: "Triathlon Olímpico", race_date: _diso(28), goal: "2h35",
};
const _athlete3 = {
  id: "demo-a3", email: "rafael@demo.tribase", full_name: "Rafael Lima",
  role: "athlete", coach_id: "demo-coach", race: "Ironman", race_date: _diso(140), goal: "11h00",
};
let demoAthletes = [demoProfile, _athlete2, _athlete3];
let _seq = 1;
const _row = (o) => ({
  id: "demo-" + (_seq++), athlete_id: "demo-athlete", coach_id: "demo-coach",
  dist_unit: "km", status: "planejado", rpe: null, source: null, target: "", notes: "",
  distance: 0, duration_min: 0, avg_hr: null, max_hr: null, elevation_m: null, calories: null, avg_power: null, ...o,
});
// histórico (≈9 semanas) com pace/FC melhorando — alimenta a aba Evolução
function _hist() {
  const r = [];
  for (let wk = 10; wk >= 1; wk--) {
    const base = -(wk * 7);
    const p = (10 - wk) / 9;                        // 0 (antigo) .. 1 (recente)
    const runSec = Math.round(352 - p * 52);       // 5:52 -> 5:00 /km
    const swim100 = Math.round(154 - p * 22);      // 2:34 -> 2:12 /100m
    const bikeKmh = +(24.5 + p * 5).toFixed(1);    // 24,5 -> 29,5 km/h
    const z2 = Math.round(154 - p * 12);           // FC Z2 154 -> 142 (eficiência)
    const thr = Math.round(170 - p * 8);           // FC limiar 170 -> 162
    const longMin = Math.round(60 + p * 45);       // 60 -> 105 min (volume sobe)
    const longDist = +(longMin / ((runSec + 55) / 60)).toFixed(1);
    // o histórico é o PLANO cumprido (source null); os extras importados ficam nas linhas recentes
    r.push(_row({ date: _diso(base + 1), discipline: "Corrida", type: "Limiar 3×8'", duration_min: Math.round((runSec * 9) / 60), distance: 9, target: "limiar", status: "concluído", rpe: 7, avg_hr: thr, max_hr: thr + 12, calories: 600 }));
    r.push(_row({ date: _diso(base + 3), discipline: "Natação", type: "CSS 6×100m", duration_min: Math.round((swim100 * 20) / 60), distance: 2000, dist_unit: "m", target: "CSS", status: "concluído", rpe: 6, avg_hr: z2 - 6, calories: 420 }));
    r.push(_row({ date: _diso(base + 4), discipline: "Pedal", type: "Z2 endurance", duration_min: 80, distance: +((bikeKmh * 80) / 60).toFixed(1), target: `Z2 FC ${z2 - 8}-${z2}`, status: "concluído", rpe: 5, avg_hr: z2, elevation_m: 320, calories: 950, avg_power: Math.round(150 + p * 30) }));
    r.push(_row({ date: _diso(base + 6), discipline: "Corrida", type: "Longão Z2", duration_min: longMin, distance: longDist, target: "fácil Z2", status: "concluído", rpe: 5, avg_hr: z2 - 2, calories: 800 }));
  }
  return r;
}
let demoWorkouts = [
  ..._hist(),
  // Atleta Demo (equilibrado, em dia)
  _row({ date: _diso(-7), discipline: "Natação", type: "Técnica + CSS 6×100m", duration_min: 44, distance: 2000, dist_unit: "m", target: "CSS 1:45/100m", notes: "Foco no catch e na rolagem. 15s entre os tiros.", status: "concluído", rpe: 6, source: "import", avg_hr: 138, max_hr: 158, calories: 410 }),
  _row({ date: _diso(-6), discipline: "Pedal", type: "Z2 endurance", duration_min: 90, distance: 44, target: "FC 135-145", notes: "Cadência 90+ rpm, sem estourar a FC.", status: "concluído", rpe: 5, source: "import", avg_hr: 141, max_hr: 168, elevation_m: 520, calories: 1100, avg_power: 182 }),
  _row({ date: _diso(-5), discipline: "Corrida", type: "Limiar 3×8'", duration_min: 50, distance: 10.2, target: "4:30/km", notes: "Aquece 15', 3×8' no limiar com 2' de trote, solta 10'.", status: "concluído", rpe: 8, source: "import", avg_hr: 169, max_hr: 184, elevation_m: 60, calories: 650 }),
  _row({ date: _diso(-3), discipline: "Força", type: "Core + estabilidade", duration_min: 40, status: "concluído", rpe: 4 }),
  _row({ date: _diso(-2), discipline: "Corrida", type: "Longão Z2", duration_min: 100, distance: 17.8, target: "5:15/km", notes: "Nutrição a cada 30'. Manter conversa fácil.", status: "concluído", rpe: 6, source: "import", avg_hr: 150, max_hr: 164, elevation_m: 230, calories: 1180 }),
  _row({ date: _diso(-1), discipline: "Pedal", type: "Recuperação ativa", duration_min: 45, distance: 18, target: "Z1, giro leve", notes: "Pernas leves para o fim de semana.", status: "concluído", rpe: 3, source: "import", avg_hr: 122, max_hr: 138, elevation_m: 90, calories: 480 }),
  _row({ date: _diso(0), discipline: "Natação", type: "Força 8×50m + soltura", duration_min: 45, distance: 1800, dist_unit: "m", target: "forte, descanso 20s", notes: "Pull buoy nos pares." }),
  _row({ date: _diso(1), discipline: "Pedal", type: "Sweet spot 3×12'", duration_min: 75, distance: 35, target: "88-93% FTP", notes: "Recuperação 5' entre blocos." }),
  _row({ date: _diso(2), discipline: "Corrida", type: "Regenerativo", duration_min: 35, distance: 6, target: "5:40/km", notes: "Bem leve, pós-limiar." }),
  _row({ date: _diso(4), discipline: "Brick", type: "Bike 50' + Run 20'", duration_min: 70, distance: 28, target: "ritmo de prova", notes: "Transição rápida; 1º km da corrida controlado." }),
  _row({ date: _diso(6), discipline: "Corrida", type: "Longão progressivo", duration_min: 105, distance: 19, target: "5:20→4:50/km", notes: "Últimos 20' mais fortes." }),
  // Marina Costa (atrasada — vários planejados vencidos não feitos)
  _row({ athlete_id: "demo-a2", date: _diso(-6), discipline: "Corrida", type: "Intervalado 6×800m", duration_min: 50, distance: 9, target: "4:10/km", status: "concluído", rpe: 7, source: "import", avg_hr: 172 }),
  _row({ athlete_id: "demo-a2", date: _diso(-4), discipline: "Natação", type: "Limiar 5×200m", duration_min: 45, distance: 1900, dist_unit: "m", target: "CSS", notes: "Sessão não realizada." }),
  _row({ athlete_id: "demo-a2", date: _diso(-3), discipline: "Pedal", type: "Z3 tempo 2×20'", duration_min: 70, distance: 32, target: "FC limiar" }),
  _row({ athlete_id: "demo-a2", date: _diso(-1), discipline: "Corrida", type: "Tempo 6km", duration_min: 35, distance: 6, target: "4:20/km" }),
  _row({ athlete_id: "demo-a2", date: _diso(0), discipline: "Força", type: "Geral + core", duration_min: 40 }),
  _row({ athlete_id: "demo-a2", date: _diso(2), discipline: "Pedal", type: "Z2 longo", duration_min: 90, distance: 40, target: "FC 140-150" }),
  // Rafael Lima (em dia, importou do Strava recentemente, alta aderência)
  _row({ athlete_id: "demo-a3", date: _diso(-5), discipline: "Pedal", type: "Longo Z2 90km", duration_min: 180, distance: 90, target: "FC 130-140", status: "concluído", rpe: 6, source: "import", avg_hr: 136, elevation_m: 980, calories: 2400, avg_power: 175 }),
  _row({ athlete_id: "demo-a3", date: _diso(-4), discipline: "Corrida", type: "Rodagem Z2", duration_min: 70, distance: 12.5, target: "5:30/km", status: "concluído", rpe: 5, source: "import", avg_hr: 144 }),
  _row({ athlete_id: "demo-a3", date: _diso(-2), discipline: "Natação", type: "Endurance 3000m", duration_min: 60, distance: 3000, dist_unit: "m", status: "concluído", rpe: 5 }),
  _row({ athlete_id: "demo-a3", date: _diso(-1), discipline: "Corrida", type: "Longão 24km", duration_min: 140, distance: 24, target: "5:40/km", status: "concluído", rpe: 7, source: "import", avg_hr: 150, elevation_m: 320, calories: 1700 }),
  _row({ athlete_id: "demo-a3", date: _diso(0), discipline: "Pedal", type: "Recuperação", duration_min: 50, distance: 22, target: "Z1" }),
  _row({ athlete_id: "demo-a3", date: _diso(2), discipline: "Brick", type: "Bike 120' + Run 30'", duration_min: 150, distance: 65, target: "ritmo IM" }),
  _row({ athlete_id: "demo-a3", date: _diso(5), discipline: "Natação", type: "Técnica + 1×1500m", duration_min: 55, distance: 2500, dist_unit: "m" }),
];

const _ok = { error: null }; // espelha o formato de retorno do supabase-js
const demoApi = {
  myProfile: async () => demoProfile,
  becomeCoach: async () => _ok,
  linkAthlete: async () => _ok,
  listAthletes: async () => demoAthletes.slice(),
  pendingAthletes: async () => [{ id: "demo-pend", email: "novo.aluno@email.com", full_name: "Novo Aluno", created_at: _diso(0) }],
  unlinkAthlete: async (athleteId) => { demoAthletes = demoAthletes.filter((a) => a.id !== athleteId); return _ok; },
  updateProfile: async (id, fields) => { const p = demoAthletes.find((a) => a.id === id); if (p) Object.assign(p, fields); return _ok; },
  listWorkouts: async (athleteId) => demoWorkouts.filter((w) => w.athlete_id === athleteId).sort((a, b) => a.date.localeCompare(b.date)).map(mapW),
  addWorkout: async (w) => { demoWorkouts.push(_row(w)); return _ok; },
  addWorkouts: async (rows) => { rows.forEach((r) => demoWorkouts.push(_row(r))); return _ok; },
  updateWorkout: async (id, fields) => { const w = demoWorkouts.find((x) => x.id === id); if (w) Object.assign(w, fields); return _ok; },
  deleteWorkout: async (id) => { const i = demoWorkouts.findIndex((x) => x.id === id); if (i >= 0) demoWorkouts.splice(i, 1); return _ok; },
};

/* ================= data layer ================= */
const supaApi = {
  myProfile: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return null;
    const { data } = await supabase.from("profiles").select("*").eq("id", u.user.id).single();
    return data;
  },
  becomeCoach: async () => supabase.rpc("become_coach"),
  linkAthlete: async (email) => supabase.rpc("link_athlete", { athlete_email: email }),
  listAthletes: async (coachId) =>
    (await supabase.from("profiles").select("*").eq("coach_id", coachId).order("full_name")).data || [],
  pendingAthletes: async () => (await supabase.rpc("pending_athletes")).data || [],
  unlinkAthlete: async (athleteId) => supabase.rpc("unlink_athlete", { p_athlete: athleteId }),
  updateProfile: async (id, fields) => supabase.from("profiles").update(fields).eq("id", id),
  listWorkouts: async (athleteId) => {
    const { data } = await supabase.from("workouts").select("*").eq("athlete_id", athleteId).order("date");
    return (data || []).map(mapW);
  },
  addWorkout: async (w) => supabase.from("workouts").insert(w),
  addWorkouts: async (rows) => supabase.from("workouts").insert(rows),
  updateWorkout: async (id, fields) => supabase.from("workouts").update(fields).eq("id", id),
  deleteWorkout: async (id) => supabase.from("workouts").delete().eq("id", id),
};

const api = DEMO ? demoApi : supaApi;

/* ================= App ================= */
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);

  const refreshProfile = useCallback(async () => {
    const p = await api.myProfile();
    setProfile(p);
  }, []);

  useEffect(() => {
    if (DEMO) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (DEMO) return;
    (async () => {
      setReady(false);
      if (session) await refreshProfile(); else setProfile(null);
      setReady(true);
    })();
  }, [session, refreshProfile]);

  return (
    <div style={shell.root}>
      <style>{FONTS}</style>
      <div style={shell.glow1} /><div style={shell.glow2} />
      <div style={{ position: "relative", zIndex: 2 }}>
        {DEMO ? (
          <DemoShell />
        ) : (
          <>
            {!session && <Auth />}
            {session && !ready && <Center>carregando…</Center>}
            {session && ready && profile && profile.role === "coach" && (
              <CoachArea profile={profile} onLogout={() => supabase.auth.signOut()} />
            )}
            {session && ready && profile && profile.role !== "coach" && profile.coach_id && (
              <AthleteArea profile={profile} onLogout={() => supabase.auth.signOut()} />
            )}
            {session && ready && profile && profile.role !== "coach" && !profile.coach_id && (
              <Onboarding profile={profile} onBecomeCoach={async () => { await api.becomeCoach(); await refreshProfile(); }}
                onLogout={() => supabase.auth.signOut()} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ================= modo demo: alternador de papel ================= */
const demoLogout = () => window.alert("Modo demo: o login está desativado. Para ligar o Supabase, mude DEMO para false em src/App.jsx e configure o .env (ver README).");
function DemoShell() {
  const [role, setRole] = useState("athlete");
  return (
    <>
      {role === "athlete"
        ? <AthleteArea profile={demoProfile} onLogout={demoLogout} />
        : <CoachArea profile={demoCoachProfile} onLogout={demoLogout} />}
      <DemoRoleToggle role={role} setRole={setRole} />
    </>
  );
}
function DemoRoleToggle({ role, setRole }) {
  return (
    <div style={{
      position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(14px + env(safe-area-inset-bottom))", zIndex: 60,
      display: "flex", alignItems: "center", gap: 6, padding: 6, borderRadius: 14,
      background: "rgba(15,22,38,0.92)", border: `1px solid ${LINE}`, backdropFilter: "blur(8px)", boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
    }}>
      <span style={{ fontSize: 10.5, color: MUTE, padding: "0 6px", textTransform: "uppercase", letterSpacing: 0.6 }}>demo</span>
      {[["athlete", "Atleta", Activity], ["coach", "Treinador", Users]].map(([k, label, Icon]) => (
        <button key={k} onClick={() => setRole(k)} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700,
          border: `1px solid ${role === k ? ACCENT : LINE}`, background: role === k ? "rgba(255,90,60,0.14)" : PANEL2, color: role === k ? "#ffd9cf" : MUTE,
        }}><Icon size={14} /> {label}</button>
      ))}
    </div>
  );
}

/* ================= Auth ================= */
function Auth() {
  const [mode, setMode] = useState("in");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email, password: pass, options: { data: { full_name: name } },
        });
        if (error) throw error;
        setMsg({ ok: true, t: "Conta criada! Se a confirmação por email estiver ligada, confirme e depois entre." });
      }
    } catch (e) { setMsg({ ok: false, t: e.message || "Erro" }); }
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: "70px 22px" }} className="rise">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}><Logo big /></div>
      <p style={{ textAlign: "center", color: MUTE, fontSize: 13.5, marginBottom: 26 }}>
        Sua base de treinos de triathlon
      </p>
      <div style={card.base}>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {[["in", "Entrar"], ["up", "Criar conta"]].map(([k, l]) => (
            <button key={k} onClick={() => { setMode(k); setMsg(null); }} style={{
              flex: 1, padding: "9px 0", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13.5,
              border: `1px solid ${mode === k ? ACCENT : LINE}`,
              background: mode === k ? "rgba(255,90,60,0.12)" : PANEL2,
              color: mode === k ? "#ffd9cf" : MUTE,
            }}>{l}</button>
          ))}
        </div>
        {mode === "up" && (
          <Field label="Nome"><input style={inp.base} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        )}
        <Field label="Email"><input style={inp.base} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Senha"><input style={inp.base} type="password" value={pass}
          onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></Field>
        {msg && <div style={{ fontSize: 12.5, marginTop: 6, color: msg.ok ? "#a3e635" : "#ff8a73" }}>{msg.t}</div>}
        <button disabled={busy} onClick={submit} style={{ ...btn.solid, width: "100%", marginTop: 14, opacity: busy ? 0.6 : 1 }}>
          {busy ? "…" : mode === "in" ? "Entrar" : "Criar conta"}
        </button>
      </div>
      <p style={{ textAlign: "center", color: MUTE, fontSize: 11.5, marginTop: 18, lineHeight: 1.5 }}>
        Treinador cria a conta e ativa o modo treinador. Atleta cria a conta e compartilha o email com o treinador para ser vinculado.
      </p>
    </div>
  );
}

/* ================= Onboarding (atleta sem vínculo) ================= */
function Onboarding({ profile, onBecomeCoach, onLogout }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(profile.email); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <Frame title="Bem-vindo" subtitle={profile.email} onExit={onLogout} exitLabel="sair" logout>
      <div style={{ ...card.base, maxWidth: 520 }} className="rise">
        <SectionTitle>Você ainda não está vinculado a um treinador</SectionTitle>
        <p style={{ color: MUTE, fontSize: 13.5, lineHeight: 1.6 }}>
          Compartilhe seu email com seu treinador para ele te adicionar. Assim que ele vincular, seus treinos aparecem aqui.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "14px 0", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 11, padding: "10px 12px" }}>
          <Mail size={16} color={MUTE} />
          <span className="mono" style={{ flex: 1, fontSize: 13, color: TEXT }}>{profile.email}</span>
          <button onClick={copy} style={btn.ghost}><Copy size={14} /> {copied ? "copiado" : "copiar"}</button>
        </div>
        <div style={{ height: 1, background: LINE, margin: "18px 0" }} />
        <p style={{ color: MUTE, fontSize: 13 }}>É você o treinador?</p>
        <button onClick={onBecomeCoach} style={{ ...btn.outline, marginTop: 8 }}><Users size={15} /> Ativar modo treinador</button>
      </div>
    </Frame>
  );
}

/* ================= Coach ================= */
function athleteStats(workouts, athlete) {
  const today = todayISO();
  const wkStart = weekStart(today).toISOString().slice(0, 10);
  const wkEnd = addDays(wkStart, 6);
  const done = workouts.filter((w) => w.status === "concluído");
  const past = workouts.filter((w) => w.date < today); // só dias já passados contam p/ aderência/atraso
  const pastDone = past.filter((w) => w.status === "concluído").length;
  const overdue = past.length - pastDone;
  const thisWeek = workouts.filter((w) => w.date >= wkStart && w.date <= wkEnd);
  const weekDone = thisWeek.filter((w) => w.status === "concluído").length;
  const futurePlanned = workouts.filter((w) => w.date > today && w.status !== "concluído");
  const lastDone = done.map((w) => w.date).sort().pop() || null;
  const daysSinceLast = lastDone ? Math.round((Date.parse(today) - Date.parse(lastDone)) / 86400000) : null;
  const recentImport = workouts.some((w) => w.source && w.status === "concluído" && w.date >= addDays(today, -7));
  const adher = past.length ? Math.round((pastDone / past.length) * 100) : null;
  const daysToRace = athlete?.race_date ? Math.max(0, Math.ceil((toDate(athlete.race_date) - new Date()) / 86400000)) : null;
  const hasPlan = futurePlanned.length > 0;
  const needsAttention = overdue >= 2 || !hasPlan || (daysSinceLast != null && daysSinceLast > 10);
  return { total: workouts.length, done: done.length, weekDone, weekTotal: thisWeek.length, overdue, adher, daysSinceLast, recentImport, daysToRace, hasPlan, needsAttention };
}
function ViewSwitch({ view, setView }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
      {[["athletes", "Meus atletas", Users], ["me", "Meu treino", Activity]].map(([k, l, Icon]) => (
        <button key={k} onClick={() => setView(k)} style={{
          display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", borderRadius: 11, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
          border: `1px solid ${view === k ? ACCENT : LINE}`, background: view === k ? "rgba(255,90,60,0.12)" : PANEL, color: view === k ? "#ffd9cf" : MUTE,
        }}><Icon size={15} /> {l}</button>
      ))}
    </div>
  );
}
function CoachArea({ profile, onLogout }) {
  const [athletes, setAthletes] = useState([]);
  const [pending, setPending] = useState([]);
  const [stats, setStats] = useState({});
  const [manageId, setManageId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("athletes");

  const load = useCallback(async () => {
    setLoading(true);
    const a = await api.listAthletes(profile.id);
    setAthletes(a);
    setPending(await api.pendingAthletes());
    const s = {};
    for (const at of a) s[at.id] = athleteStats(await api.listWorkouts(at.id), at);
    setStats(s);
    setLoading(false);
  }, [profile.id]);

  useEffect(() => { load(); }, [load]);

  if (manageId) {
    return <ManageAthlete coachId={profile.id} athlete={athletes.find((a) => a.id === manageId)}
      onBack={() => { setManageId(null); load(); }} />;
  }
  const sw = <ViewSwitch view={view} setView={setView} />;
  if (view === "me") {
    return <AthleteArea profile={profile} onLogout={onLogout} selfManage viewSwitch={sw} />;
  }
  return <CoachHome profile={profile} athletes={athletes} pending={pending} stats={stats} loading={loading}
    reload={load} onManage={setManageId} onLogout={onLogout} viewSwitch={sw} />;
}

function raceColor(days) { return days == null ? MUTE : days <= 21 ? "#ff5a3c" : days <= 56 ? "#f5a524" : "#c084fc"; }
export function adherColor(p) { return p == null ? MUTE : p >= 80 ? "#a3e635" : p >= 50 ? "#f5a524" : "#ff5a3c"; }

function CoachHome({ profile, athletes, pending = [], stats, loading, reload, onManage, onLogout, viewSwitch = null }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [linkingId, setLinkingId] = useState(null);
  const link = async () => {
    if (!email.trim()) return;
    setBusy(true); setMsg(null);
    const { error } = await api.linkAthlete(email.trim());
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: "Atleta vinculado!" }); setEmail(""); await reload(); }
    setBusy(false);
  };
  const linkPending = async (p) => {
    setLinkingId(p.id); setMsg(null);
    const { error } = await api.linkAthlete(p.email);
    if (error) setMsg({ ok: false, t: error.message });
    else await reload();
    setLinkingId(null);
  };
  const list = athletes.map((a) => ({ a, s: stats[a.id] || {} }));
  const sorted = [...list].sort((x, y) =>
    (y.s.needsAttention ? 1 : 0) - (x.s.needsAttention ? 1 : 0) || (x.s.daysToRace ?? 9999) - (y.s.daysToRace ?? 9999));
  const attention = list.filter((x) => x.s.needsAttention).length;
  const wkDone = sum(list.map((x) => x.s.weekDone || 0));
  const wkTotal = sum(list.map((x) => x.s.weekTotal || 0));
  const adhers = list.map((x) => x.s.adher).filter((v) => v != null);
  const avgAdher = adhers.length ? Math.round(sum(adhers) / adhers.length) : null;

  return (
    <Frame title="Painel do treinador" subtitle={`${athletes.length} atleta(s)`} onExit={onLogout} exitLabel="sair" logout>
      {viewSwitch}
      {loading ? <Empty>carregando…</Empty> : (
        <div className="rise">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 18 }}>
            <Stat label="Atletas" value={athletes.length} unit="ativos" color="#22d3ee" icon={Users} />
            <Stat label="Esta semana" value={`${wkDone}/${wkTotal}`} unit="treinos feitos" color="#a3e635" />
            <Stat label="Aderência média" value={avgAdher == null ? "—" : `${avgAdher}%`} unit="dos atletas" color={adherColor(avgAdher)} />
            <Stat label="Precisam de atenção" value={attention} unit="atleta(s)" color={attention ? "#ff5a3c" : "#a3e635"} icon={AlertTriangle} />
          </div>

          {pending.length > 0 && (
            <div style={{ ...card.base, marginBottom: 18, border: `1px solid rgba(34,211,238,0.4)` }}>
              <SectionTitle>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <Mail size={15} color="#22d3ee" /> Novos alunos aguardando vínculo
                  <Badge c="#22d3ee">{pending.length}</Badge>
                </span>
              </SectionTitle>
              <p style={{ color: MUTE, fontSize: 12.5, marginBottom: 12 }}>
                Criaram a conta e ainda não estão no seu painel. Clique em <b style={{ color: TEXT }}>Vincular</b> para adicioná-los.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pending.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 12, flexWrap: "wrap" }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(34,211,238,0.12)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <Users size={16} color="#22d3ee" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="disp" style={{ fontSize: 14, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.full_name || p.email}</div>
                      <div className="mono" style={{ fontSize: 11.5, color: MUTE, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.email}{p.created_at ? ` · ${dm(toDate(String(p.created_at).slice(0, 10)))}` : ""}</div>
                    </div>
                    <button disabled={linkingId === p.id} onClick={() => linkPending(p)} style={{ ...btn.solid, opacity: linkingId === p.id ? 0.6 : 1 }}>
                      <Plus size={16} /> {linkingId === p.id ? "vinculando…" : "Vincular"}
                    </button>
                  </div>
                ))}
              </div>
              {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg.ok ? "#a3e635" : "#ff8a73" }}>{msg.t}</div>}
            </div>
          )}

          {athletes.length === 0 && pending.length === 0 ? <Empty>Nenhum atleta ainda. Quando um aluno criar a conta, ele aparece aqui pra você vincular.</Empty> : athletes.length === 0 ? null : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
              {sorted.map(({ a, s }) => (
                <button key={a.id} onClick={() => onManage(a.id)} style={{
                  ...card.base, padding: 16, textAlign: "left", cursor: "pointer",
                  border: `1px solid ${s.needsAttention ? "rgba(255,90,60,0.45)" : LINE}`,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="disp" style={{ fontWeight: 700, fontSize: 17, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.full_name || a.email}</div>
                      <div style={{ color: MUTE, fontSize: 12, marginTop: 2 }}>{a.race || "—"}{a.goal ? ` · ${a.goal}` : ""}</div>
                    </div>
                    {s.daysToRace != null && (
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div className="disp" style={{ fontWeight: 800, fontSize: 20, color: raceColor(s.daysToRace), lineHeight: 1 }}>{s.daysToRace}</div>
                        <div style={{ fontSize: 10, color: MUTE }}>dias p/ prova</div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 6px" }}>
                    <div style={{ flex: 1, height: 8, background: PANEL2, borderRadius: 5, overflow: "hidden" }}>
                      <div style={{ width: `${s.adher || 0}%`, height: "100%", background: adherColor(s.adher), borderRadius: 5 }} />
                    </div>
                    <span className="mono" style={{ fontSize: 11.5, color: adherColor(s.adher), width: 64, textAlign: "right" }}>{s.adher == null ? "—" : `${s.adher}%`} ader.</span>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: MUTE, marginBottom: 10 }}>
                    semana {s.weekDone || 0}/{s.weekTotal || 0} · {s.daysSinceLast == null ? "sem treinos" : s.daysSinceLast === 0 ? "treinou hoje" : `há ${s.daysSinceLast}d sem treinar`}
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {s.overdue >= 1 && <Badge c="#ff5a3c" icon={AlertTriangle}>{s.overdue} atrasado{s.overdue > 1 ? "s" : ""}</Badge>}
                    {!s.hasPlan && <Badge c="#f5a524" icon={Calendar}>sem plano à frente</Badge>}
                    {s.recentImport && <Badge c="#22d3ee" icon={Upload}>importou Strava</Badge>}
                    {!s.overdue && s.hasPlan && <Badge c="#a3e635" icon={CheckCircle2}>em dia</Badge>}
                    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3, fontSize: 12, color: MUTE, fontWeight: 600 }}>gerenciar <ChevronRight size={14} /></span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div style={{ ...card.base, marginTop: 18 }}>
            <SectionTitle>Vincular novo atleta</SectionTitle>
            <p style={{ color: MUTE, fontSize: 12.5, marginBottom: 10 }}>
              O atleta precisa ter criado a conta antes. Informe o email dele:
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input style={{ ...inp.base, flex: 1, minWidth: 200 }} placeholder="email@atleta.com" value={email}
                onChange={(e) => { setEmail(e.target.value); setMsg(null); }} onKeyDown={(e) => e.key === "Enter" && link()} />
              <button disabled={busy} onClick={link} style={{ ...btn.solid, opacity: busy ? 0.6 : 1 }}><Plus size={16} /> Vincular</button>
            </div>
            {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg.ok ? "#a3e635" : "#ff8a73" }}>{msg.t}</div>}
          </div>
        </div>
      )}
    </Frame>
  );
}
function Badge({ c, icon: Icon, children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: c, background: `${c}1f`, border: `1px solid ${c}55`, borderRadius: 20, padding: "3px 9px" }}>
      {Icon && <Icon size={11} />}{children}
    </span>
  );
}

function RaceDataCard({ athlete, onSaved }) {
  const [info, setInfo] = useState({ race: athlete?.race || "", race_date: athlete?.race_date || "", goal: athlete?.goal || "" });
  const [saved, setSaved] = useState(false);
  const save = async () => { await api.updateProfile(athlete.id, info); setSaved(true); setTimeout(() => setSaved(false), 1500); onSaved && onSaved(); };
  return (
    <div style={{ ...card.base, marginBottom: 16 }}>
      <SectionTitle>Dados da prova</SectionTitle>
      <div style={grid2}>
        <Field label="Prova"><input style={inp.base} value={info.race} onChange={(e) => setInfo({ ...info, race: e.target.value })} /></Field>
        <Field label="Data"><input type="date" style={inp.base} value={info.race_date || ""} onChange={(e) => setInfo({ ...info, race_date: e.target.value })} /></Field>
        <Field label="Tempo-objetivo"><input style={inp.base} value={info.goal} onChange={(e) => setInfo({ ...info, goal: e.target.value })} placeholder="ex.: 6h45" /></Field>
      </div>
      <button onClick={save} style={btn.outline}>{saved ? "salvo!" : "Salvar dados"}</button>
    </div>
  );
}
function NewWorkoutForm({ coachId, athleteId, onAdded }) {
  const blank = { date: todayISO(), discipline: "Corrida", type: "", durationMin: "", distance: "", distUnit: "km", target: "", notes: "" };
  const [f, setF] = useState(blank);
  const add = async () => {
    if (!f.type.trim()) return;
    await api.addWorkout({
      athlete_id: athleteId, coach_id: coachId, date: f.date, discipline: f.discipline,
      type: f.type.trim(), duration_min: Number(f.durationMin) || 0, distance: Number(f.distance) || 0,
      dist_unit: f.distUnit, target: f.target.trim(), notes: f.notes.trim(), status: "planejado",
    });
    setF({ ...blank, discipline: f.discipline, date: f.date });
    onAdded && onAdded();
  };
  return (
    <div style={{ ...card.base, marginBottom: 18 }}>
      <SectionTitle>Novo treino</SectionTitle>
      <div style={grid2}>
        <Field label="Data"><input type="date" style={inp.base} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Modalidade">
          <select style={inp.base} value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value })}>
            {DISCIPLINES.map((d) => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Tipo de sessão"><input style={inp.base} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} placeholder="ex.: Limiar 3×6'" /></Field>
        <Field label="Duração (min)"><input style={inp.base} type="number" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} /></Field>
        <Field label="Distância">
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...inp.base, flex: 1 }} type="number" value={f.distance} onChange={(e) => setF({ ...f, distance: e.target.value })} />
            <select style={{ ...inp.base, width: 78 }} value={f.distUnit} onChange={(e) => setF({ ...f, distUnit: e.target.value })}>
              <option value="km">km</option><option value="m">m</option>
            </select>
          </div>
        </Field>
        <Field label="Alvo (pace/zona)"><input style={inp.base} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="ex.: 4:43/km" /></Field>
      </div>
      <Field label="Observações"><input style={inp.base} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <button onClick={add} style={{ ...btn.solid, marginTop: 4 }}><Plus size={16} /> Adicionar treino</button>
    </div>
  );
}

function EditWorkoutModal({ w, onClose, onSaved, onDelete }) {
  const [f, setF] = useState({
    date: w.date, discipline: w.discipline, type: w.type, durationMin: w.durationMin || "",
    distance: w.distance || "", distUnit: w.distUnit || "km", target: w.target || "",
    notes: w.notes || "", status: w.status, rpe: w.rpe || "",
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.type.trim()) return;
    setBusy(true);
    await api.updateWorkout(w.id, {
      date: f.date, discipline: f.discipline, type: f.type.trim(),
      duration_min: Number(f.durationMin) || 0, distance: Number(f.distance) || 0, dist_unit: f.distUnit,
      target: f.target.trim(), notes: f.notes.trim(), status: f.status,
      rpe: f.status === "concluído" ? (Number(f.rpe) || null) : null,
    });
    setBusy(false); onSaved && onSaved();
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(5,8,16,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflow: "auto", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 18, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <SectionTitle>Editar treino</SectionTitle>
          <button onClick={onClose} style={btn.icon} title="fechar"><X size={16} /></button>
        </div>
        <div style={grid2}>
          <Field label="Data"><input type="date" style={inp.base} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Modalidade">
            <select style={inp.base} value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value })}>
              {DISCIPLINES.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Tipo de sessão"><input style={inp.base} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} /></Field>
          <Field label="Duração (min)"><input type="number" style={inp.base} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} /></Field>
          <Field label="Distância">
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" style={{ ...inp.base, flex: 1 }} value={f.distance} onChange={(e) => setF({ ...f, distance: e.target.value })} />
              <select style={{ ...inp.base, width: 78 }} value={f.distUnit} onChange={(e) => setF({ ...f, distUnit: e.target.value })}><option value="km">km</option><option value="m">m</option></select>
            </div>
          </Field>
          <Field label="Alvo (pace/zona)"><input style={inp.base} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
          <Field label="Status">
            <select style={inp.base} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="planejado">planejado</option><option value="concluído">concluído</option></select>
          </Field>
          {f.status === "concluído" && (
            <Field label="RPE (1-10)"><input type="number" min="1" max="10" style={inp.base} value={f.rpe} onChange={(e) => setF({ ...f, rpe: e.target.value })} /></Field>
          )}
        </div>
        <Field label="Observações (o atleta vê)"><input style={inp.base} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="ex.: foco na técnica, nutrição a cada 30'…" /></Field>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button disabled={busy} onClick={save} style={{ ...btn.solid, opacity: busy ? 0.6 : 1 }}><Check size={16} /> {busy ? "salvando…" : "Salvar"}</button>
          {onDelete && <button onClick={() => onDelete(w.id)} style={{ ...btn.icon, marginLeft: "auto" }} title="excluir treino"><Trash2 size={15} /></button>}
        </div>
      </div>
    </div>
  );
}

function ManageAthlete({ coachId, athlete, onBack }) {
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const load = useCallback(async () => {
    if (!athlete) return;
    setLoading(true);
    setWorkouts(await api.listWorkouts(athlete.id));
    setLoading(false);
  }, [athlete]);
  useEffect(() => { load(); }, [load]);
  const delW = async (id) => { await api.deleteWorkout(id); await load(); };
  const removeAthlete = async () => {
    if (!window.confirm(`Remover ${athlete.full_name || athlete.email} do seu painel? A conta e o histórico do atleta são mantidos — você pode vinculá-lo de novo depois.`)) return;
    await api.unlinkAthlete(athlete.id);
    onBack();
  };
  const editing = workouts.find((w) => w.id === editId) || null;
  if (!athlete) return null;
  return (
    <Frame title={athlete.full_name || athlete.email} subtitle="Gerenciar treinos" onExit={onBack} exitLabel="voltar" backIcon>
      <RaceDataCard athlete={athlete} />
      {!loading && <Suspense fallback={<Empty>carregando…</Empty>}><PlanVsActual workouts={workouts} title="Planejado × cumprido do atleta" /></Suspense>}
      <CoachPlanBrief athlete={athlete} workouts={workouts} />
      <BulkPlanImport coachId={coachId} athlete={athlete} onDone={load} />
      <NewWorkoutForm coachId={coachId} athleteId={athlete.id} onAdded={load} />
      {loading ? <Empty>carregando…</Empty> : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 2px 8px" }}>
            <SectionTitle>Treinos <span style={{ color: MUTE, fontWeight: 400, fontSize: 11.5 }}>· toque para editar</span></SectionTitle>
          </div>
          <WorkoutList workouts={workouts} onDelete={delW} onOpen={setEditId} coach />
        </>
      )}
      <div style={{ ...card.base, marginTop: 18, border: `1px solid rgba(255,90,60,0.3)` }}>
        <SectionTitle>Remover atleta</SectionTitle>
        <p style={{ color: MUTE, fontSize: 12.5, marginBottom: 12 }}>
          Tira o atleta do seu painel (desvincula). A conta e o histórico dele continuam; dá pra vincular de novo depois.
        </p>
        <button onClick={removeAthlete} style={{ ...btn.outline, borderColor: "rgba(255,90,60,0.5)", color: "#ff8a73" }}>
          <Trash2 size={15} /> Remover atleta do painel
        </button>
      </div>
      {editing && (
        <EditWorkoutModal w={editing} onClose={() => setEditId(null)}
          onSaved={async () => { await load(); setEditId(null); }}
          onDelete={async (id) => { await delW(id); setEditId(null); }} />
      )}
    </Frame>
  );
}

const PLAN_MODEL_CSV =
  "date,discipline,type,duration_min,distance,dist_unit,target,notes\n" +
  "2026-08-01,Corrida,Limiar 3×8',55,10,km,4:30/km,Aquece 15' + solta 10'\n" +
  "2026-08-02,Natação,CSS 6×100m,50,2000,m,CSS 1:45/100m,Foco no catch\n" +
  "2026-08-03,Pedal,Z2 endurance,90,42,km,FC 135-145,Cadência 90+ rpm\n" +
  "2026-08-04,Descanso,Off,0,0,,,Recuperação";

function BulkPlanImport({ coachId, athlete, onDone }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const reparse = (t) => {
    setText(t);
    const parsed = parsePlanText(t);
    setRows(parsed);
    if (t.trim() && !parsed.length) setMsg({ ok: false, t: "Nada reconhecido. Cole um CSV (com cabeçalho) ou JSON. Veja o modelo." });
    else setMsg(null);
  };
  const onFile = async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    reparse(await f.text());
  };
  const create = async () => {
    if (!rows.length || !athlete) return;
    setBusy(true); setMsg(null);
    const payload = rows.map((w) => ({
      athlete_id: athlete.id, coach_id: coachId, date: w.date, discipline: w.discipline, type: w.type,
      duration_min: w.durationMin, distance: w.distance, dist_unit: w.distUnit,
      target: w.target, notes: w.notes, status: "planejado",
    }));
    const { error } = await api.addWorkouts(payload);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: `${payload.length} treino(s) adicionados ao plano!` }); setText(""); setRows([]); onDone && onDone(); }
    setBusy(false);
  };

  return (
    <div style={{ ...card.base, marginBottom: 18 }}>
      <SectionTitle>Importar plano em lote</SectionTitle>
      <p style={{ color: MUTE, fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        Cole ou suba o plano gerado pelo Claude (skill <span className="mono">triathlon-coach</span>) — <b style={{ color: TEXT }}>CSV</b> com
        cabeçalho ou <b style={{ color: TEXT }}>JSON</b> — e crie todos os treinos de uma vez. Colunas: data, modalidade, tipo,
        duração (min ou h:mm), distância, unidade, alvo, observações.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <label style={{ ...btn.outline, cursor: "pointer" }}>
          <Upload size={15} /> Subir arquivo
          <input type="file" accept=".csv,.json,.txt" onChange={onFile} style={{ display: "none" }} />
        </label>
        <button onClick={() => downloadFile("modelo-plano-tribase.csv", PLAN_MODEL_CSV, "text/csv")} style={btn.ghost}>
          <Download size={14} /> baixar modelo CSV
        </button>
      </div>
      <textarea value={text} onChange={(e) => reparse(e.target.value)} rows={6}
        placeholder={"Cole aqui o CSV ou JSON do plano…\n\n" + PLAN_MODEL_CSV}
        style={{ ...inp.base, width: "100%", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, resize: "vertical", lineHeight: 1.5 }} />

      {rows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="mono" style={{ fontSize: 12, color: MUTE }}>Prévia · {rows.length} treino(s) · {dm(toDate(rows[0].date))}–{dm(toDate(rows[rows.length - 1].date))}</span>
            <button disabled={busy} onClick={create} style={{ ...btn.solid, opacity: busy ? 0.6 : 1 }}>
              <Plus size={16} /> {busy ? "criando…" : `Criar ${rows.length} treinos`}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflow: "auto" }}>
            {rows.map((w, i) => {
              const meta = DISC[w.discipline] || DISC["Corrida"];
              const Icon = meta.icon;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10 }}>
                  <Icon size={15} color={meta.c} />
                  <span className="mono" style={{ fontSize: 11, color: MUTE, width: 44 }}>{dm(toDate(w.date))}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: meta.c, width: 64 }}>{w.discipline}</span>
                  <span className="disp" style={{ flex: 1, fontSize: 13, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.type}</span>
                  <span className="mono" style={{ fontSize: 11, color: MUTE }}>{w.durationMin ? fmtDur(w.durationMin) : ""}{w.distance ? ` · ${w.distance}${w.distUnit}` : ""}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {msg && <div style={{ fontSize: 12.5, marginTop: 10, color: msg.ok ? "#a3e635" : "#ff8a73" }}>{msg.t}</div>}
    </div>
  );
}

/* ===== briefing p/ gerar o plano com a skill triathlon-coach ===== */
function bestPaces(done) {
  const out = {};
  const runs = done.filter((w) => (w.discipline === "Corrida" || w.discipline === "Brick") && w.durationMin && w.distance);
  const swims = done.filter((w) => w.discipline === "Natação" && w.durationMin && w.distance);
  const rides = done.filter((w) => w.discipline === "Pedal" && w.durationMin && w.distance);
  if (runs.length) out["Corrida"] = `${mmss(Math.min(...runs.map((w) => (w.durationMin * 60) / w.distance)))}/km`;
  if (swims.length) out["Natação"] = `${mmss(Math.min(...swims.map((w) => (w.durationMin * 60) / (w.distance / 100))))}/100m`;
  if (rides.length) out["Pedal"] = `${Math.max(...rides.map((w) => w.distance / (w.durationMin / 60))).toFixed(1)} km/h`;
  return out;
}
function buildCoachBrief(athlete, workouts, weeks) {
  const cutoff = weeks ? addDays(todayISO(), -weeks * 7) : "0000-00-00";
  const done = (workouts || []).filter((w) => w.status === "concluído" && w.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  const byDisc = {};
  done.forEach((w) => {
    const d = (byDisc[w.discipline] = byDisc[w.discipline] || { sessoes: 0, horas: 0, distancia: 0, unidade: w.distUnit });
    d.sessoes += 1; d.horas += (w.durationMin || 0) / 60; d.distancia += w.distance || 0; d.unidade = w.distUnit;
  });
  Object.values(byDisc).forEach((d) => { d.horas = +d.horas.toFixed(1); d.distancia = +d.distancia.toFixed(1); });
  const totalH = sum(done.map((w) => w.durationMin)) / 60;
  // média semanal sobre o período REAL dos dados (não dilui por semanas sem treino)
  const spanWeeks = done.length ? Math.max(1, Math.ceil((Date.parse(todayISO()) - Date.parse(done[0].date)) / (86400000 * 7))) : 1;
  const weeksToRace = athlete?.race_date ? Math.max(0, Math.ceil((toDate(athlete.race_date) - new Date()) / (86400000 * 7))) : null;
  return {
    atleta: athlete?.full_name || athlete?.email,
    prova: athlete?.race || null, dataProva: athlete?.race_date || null, metaTempo: athlete?.goal || null,
    semanasParaProva: weeksToRace, janelaSemanas: weeks || "tudo",
    resumo: { concluidos: done.length, volumeSemanalMedioH: +(totalH / spanWeeks).toFixed(1), porModalidade: byDisc, melhoresRitmos: bestPaces(done) },
    treinos: done.map((w) => ({ data: w.date, modalidade: w.discipline, sessao: w.type, duracaoMin: w.durationMin || null, distancia: w.distance || null, unidade: w.distUnit, ritmo: paceStr(w), fcMedia: w.avgHr, rpe: w.rpe })),
  };
}
function coachBriefText(b) {
  const L = [];
  L.push("Use a skill triathlon-coach para montar o plano de treino deste atleta de triathlon.");
  L.push("");
  L.push(`ATLETA: ${b.atleta}`);
  if (b.prova) L.push(`PROVA: ${b.prova}${b.dataProva ? ` em ${dm(toDate(b.dataProva))}` : ""}${b.semanasParaProva != null ? ` (faltam ${b.semanasParaProva} semanas)` : ""}`);
  if (b.metaTempo) L.push(`META: ${b.metaTempo}`);
  L.push(`VOLUME SEMANAL MÉDIO REAL: ${fmtDur(b.resumo.volumeSemanalMedioH * 60)} (base: ${b.janelaSemanas === "tudo" ? "todo o histórico" : "últimas " + b.janelaSemanas + " semanas"})`);
  const bp = b.resumo.melhoresRitmos;
  if (Object.keys(bp).length) { L.push("MELHORES RITMOS RECENTES (estimar zonas a partir destes):"); Object.entries(bp).forEach(([d, v]) => L.push(`  - ${d}: ${v}`)); }
  if (Object.keys(b.resumo.porModalidade).length) { L.push("VOLUME REAL POR MODALIDADE:"); Object.entries(b.resumo.porModalidade).forEach(([d, v]) => L.push(`  - ${d}: ${v.sessoes} sessões, ${fmtDur(Math.round(v.horas * 60))}, ${v.distancia}${v.unidade}`)); }
  if (b.treinos.length) {
    L.push(""); L.push("TREINOS RECENTES (performance real):");
    b.treinos.forEach((t) => L.push(`  ${t.data} · ${t.modalidade} · ${t.sessao} — ${t.duracaoMin ? fmtDur(t.duracaoMin) : "?"}${t.distancia ? ` ${t.distancia}${t.unidade}` : ""}${t.ritmo ? ` @ ${t.ritmo}` : ""}${t.fcMedia ? ` · FC ${t.fcMedia}` : ""}${t.rpe ? ` · RPE ${t.rpe}` : ""}`));
  }
  L.push("");
  L.push("Gere uma periodização completa até a data da prova (base → build → pico → taper).");
  L.push("ENTREGUE A RESPOSTA SÓ COMO CSV (sem texto antes ou depois), com EXATAMENTE este cabeçalho:");
  L.push("date,discipline,type,duration_min,distance,dist_unit,target,notes");
  L.push("- date: AAAA-MM-DD");
  L.push("- discipline: Natação | Pedal | Corrida | Brick | Força | Descanso");
  L.push("- duration_min: minutos (número) ou h:mm");
  L.push("- distance/dist_unit: km na corrida/pedal, m na natação (0 quando não se aplica)");
  L.push("Esse CSV será importado direto no TRIBASE (card 'Importar plano em lote').");
  return L.join("\n");
}
function CoachPlanBrief({ athlete, workouts }) {
  const [weeks, setWeeks] = useState(8);
  const [copied, setCopied] = useState(false);
  const brief = useMemo(() => buildCoachBrief(athlete, workouts, weeks), [athlete, workouts, weeks]);
  const r = brief.resumo;
  const stamp = `${(athlete?.full_name || "atleta").toLowerCase().replace(/\s+/g, "-")}-${todayISO()}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(coachBriefText(brief)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (e) {}
  };
  return (
    <div style={{ ...card.base, marginBottom: 16 }}>
      <SectionTitle>Gerar plano com o Claude</SectionTitle>
      <p style={{ color: MUTE, fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        Prepara os dados reais do atleta (inclusive o que ele importou do Strava) para a skill
        <span className="mono"> triathlon-coach</span>. <b style={{ color: TEXT }}>Copie o briefing</b>, cole numa conversa com o
        Claude e ele devolve um <b style={{ color: "#a3e635" }}>CSV</b> — que você cola no card <b style={{ color: TEXT }}>Importar plano em lote</b> logo abaixo.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: MUTE }}>Base de análise:</span>
        {[[4, "4 sem"], [8, "8 sem"], [12, "12 sem"], [0, "Tudo"]].map(([v, l]) => (
          <button key={l} onClick={() => setWeeks(v)} style={{
            padding: "7px 13px", borderRadius: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
            border: `1px solid ${weeks === v ? ACCENT : LINE}`, background: weeks === v ? "rgba(255,90,60,0.12)" : PANEL2,
            color: weeks === v ? "#ffd9cf" : MUTE,
          }}>{l}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14, fontSize: 12.5 }} className="mono">
        <span style={{ color: "#a3e635" }}>{r.concluidos} concluídos</span>
        <span style={{ color: "#22d3ee" }}>{fmtDur(r.volumeSemanalMedioH * 60)}/sem</span>
        {brief.semanasParaProva != null && <span style={{ color: "#c084fc" }}>{brief.semanasParaProva} sem p/ prova</span>}
        {Object.entries(r.melhoresRitmos).map(([d, v]) => <span key={d} style={{ color: DISC[d]?.c || MUTE }}>{d.slice(0, 3)} {v}</span>)}
      </div>
      {r.concluidos === 0 && (
        <div style={{ fontSize: 12.5, color: "#ff8a73", marginBottom: 12 }}>
          O atleta ainda não tem treinos concluídos. Peça para ele importar do Strava (aba Importar) — ou gere o plano só com o perfil/prova.
        </div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={copy} style={btn.solid}><Copy size={15} /> {copied ? "copiado!" : "Copiar briefing p/ o Claude"}</button>
        <button onClick={() => downloadFile(`briefing-${stamp}.json`, JSON.stringify(brief, null, 2), "application/json")} style={btn.outline}>
          <Download size={15} /> Baixar JSON
        </button>
      </div>
    </div>
  );
}

/* ================= Athlete ================= */
function AthleteArea({ profile, onLogout, selfManage = false, viewSwitch = null }) {
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setWorkouts(await api.listWorkouts(profile.id));
    setLoading(false);
  }, [profile.id]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (id) => {
    const w = workouts.find((x) => x.id === id);
    const done = w.status === "concluído";
    await api.updateWorkout(id, { status: done ? "planejado" : "concluído", rpe: done ? null : (w.rpe || 5) });
    await load();
  };
  const setRpe = async (id, rpe) => { await api.updateWorkout(id, { rpe }); await load(); };
  const del = async (id) => { await api.deleteWorkout(id); await load(); };
  const detail = workouts.find((w) => w.id === detailId) || null;
  const subtitle = selfManage
    ? `Meu treino${profile.race ? " · " + profile.race : ""}${profile.goal ? " · alvo " + profile.goal : ""}`
    : `${profile.race || "Triathlon"}${profile.goal ? " · alvo " + profile.goal : ""}`;

  return (
    <Frame title={profile.full_name || profile.email} subtitle={subtitle}
      onExit={onLogout} exitLabel="sair" logout>
      {viewSwitch}
      <Tabs tab={tab} setTab={setTab} selfManage={selfManage} />
      {loading ? <Empty>carregando…</Empty> : (
        <Suspense fallback={<Empty>carregando gráficos…</Empty>}>
          {tab === "overview" && <Overview workouts={workouts} profile={profile} onOpen={setDetailId} />}
          {tab === "calendar" && <CalendarView workouts={workouts} onOpen={setDetailId} />}
          {tab === "evolution" && <Evolution workouts={workouts} />}
          {tab === "reports" && <Reports workouts={workouts} />}
          {tab === "import" && <ImportPanel profile={profile} onImported={async () => { await load(); setTab("reports"); }} />}
          {tab === "export" && <ExportPanel workouts={workouts} profile={profile} />}
          {tab === "plano" && selfManage && (
            <div className="rise">
              <RaceDataCard athlete={profile} onSaved={load} />
              <NewWorkoutForm coachId={profile.id} athleteId={profile.id} onAdded={load} />
              <BulkPlanImport coachId={profile.id} athlete={profile} onDone={load} />
            </div>
          )}
        </Suspense>
      )}
      {detail && (
        <WorkoutDetail w={detail} onClose={() => setDetailId(null)}
          onToggle={async (id) => { await toggle(id); }} onRpe={async (id, r) => { await setRpe(id, r); }}
          onDelete={async (id) => { await del(id); setDetailId(null); }} />
      )}
    </Frame>
  );
}

function Tabs({ tab, setTab, selfManage = false }) {
  const items = [["overview", "Visão geral", Activity], ["calendar", "Calendário", Calendar], ["evolution", "Evolução", TrendingUp], ["reports", "Relatórios", BarChart3], ["import", "Importar", Upload], ["export", "Exportar", Download]];
  if (selfManage) items.splice(1, 0, ["plano", "Meu plano", Plus]);
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
      {items.map(([k, label, Icon]) => (
        <button key={k} onClick={() => setTab(k)} style={{
          display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", borderRadius: 11, fontSize: 13.5,
          fontWeight: 600, cursor: "pointer", border: `1px solid ${tab === k ? ACCENT : LINE}`,
          background: tab === k ? "rgba(255,90,60,0.12)" : PANEL, color: tab === k ? "#ffd9cf" : MUTE,
        }}><Icon size={15} /> {label}</button>
      ))}
    </div>
  );
}

function Overview({ workouts, profile, onOpen }) {
  const wkStart = weekStart(todayISO()).toISOString().slice(0, 10);
  const wkEnd = addDays(wkStart, 6);
  const thisWeek = workouts.filter((w) => w.date >= wkStart && w.date <= wkEnd);
  const wkHours = sum(thisWeek.map((w) => w.durationMin)) / 60;
  const done = thisWeek.filter((w) => w.status === "concluído").length;
  const totalDone = workouts.filter((w) => w.status === "concluído").length;
  const adher = workouts.length ? Math.round((totalDone / workouts.length) * 100) : 0;
  const next = [...workouts].sort((a, b) => a.date.localeCompare(b.date)).find((w) => w.date >= todayISO() && w.status !== "concluído");
  const daysToRace = profile.race_date ? Math.max(0, Math.ceil((toDate(profile.race_date) - new Date()) / 86400000)) : null;
  const streak = computeStreak(workouts);
  const weekPct = thisWeek.length ? Math.round((done / thisWeek.length) * 100) : 0;
  const weekClosed = thisWeek.length > 0 && done === thisWeek.length;
  return (
    <div className="rise">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
        <Stat label="Sequência" value={streak} unit={streak === 1 ? "dia seguido" : "dias seguidos"} color="#ff7a1a" icon={Flame} />
        <Stat label="Esta semana" value={fmtDur(wkHours * 60)} unit="planejadas" color="#22d3ee" />
        <Stat label="Aderência" value={`${adher}%`} unit="geral" color={ACCENT} />
        {daysToRace != null && <Stat label="Para a prova" value={daysToRace} unit="dias" color="#c084fc" icon={Flag} />}
      </div>

      <div style={{ ...card.base, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <SectionTitle>Meta da semana</SectionTitle>
          {weekClosed
            ? <span style={{ fontSize: 12, fontWeight: 700, color: "#a3e635", display: "flex", alignItems: "center", gap: 5 }}><Trophy size={14} /> Semana fechada!</span>
            : <span className="mono" style={{ fontSize: 12, color: MUTE }}>{done}/{thisWeek.length} treinos</span>}
        </div>
        <div style={{ height: 12, background: PANEL2, borderRadius: 7, overflow: "hidden" }}>
          <div style={{ width: `${weekPct}%`, height: "100%", background: weekClosed ? "#a3e635" : `linear-gradient(90deg,${ACCENT},#ffae3c)`, borderRadius: 7, transition: "width .5s" }} />
        </div>
        <div style={{ fontSize: 11.5, color: MUTE, marginTop: 7 }}>
          {thisWeek.length === 0 ? "Nenhum treino planejado para esta semana."
            : weekClosed ? "Você concluiu todos os treinos da semana. 🔥"
            : `Faltam ${thisWeek.length - done} treino(s) para fechar a semana.`}
        </div>
      </div>

      <div style={{ ...card.base, marginTop: 16 }}>
        <SectionTitle>Próximo treino</SectionTitle>
        {next ? <WorkoutRow w={next} onOpen={onOpen} /> : <Empty>Nada planejado à frente. 🎉</Empty>}
      </div>
      <div style={{ ...card.base, marginTop: 16 }}>
        <SectionTitle>Volume da semana por modalidade</SectionTitle>
        <DisciplineBars workouts={thisWeek} />
      </div>
    </div>
  );
}

function DisciplineBars({ workouts }) {
  const by = {};
  workouts.forEach((w) => { by[w.discipline] = (by[w.discipline] || 0) + w.durationMin; });
  const max = Math.max(1, ...Object.values(by));
  const items = DISCIPLINES.filter((d) => by[d]);
  if (!items.length) return <Empty>Sem treinos nesta semana.</Empty>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
      {items.map((d) => (
        <div key={d} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 78, fontSize: 12.5, color: MUTE, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: DISC[d].c }} />{d}
          </div>
          <div style={{ flex: 1, height: 10, background: PANEL2, borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${(by[d] / max) * 100}%`, height: "100%", background: DISC[d].c, borderRadius: 6, transition: "width .5s" }} />
          </div>
          <div className="mono" style={{ width: 56, textAlign: "right", fontSize: 12, color: TEXT }}>{fmtDur(by[d])}</div>
        </div>
      ))}
    </div>
  );
}


/* ================= importação ================= */
function ImportPanel({ profile, onImported }) {
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const onFiles = async (e) => {
    setMsg(null);
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    const parsed = await parseImportFiles(files);
    // reconcilia com os treinos PLANEJADOS existentes (casa por modalidade + data ±1 dia)
    let matched = parsed;
    try {
      const existing = await api.listWorkouts(profile.id);
      matched = matchPlan(parsed, existing.filter((w) => w.status === "planejado"));
    } catch (err) { /* sem rede: segue sem match */ }
    setRows(matched);
    const s = {}; matched.forEach((_, i) => (s[i] = true)); setSel(s);
    if (!matched.length) setMsg({ ok: false, t: "Nenhuma atividade reconhecida. Use o activities.csv do Strava (Bulk Export) ou arquivos .gpx/.tcx." });
  };
  const toggle = (i) => setSel((p) => ({ ...p, [i]: !p[i] }));
  const chosen = rows.filter((_, i) => sel[i]);
  const linkCount = chosen.filter((w) => w._matchId).length;

  const doImport = async () => {
    if (!chosen.length) return;
    setBusy(true); setMsg(null);
    const metrics = (w) => ({
      duration_min: w.durationMin, distance: w.distance, dist_unit: w.distUnit, status: "concluído",
      source: w.source || "import", avg_hr: w.avgHr ?? null, max_hr: w.maxHr ?? null,
      elevation_m: w.elevationM ?? null, calories: w.calories ?? null, avg_power: w.avgPower ?? null,
    });
    const toLink = chosen.filter((w) => w._matchId);
    const toAdd = chosen.filter((w) => !w._matchId);
    let err = null;
    // vincula: marca o treino planejado como concluído com os dados reais (sem duplicar)
    for (const w of toLink) {
      const r = await api.updateWorkout(w._matchId, metrics(w));
      if (r && r.error) err = r.error;
    }
    // extras: cria como treino novo concluído
    if (toAdd.length) {
      const payload = toAdd.map((w) => ({
        athlete_id: profile.id, coach_id: profile.coach_id || null,
        date: w.date, discipline: w.discipline, type: w.type, ...metrics(w),
      }));
      const r = await api.addWorkouts(payload);
      if (r && r.error) err = r.error;
    }
    if (err) setMsg({ ok: false, t: err.message || String(err) });
    else {
      setRows([]); setSel({});
      const parts = [];
      if (toLink.length) parts.push(`${toLink.length} vinculado(s) ao plano`);
      if (toAdd.length) parts.push(`${toAdd.length} novo(s)`);
      setMsg({ ok: true, t: `Importado: ${parts.join(" · ")}.` });
      onImported && onImported();
    }
    setBusy(false);
  };

  return (
    <div className="rise">
      <div style={card.base}>
        <SectionTitle>Importar treinos do Strava ou Garmin</SectionTitle>
        <p style={{ color: MUTE, fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
          No Strava: <b style={{ color: TEXT }}>Configurações → Minha conta → Baixar ou excluir sua conta → Solicitar arquivo</b> (Bulk Export)
          e use o <span className="mono">activities.csv</span>. No Garmin: exporte atividades em <span className="mono">.gpx</span> ou <span className="mono">.tcx</span>.
          Tudo grátis — não usa a API paga. Os treinos entram como <b style={{ color: "#a3e635" }}>concluídos</b> no seu calendário.
        </p>
        <label style={{ ...btn.solid, display: "inline-flex", cursor: "pointer" }}>
          <Upload size={16} /> Escolher arquivo(s)
          <input type="file" accept=".csv,.gpx,.tcx" multiple onChange={onFiles} style={{ display: "none" }} />
        </label>
        {msg && <div style={{ fontSize: 12.5, marginTop: 12, color: msg.ok ? "#a3e635" : "#ff8a73" }}>{msg.t}</div>}
      </div>

      {rows.length > 0 && (
        <div style={{ ...card.base, marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 10, flexWrap: "wrap" }}>
            <SectionTitle>Prévia · {chosen.length}/{rows.length} selecionados</SectionTitle>
            <button disabled={busy || !chosen.length} onClick={doImport} style={{ ...btn.solid, opacity: busy || !chosen.length ? 0.6 : 1 }}>
              {busy ? "importando…" : `Importar ${chosen.length}`}
            </button>
          </div>
          <p style={{ color: MUTE, fontSize: 12, marginBottom: 12 }}>
            {linkCount > 0
              ? <>{linkCount} casam com treinos planejados (serão <b style={{ color: "#22d3ee" }}>vinculados</b>, sem duplicar) · o resto entra como <b style={{ color: "#a3e635" }}>novo</b>.</>
              : <>Nenhum casou com o plano — todos entram como treino novo.</>}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflow: "auto" }}>
            {rows.map((w, i) => {
              const meta = DISC[w.discipline] || DISC["Corrida"];
              const Icon = meta.icon;
              return (
                <label key={i} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", cursor: "pointer",
                  background: PANEL, border: `1px solid ${sel[i] ? meta.c : LINE}`, borderRadius: 12,
                }}>
                  <input type="checkbox" checked={!!sel[i]} onChange={() => toggle(i)} />
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: PANEL2, display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Icon size={16} color={meta.c} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: meta.c, fontWeight: 700 }}>{w.discipline}</span>
                      <span className="mono" style={{ fontSize: 11, color: MUTE }}>{dm(toDate(w.date))}</span>
                      {w._matchId
                        ? <Badge c="#22d3ee" icon={CheckCircle2}>vincula: {w._matchType}</Badge>
                        : <Badge c="#a3e635" icon={Plus}>novo</Badge>}
                    </div>
                    <div className="disp" style={{ fontSize: 13.5, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.type}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 11.5, color: MUTE, textAlign: "right", flexShrink: 0 }}>
                    {w.durationMin ? fmtDur(w.durationMin) : ""}{w.distance ? ` · ${w.distance} ${w.distUnit}` : ""}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= exportação (recalibração mensal pelo Claude) ================= */
function buildExport(workouts, profile, weeks) {
  const cutoff = weeks ? addDays(todayISO(), -weeks * 7) : "0000-00-00";
  const period = workouts.filter((w) => w.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date));
  const done = period.filter((w) => w.status === "concluído");
  const byDisc = {};
  done.forEach((w) => {
    const d = (byDisc[w.discipline] = byDisc[w.discipline] || { sessoes: 0, horas: 0, distancia: 0, unidade: w.distUnit });
    d.sessoes += 1; d.horas += (w.durationMin || 0) / 60; d.distancia += w.distance || 0; d.unidade = w.distUnit;
  });
  Object.values(byDisc).forEach((d) => { d.horas = +d.horas.toFixed(1); d.distancia = +d.distancia.toFixed(1); });
  const from = period.length ? period[0].date : null;
  return {
    exportadoEm: todayISO(),
    atleta: { nome: profile.full_name || profile.email, prova: profile.race || null, dataProva: profile.race_date || null, metaTempo: profile.goal || null },
    periodo: { de: from, ate: todayISO(), semanas: weeks || "tudo" },
    resumo: {
      totalNoPeriodo: period.length,
      concluidos: done.length,
      planejadosNaoFeitos: period.length - done.length,
      aderenciaPct: period.length ? Math.round((done.length / period.length) * 100) : 0,
      porModalidade: byDisc,
    },
    treinos: period.map((w) => ({
      data: w.date, modalidade: w.discipline, sessao: w.type, status: w.status,
      duracaoMin: w.durationMin || null, distancia: w.distance || null, unidade: w.distUnit,
      ritmo: paceStr(w), fcMedia: w.avgHr, fcMax: w.maxHr, elevacaoM: w.elevationM,
      calorias: w.calories, potenciaMediaW: w.avgPower, rpe: w.rpe, alvo: w.target || null, origem: w.source || "manual",
    })),
  };
}
function exportToCSV(data) {
  const cols = ["data", "modalidade", "sessao", "status", "duracaoMin", "distancia", "unidade", "ritmo", "fcMedia", "fcMax", "elevacaoM", "calorias", "potenciaMediaW", "rpe", "alvo", "origem"];
  const esc = (v) => { if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...data.treinos.map((t) => cols.map((c) => esc(t[c])).join(","))].join("\n");
}
function exportToText(data) {
  const a = data.atleta, r = data.resumo;
  const lines = [
    `Atleta: ${a.nome}`,
    a.prova ? `Prova: ${a.prova}${a.dataProva ? ` (${dm(toDate(a.dataProva))})` : ""}${a.metaTempo ? ` — meta ${a.metaTempo}` : ""}` : null,
    `Período: ${data.periodo.de || "—"} a ${data.periodo.ate} (${data.periodo.semanas} semanas)`,
    `Aderência: ${r.aderenciaPct}% (${r.concluidos}/${r.totalNoPeriodo} treinos; ${r.planejadosNaoFeitos} não feitos)`,
    "Volume real por modalidade:",
    ...Object.entries(r.porModalidade).map(([d, v]) => `  • ${d}: ${v.sessoes} sessões, ${fmtDur(Math.round(v.horas * 60))}, ${v.distancia}${v.unidade}`),
    "",
    "Treinos concluídos (performance real):",
    ...data.treinos.filter((t) => t.status === "concluído").map((t) =>
      `  ${t.data} · ${t.modalidade} · ${t.sessao} — ${t.duracaoMin ? fmtDur(t.duracaoMin) : "?"}${t.distancia ? ` ${t.distancia}${t.unidade}` : ""}${t.ritmo ? ` @ ${t.ritmo}` : ""}${t.fcMedia ? ` · FC ${t.fcMedia}` : ""}${t.rpe ? ` · RPE ${t.rpe}` : ""}`),
  ];
  return lines.filter((l) => l != null).join("\n");
}
function downloadFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function ExportPanel({ workouts, profile }) {
  const [weeks, setWeeks] = useState(8);
  const [copied, setCopied] = useState(false);
  const data = useMemo(() => buildExport(workouts, profile, weeks), [workouts, profile, weeks]);
  const r = data.resumo;
  const stamp = `${(profile.full_name || "atleta").toLowerCase().replace(/\s+/g, "-")}-${todayISO()}`;
  const copyText = async () => {
    try { await navigator.clipboard.writeText(exportToText(data)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (e) {}
  };
  return (
    <div className="rise">
      <div style={card.base}>
        <SectionTitle>Exportar treinos reais para recalibrar o plano</SectionTitle>
        <p style={{ color: MUTE, fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
          Gera um pacote com sua <b style={{ color: TEXT }}>performance real</b> (incluindo os treinos importados do Strava/Garmin)
          para o treinador ou o Claude <b style={{ color: "#a3e635" }}>recalibrar o plano todo mês</b>. Baixe o JSON/CSV
          e anexe, ou copie o resumo e cole na conversa.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <span style={{ fontSize: 12.5, color: MUTE }}>Período:</span>
          {[[4, "4 sem"], [8, "8 sem"], [12, "12 sem"], [0, "Tudo"]].map(([v, l]) => (
            <button key={l} onClick={() => setWeeks(v)} style={{
              padding: "7px 13px", borderRadius: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
              border: `1px solid ${weeks === v ? ACCENT : LINE}`, background: weeks === v ? "rgba(255,90,60,0.12)" : PANEL2,
              color: weeks === v ? "#ffd9cf" : MUTE,
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16, fontSize: 12.5 }} className="mono">
          <span style={{ color: MUTE }}>{r.totalNoPeriodo} no período</span>
          <span style={{ color: "#a3e635" }}>{r.concluidos} concluídos</span>
          <span style={{ color: ACCENT }}>{r.aderenciaPct}% aderência</span>
          {r.planejadosNaoFeitos > 0 && <span style={{ color: "#ff8a73" }}>{r.planejadosNaoFeitos} não feitos</span>}
        </div>
        {r.concluidos === 0 ? (
          <Empty>Nenhum treino concluído no período. Marque treinos como feitos ou importe do Strava/Garmin primeiro.</Empty>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => downloadFile(`tribase-${stamp}.json`, JSON.stringify(data, null, 2), "application/json")} style={btn.solid}>
              <Download size={16} /> Baixar JSON
            </button>
            <button onClick={() => downloadFile(`tribase-${stamp}.csv`, exportToCSV(data), "text/csv")} style={btn.outline}>
              <Download size={15} /> Baixar CSV
            </button>
            <button onClick={copyText} style={btn.outline}>
              <Copy size={15} /> {copied ? "copiado!" : "Copiar resumo p/ o Claude"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= listas / linhas ================= */
function weekSummary(items) {
  const dist = {}; let min = 0, done = 0;
  items.forEach((w) => {
    min += w.durationMin || 0;
    if (w.status === "concluído") done++;
    if (w.distance) {
      const v = w.discipline === "Natação"
        ? (w.distUnit === "km" ? w.distance * 1000 : w.distance)   // metros
        : (w.distUnit === "m" ? w.distance / 1000 : w.distance);   // km
      dist[w.discipline] = (dist[w.discipline] || 0) + v;
    }
  });
  return { dist, min, done, count: items.length };
}
const fmtWeekDist = (disc, v) => (disc === "Natação" ? `${Math.round(v)}m` : `${(+v).toFixed(1)}km`);
function WorkoutList({ workouts, onToggle, onRpe, onDelete, onOpen, coach }) {
  const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date));
  const groups = {};
  sorted.forEach((w) => { const k = weekStart(w.date).toISOString().slice(0, 10); (groups[k] = groups[k] || []).push(w); });
  const keys = Object.keys(groups).sort();
  const [open, setOpen] = useState({});
  if (!sorted.length) return <Empty>Nenhum treino ainda.</Empty>;
  return (
    <div className="rise" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {keys.map((k) => {
        const items = groups[k]; const s = weekSummary(items); const isOpen = !!open[k];
        return (
          <div key={k} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden" }}>
            <button onClick={() => setOpen((p) => ({ ...p, [k]: !p[k] }))} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
              cursor: "pointer", background: "transparent", border: "none", textAlign: "left",
            }}>
              <ChevronRight size={16} color={MUTE} style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", flexShrink: 0 }} />
              <span className="mono" style={{ fontSize: 11.5, color: isOpen ? TEXT : MUTE, letterSpacing: 0.3, flexShrink: 0, fontWeight: 600 }}>
                {dm(toDate(k))}–{dm(toDate(addDays(k, 6)))}
              </span>
              <div style={{ flex: 1, display: "flex", gap: 10, flexWrap: "wrap", minWidth: 0 }} className="mono">
                {DISCIPLINES.filter((d) => s.dist[d]).map((d) => (
                  <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#cdd6e6" }}>
                    <span style={{ width: 7, height: 7, borderRadius: 4, background: DISC[d].c }} />{fmtWeekDist(d, s.dist[d])}
                  </span>
                ))}
              </div>
              <span className="mono" style={{ fontSize: 11, color: MUTE, flexShrink: 0 }}>{fmtDur(s.min)} · <span style={{ color: "#a3e635" }}>{s.done}/{s.count}</span></span>
            </button>
            {isOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 12px 12px" }}>
                {items.map((w) => <WorkoutRow key={w.id} w={w} onToggle={onToggle} onRpe={onRpe} onDelete={onDelete} onOpen={onOpen} coach={coach} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function WorkoutRow({ w, onToggle, onRpe, onDelete, onOpen, coach }) {
  const meta = DISC[w.discipline] || DISC["Corrida"];
  const Icon = meta.icon;
  const dist = w.distance ? `${w.distance} ${w.distUnit}` : null;
  const dur = w.durationMin ? fmtDur(w.durationMin) : null;
  const pace = paceStr(w);
  const done = w.status === "concluído";
  const clickable = !!onOpen;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: PANEL, border: `1px solid ${done ? "rgba(163,230,53,0.3)" : LINE}`, borderRadius: 13 }}>
      <div onClick={clickable ? () => onOpen(w.id) : undefined}
        style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, cursor: clickable ? "pointer" : "default" }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: PANEL2, display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Icon size={18} color={meta.c} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: meta.c, fontWeight: 700 }}>{w.discipline}</span>
            <span className="mono" style={{ fontSize: 11, color: MUTE }}>{dm(toDate(w.date))}</span>
            {w.notes && <FileText size={12} color={MUTE} title="tem observação do treinador" />}
          </div>
          <div className="disp" style={{ fontWeight: 600, fontSize: 14.5, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.type}</div>
          <div style={{ display: "flex", gap: 12, marginTop: 2, fontSize: 11.5, color: MUTE, flexWrap: "wrap" }} className="mono">
            {dur && <span>{dur}</span>}{dist && <span>{dist}</span>}
            {pace && <span style={{ color: "#9fb0cc" }}>{pace}</span>}
            {w.target && <span style={{ color: "#cdd6e6" }}>{w.target}</span>}
            {w.avgHr && <span style={{ color: "#ff8a73" }}>♥ {w.avgHr}</span>}
            {done && w.rpe && <span style={{ color: "#a3e635" }}>RPE {w.rpe}</span>}
          </div>
        </div>
      </div>
      {onToggle && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {done && onRpe && (
            <select value={w.rpe || 5} onChange={(e) => onRpe(w.id, Number(e.target.value))} title="RPE" style={{ ...inp.base, padding: "5px 6px", width: 52, fontSize: 12 }}>
              {[1,2,3,4,5,6,7,8,9,10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          <button onClick={() => onToggle(w.id)} title={done ? "marcar como planejado" : "marcar como feito"} style={{
            width: 34, height: 34, borderRadius: 9, cursor: "pointer", display: "grid", placeItems: "center",
            border: `1px solid ${done ? "#a3e635" : LINE}`, background: done ? "rgba(163,230,53,0.15)" : PANEL2, color: done ? "#a3e635" : MUTE,
          }}><Check size={17} /></button>
        </div>
      )}
      {onDelete && <button onClick={() => onDelete(w.id)} style={btn.icon} title="remover"><Trash2 size={15} /></button>}
    </div>
  );
}

/* ================= calendário em grade semanal ================= */
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
function CalendarView({ workouts, onOpen }) {
  const [wk, setWk] = useState(() => weekStart(todayISO()).toISOString().slice(0, 10));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(wk, i)), [wk]);
  const byDay = useMemo(() => {
    const m = {};
    workouts.forEach((w) => { (m[w.date] = m[w.date] || []).push(w); });
    return m;
  }, [workouts]);
  const wkEnd = addDays(wk, 6);
  const weekWorkouts = workouts.filter((w) => w.date >= wk && w.date <= wkEnd);
  const wkMin = sum(weekWorkouts.map((w) => w.durationMin));
  const wkDone = weekWorkouts.filter((w) => w.status === "concluído").length;
  const today = todayISO();

  const narrow = useMediaQuery("(max-width: 680px)");
  const dayItems = (d) => (byDay[d] || []).sort((a, b) => a.discipline.localeCompare(b.discipline));

  return (
    <div className="rise">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setWk(addDays(wk, -7))} style={btn.icon} title="semana anterior"><ChevronLeft size={16} /></button>
          <div className="disp" style={{ fontWeight: 700, fontSize: 15, color: TEXT }}>
            {dm(toDate(wk))} – {dm(toDate(wkEnd))}
          </div>
          <button onClick={() => setWk(addDays(wk, 7))} style={{ ...btn.icon, transform: "rotate(180deg)" }} title="próxima semana"><ChevronLeft size={16} /></button>
          <button onClick={() => setWk(weekStart(todayISO()).toISOString().slice(0, 10))} style={{ ...btn.ghost, marginLeft: 4 }}>hoje</button>
        </div>
        <div className="mono" style={{ fontSize: 12, color: MUTE }}>
          {fmtDur(wkMin)} · <span style={{ color: "#a3e635" }}>{wkDone}/{weekWorkouts.length} feitos</span>
        </div>
      </div>

      {narrow ? (
        /* agenda vertical (mobile) */
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {days.map((d, i) => {
            const items = dayItems(d);
            const isToday = d === today;
            return (
              <div key={d} style={{
                display: "flex", gap: 12, alignItems: "stretch",
                background: PANEL, border: `1px solid ${isToday ? ACCENT : LINE}`, borderRadius: 13, padding: "10px 12px",
              }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 44, borderRight: `1px solid ${LINE}`, paddingRight: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isToday ? ACCENT : MUTE, textTransform: "uppercase" }}>{WEEKDAYS[i]}</span>
                  <span className="mono disp" style={{ fontSize: 19, fontWeight: 800, color: isToday ? ACCENT : TEXT }}>{String(toDate(d).getDate()).padStart(2, "0")}</span>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, justifyContent: "center", minWidth: 0 }}>
                  {items.length === 0
                    ? <div style={{ color: MUTE, fontSize: 12.5 }}>— descanso —</div>
                    : items.map((w) => <CalChip key={w.id} w={w} onOpen={onOpen} full />)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* grade semanal (desktop) */
        <div style={{ overflowX: "auto", paddingBottom: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(116px,1fr))", gap: 8, minWidth: 760 }}>
            {days.map((d, i) => {
              const items = dayItems(d);
              const isToday = d === today;
              return (
                <div key={d} style={{
                  background: PANEL, border: `1px solid ${isToday ? ACCENT : LINE}`, borderRadius: 13,
                  padding: 8, minHeight: 130, display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isToday ? ACCENT : MUTE, textTransform: "uppercase" }}>{WEEKDAYS[i]}</span>
                    <span className="mono" style={{ fontSize: 11, color: isToday ? ACCENT : MUTE }}>{String(toDate(d).getDate()).padStart(2, "0")}</span>
                  </div>
                  {items.length === 0 && <div style={{ flex: 1 }} />}
                  {items.map((w) => <CalChip key={w.id} w={w} onOpen={onOpen} />)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
function CalChip({ w, onOpen, full }) {
  const meta = DISC[w.discipline] || DISC["Corrida"];
  const Icon = meta.icon;
  const done = w.status === "concluído";
  return (
    <button onClick={() => onOpen(w.id)} style={{
      textAlign: "left", cursor: "pointer", width: full ? "100%" : "auto",
      border: `1px solid ${done ? "rgba(163,230,53,0.35)" : LINE}`,
      background: done ? "rgba(163,230,53,0.08)" : PANEL2, borderRadius: 9, padding: "6px 7px",
      display: "flex", flexDirection: "column", gap: 2,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <Icon size={12} color={meta.c} />
        <span style={{ fontSize: 10, fontWeight: 700, color: meta.c }}>{w.discipline}</span>
        {done && <Check size={11} color="#a3e635" style={{ marginLeft: "auto" }} />}
      </div>
      <div className="disp" style={{ fontSize: 11.5, color: TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.type}</div>
      <div className="mono" style={{ fontSize: 10, color: MUTE }}>
        {w.durationMin ? fmtDur(w.durationMin) : ""}{w.distance ? `${w.durationMin ? " · " : ""}${w.distance}${w.distUnit}` : ""}
      </div>
    </button>
  );
}

/* ================= detalhe do treino (modal) ================= */
function Metric({ icon: Icon, label, value, color }) {
  if (value == null || value === "" ) return null;
  return (
    <div style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 11, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: MUTE, fontSize: 11, marginBottom: 4 }}>
        {Icon && <Icon size={13} color={color || MUTE} />}{label}
      </div>
      <div className="mono disp" style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{value}</div>
    </div>
  );
}
function WorkoutDetail({ w, onClose, onToggle, onRpe, onDelete }) {
  const meta = DISC[w.discipline] || DISC["Corrida"];
  const Icon = meta.icon;
  const done = w.status === "concluído";
  const pace = paceStr(w);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 50, background: "rgba(5,8,16,0.72)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
    }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{
        width: "100%", maxWidth: 540, maxHeight: "88vh", overflow: "auto",
        background: PANEL, border: `1px solid ${LINE}`, borderRadius: 18, padding: 22,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: PANEL2, display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icon size={22} color={meta.c} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: meta.c }}>{w.discipline}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: done ? "#a3e635" : MUTE, background: done ? "rgba(163,230,53,0.12)" : PANEL2, border: `1px solid ${done ? "rgba(163,230,53,0.3)" : LINE}` }}>
                  {done ? "concluído" : "planejado"}
                </span>
              </div>
              <div className="disp" style={{ fontWeight: 800, fontSize: 19, color: TEXT, marginTop: 2 }}>{w.type}</div>
              <div className="mono" style={{ fontSize: 12, color: MUTE, marginTop: 2 }}>
                {toDate(w.date).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
                {w.source && <span style={{ marginLeft: 8, color: "#9fb0cc" }}>· importado</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={btn.icon} title="fechar"><X size={16} /></button>
        </div>

        {w.target && (
          <div style={{ marginTop: 16, background: "rgba(255,90,60,0.08)", border: `1px solid rgba(255,90,60,0.3)`, borderRadius: 12, padding: "10px 13px" }}>
            <div style={{ fontSize: 11, color: ACCENT, fontWeight: 700, marginBottom: 3 }}>ALVO</div>
            <div style={{ fontSize: 14, color: "#ffd9cf" }}>{w.target}</div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 9, marginTop: 16 }}>
          <Metric icon={Activity} label="Duração" value={w.durationMin ? fmtDur(w.durationMin) : null} color="#22d3ee" />
          <Metric icon={Footprints} label="Distância" value={w.distance ? `${w.distance} ${w.distUnit}` : null} color="#a3e635" />
          <Metric icon={Gauge} label="Ritmo" value={pace} color="#9fb0cc" />
          <Metric icon={Heart} label="FC média" value={w.avgHr ? `${w.avgHr} bpm` : null} color="#ff8a73" />
          <Metric icon={Heart} label="FC máx" value={w.maxHr ? `${w.maxHr} bpm` : null} color="#ff5a3c" />
          <Metric icon={Mountain} label="Elevação" value={w.elevationM != null ? `${w.elevationM} m` : null} color="#c084fc" />
          <Metric icon={Zap} label="Potência" value={w.avgPower ? `${w.avgPower} W` : null} color="#f5a524" />
          <Metric icon={Flame} label="Calorias" value={w.calories ? `${w.calories} kcal` : null} color="#ff7a1a" />
          <Metric icon={Activity} label="RPE" value={done && w.rpe ? `${w.rpe}/10` : null} color="#a3e635" />
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: MUTE, fontWeight: 700, marginBottom: 6 }}>
            <FileText size={13} /> OBSERVAÇÕES DO TREINADOR
          </div>
          <div style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px", fontSize: 13.5, color: w.notes ? TEXT : MUTE, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {w.notes || "Sem observações para este treino."}
          </div>
        </div>

        {(onToggle || onDelete) && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            {onToggle && (
              <button onClick={() => onToggle(w.id)} style={done ? { ...btn.outline } : { ...btn.solid }}>
                <Check size={16} /> {done ? "Desmarcar" : "Marcar como feito"}
              </button>
            )}
            {done && onRpe && (
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: MUTE }}>
                Como foi? (RPE)
                <select value={w.rpe || 5} onChange={(e) => onRpe(w.id, Number(e.target.value))} style={{ ...inp.base, width: 64, padding: "7px 8px" }}>
                  {[1,2,3,4,5,6,7,8,9,10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            {onDelete && <button onClick={() => onDelete(w.id)} style={{ ...btn.icon, marginLeft: "auto" }} title="remover treino"><Trash2 size={15} /></button>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= primitives ================= */
function Logo({ big, compact }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: big ? 40 : 34, height: big ? 40 : 34, borderRadius: 11, background: `linear-gradient(135deg,${ACCENT},#ffae3c)`, display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Activity size={big ? 22 : 19} color="#160d09" strokeWidth={2.6} />
      </div>
      {!compact && <span className="disp" style={{ fontWeight: 900, fontSize: big ? 24 : 18, color: TEXT, letterSpacing: 0.5 }}>TRI<span style={{ color: ACCENT }}>BASE</span></span>}
    </div>
  );
}
function Frame({ title, subtitle, onExit, exitLabel, logout, backIcon, children }) {
  const narrow = useMediaQuery("(max-width: 560px)");
  return (
    <div style={{
      maxWidth: 980, margin: "0 auto",
      padding: `calc(22px + env(safe-area-inset-top)) calc(${narrow ? 14 : 20}px + env(safe-area-inset-right)) calc(86px + env(safe-area-inset-bottom)) calc(${narrow ? 14 : 20}px + env(safe-area-inset-left))`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: narrow ? 16 : 22, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: narrow ? 10 : 14, minWidth: 0 }}>
          <Logo compact={narrow} />
          {!narrow && <div style={{ width: 1, height: 26, background: LINE, flexShrink: 0 }} />}
          <div style={{ minWidth: 0 }}>
            <div className="disp" style={{ fontWeight: 800, fontSize: narrow ? 16 : 19, color: TEXT, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
            {subtitle && <div style={{ color: MUTE, fontSize: 12.5, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</div>}
          </div>
        </div>
        <button onClick={onExit} style={{ ...btn.ghost, flexShrink: 0 }}>{logout ? <LogOut size={15} /> : <ChevronLeft size={15} />} {exitLabel}</button>
      </div>
      {children}
    </div>
  );
}
function Stat({ label, value, unit, color, icon: Icon }) {
  return (
    <div style={{ ...card.base, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11.5, color: MUTE, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</span>
        {Icon && <Icon size={15} color={color} />}
      </div>
      <div className="disp" style={{ fontWeight: 900, fontSize: 30, color, marginTop: 6, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: MUTE, marginTop: 3 }}>{unit}</div>
    </div>
  );
}
export function SectionTitle({ children }) { return <div className="disp" style={{ fontWeight: 700, fontSize: 14.5, color: TEXT, marginBottom: 12 }}>{children}</div>; }
function Field({ label, children }) {
  return <label style={{ display: "block", marginBottom: 10 }}><span style={{ display: "block", fontSize: 11.5, color: MUTE, marginBottom: 5 }}>{label}</span>{children}</label>;
}
function Pill({ children }) { return <span className="mono" style={{ fontSize: 11.5, color: MUTE, background: PANEL, border: `1px solid ${LINE}`, padding: "6px 11px", borderRadius: 20 }}>{children}</span>; }
export function Empty({ children }) { return <div style={{ color: MUTE, fontSize: 13, padding: "10px 2px" }}>{children}</div>; }
function Center({ children }) { return <div style={{ display: "grid", placeItems: "center", minHeight: "60vh", color: MUTE }} className="mono">{children}</div>; }

const shell = {
  root: { minHeight: "100vh", background: INK, color: TEXT, position: "relative", overflow: "hidden", fontFamily: "'Hanken Grotesk', system-ui, sans-serif" },
  glow1: { position: "absolute", top: -160, right: -120, width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,90,60,0.16), transparent 70%)", filter: "blur(20px)", zIndex: 0 },
  glow2: { position: "absolute", bottom: -200, left: -140, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,211,238,0.12), transparent 70%)", filter: "blur(20px)", zIndex: 0 },
};
export const card = { base: { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16, padding: 20 } };
const grid2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 };
const inp = { base: { width: "100%", padding: "10px 12px", borderRadius: 10, background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, fontSize: 14, outline: "none" } };
const btn = {
  solid: { display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 16px", borderRadius: 11, border: "none", cursor: "pointer", background: `linear-gradient(135deg,${ACCENT},#ff7a4c)`, color: "#1a0c07", fontWeight: 700, fontSize: 13.5 },
  outline: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 14px", borderRadius: 11, cursor: "pointer", background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, fontWeight: 600, fontSize: 13 },
  ghost: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 10, cursor: "pointer", background: "transparent", border: `1px solid ${LINE}`, color: MUTE, fontSize: 12.5 },
  icon: { width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center", background: "transparent", border: `1px solid ${LINE}`, color: MUTE, flexShrink: 0 },
};
