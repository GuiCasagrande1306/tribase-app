import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import {
  PANEL, PANEL2, LINE, TEXT, MUTE, ACCENT, DISC, DISCIPLINES, card,
  weekStart, toDate, dm, todayISO, addDays, sum, mmss, fmtDur, adherColor,
  SectionTitle, Empty,
} from "./App.jsx";

/* ===== Planejado × Cumprido (comparação visual após importação) ===== */
function planVsActual(workouts, weeks) {
  const wkStart = weekStart(todayISO()).toISOString().slice(0, 10);
  const wkEnd = addDays(wkStart, 6);
  const from = weeks ? addDays(wkStart, -(weeks - 1) * 7) : "0000-00-00";
  const to = weeks ? wkEnd : "9999-12-31";
  const inP = workouts.filter((w) => w.date >= from && w.date <= to);
  const mods = {};
  inP.forEach((w) => {
    const m = (mods[w.discipline] = mods[w.discipline] || { mod: w.discipline, planMin: 0, planN: 0, planDoneN: 0, doneMin: 0, doneN: 0, extraMin: 0, extraN: 0 });
    const fromPlan = w.source !== "import"; // prescrição = treino do plano (não importado)
    const done = w.status === "concluído";
    if (fromPlan) { m.planMin += w.durationMin || 0; m.planN += 1; if (done) m.planDoneN += 1; }
    if (done) { m.doneMin += w.durationMin || 0; m.doneN += 1; }
    if (done && !fromPlan) { m.extraMin += w.durationMin || 0; m.extraN += 1; } // importado extra (fora do plano)
  });
  const rows = DISCIPLINES.filter((d) => mods[d] && (mods[d].planMin || mods[d].doneMin)).map((d) => {
    const m = mods[d];
    return { mod: d, planejado: +(m.planMin / 60).toFixed(2), cumprido: +(m.doneMin / 60).toFixed(2) };
  });
  const vals = Object.values(mods);
  const planMin = sum(vals.map((m) => m.planMin));
  const planN = sum(vals.map((m) => m.planN));
  const planDoneN = sum(vals.map((m) => m.planDoneN));
  const doneMin = sum(vals.map((m) => m.doneMin));
  const extraN = sum(vals.map((m) => m.extraN));
  const extraMin = sum(vals.map((m) => m.extraMin));
  const adher = planN ? Math.round((planDoneN / planN) * 100) : null;
  return { rows, planMin, planN, planDoneN, doneMin, extraN, extraMin, adher };
}
export function PlanVsActual({ workouts, title = "Planejado × cumprido" }) {
  const [weeks, setWeeks] = useState(4);
  const d = useMemo(() => planVsActual(workouts, weeks), [workouts, weeks]);
  const tip = { background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10, color: TEXT, fontSize: 12 };
  return (
    <div style={{ ...card.base, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <SectionTitle>{title}</SectionTitle>
        <div style={{ display: "flex", gap: 6 }}>
          {[[1, "semana"], [4, "4 sem"], [8, "8 sem"], [0, "tudo"]].map(([v, l]) => (
            <button key={l} onClick={() => setWeeks(v)} style={{
              padding: "6px 11px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 600,
              border: `1px solid ${weeks === v ? ACCENT : LINE}`, background: weeks === v ? "rgba(255,90,60,0.12)" : PANEL2, color: weeks === v ? "#ffd9cf" : MUTE,
            }}>{l}</button>
          ))}
        </div>
      </div>
      {d.planN === 0 && d.doneN === 0 ? (
        <Empty>Sem treinos no período.</Empty>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
            <div style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, color: MUTE, textTransform: "uppercase", letterSpacing: 0.5 }}>Aderência ao plano</div>
              <div className="disp" style={{ fontWeight: 900, fontSize: 26, color: adherColor(d.adher), marginTop: 4, lineHeight: 1 }}>{d.adher == null ? "—" : `${d.adher}%`}</div>
              <div style={{ fontSize: 11.5, color: MUTE, marginTop: 4 }}>{d.planDoneN}/{d.planN} treinos do plano</div>
            </div>
            <div style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, color: MUTE, textTransform: "uppercase", letterSpacing: 0.5 }}>Volume planejado</div>
              <div className="disp" style={{ fontWeight: 900, fontSize: 26, color: "#7d8db0", marginTop: 4, lineHeight: 1 }}>{fmtDur(d.planMin)}</div>
              <div style={{ fontSize: 11.5, color: MUTE, marginTop: 4 }}>prescrito no período</div>
            </div>
            <div style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, color: MUTE, textTransform: "uppercase", letterSpacing: 0.5 }}>Volume cumprido</div>
              <div className="disp" style={{ fontWeight: 900, fontSize: 26, color: "#a3e635", marginTop: 4, lineHeight: 1 }}>{fmtDur(d.doneMin)}</div>
              <div style={{ fontSize: 11.5, color: MUTE, marginTop: 4 }}>{d.extraN > 0 ? `inclui ${d.extraN} extra(s) do Strava` : "realizado"}</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.rows} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
              <XAxis dataKey="mod" stroke={MUTE} fontSize={11} tickLine={false} />
              <YAxis stroke={MUTE} fontSize={11} tickLine={false} axisLine={false} width={46} tickFormatter={(v) => fmtDur(v * 60)} />
              <Tooltip contentStyle={tip} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v, n) => [fmtDur(v * 60), n === "planejado" ? "planejado" : "cumprido"]} />
              <Legend wrapperStyle={{ fontSize: 11.5 }} />
              <Bar dataKey="planejado" name="planejado" fill="#46546f" radius={[3, 3, 0, 0]} />
              <Bar dataKey="cumprido" name="cumprido" fill="#a3e635" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

export function Reports({ workouts }) {
  const weekly = useMemo(() => {
    const m = {};
    workouts.forEach((w) => {
      const k = weekStart(w.date).toISOString().slice(0, 10);
      m[k] = m[k] || { week: dm(toDate(k)), _k: k };
      m[k][w.discipline] = (m[k][w.discipline] || 0) + w.durationMin / 60;
    });
    return Object.values(m).sort((a, b) => a._k.localeCompare(b._k))
      .map((r) => { DISCIPLINES.forEach((d) => { r[d] = +(r[d] || 0).toFixed(2); }); return r; });
  }, [workouts]);
  const split = useMemo(() => {
    const m = {};
    workouts.forEach((w) => { m[w.discipline] = (m[w.discipline] || 0) + w.durationMin; });
    return DISCIPLINES.filter((d) => m[d]).map((d) => ({ name: d, value: Math.round(m[d]) }));
  }, [workouts]);
  const trend = useMemo(() => {
    const m = {};
    workouts.forEach((w) => {
      const k = weekStart(w.date).toISOString().slice(0, 10);
      m[k] = m[k] || { week: dm(toDate(k)), _k: k, planejados: 0, concluídos: 0 };
      m[k].planejados += 1;
      if (w.status === "concluído") m[k].concluídos += 1;
    });
    return Object.values(m).sort((a, b) => a._k.localeCompare(b._k));
  }, [workouts]);
  if (!workouts.length) return <Empty>Sem dados ainda. Quando houver treinos, os relatórios aparecem aqui.</Empty>;
  const tip = { background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10, color: TEXT, fontSize: 12 };
  return (
    <div className="rise">
      <PlanVsActual workouts={workouts} />
      <div style={card.base}>
        <SectionTitle>Horas por semana, por modalidade</SectionTitle>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={weekly} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
            <XAxis dataKey="week" stroke={MUTE} fontSize={11} tickLine={false} />
            <YAxis stroke={MUTE} fontSize={11} tickLine={false} axisLine={false} width={46} tickFormatter={(v) => fmtDur(v * 60)} />
            <Tooltip contentStyle={tip} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v) => fmtDur(v * 60)} />
            <Legend wrapperStyle={{ fontSize: 11.5 }} />
            {DISCIPLINES.map((d) => <Bar key={d} dataKey={d} stackId="a" fill={DISC[d].c} radius={[2, 2, 0, 0]} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14, marginTop: 14 }}>
        <div style={card.base}>
          <SectionTitle>Distribuição por modalidade</SectionTitle>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={split} dataKey="value" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={3} stroke="none">
                {split.map((s) => <Cell key={s.name} fill={DISC[s.name].c} />)}
              </Pie>
              <Tooltip contentStyle={tip} formatter={(v) => fmtDur(v)} />
              <Legend wrapperStyle={{ fontSize: 11.5 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={card.base}>
          <SectionTitle>Planejado x concluído</SectionTitle>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={trend} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
              <XAxis dataKey="week" stroke={MUTE} fontSize={11} tickLine={false} />
              <YAxis stroke={MUTE} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tip} />
              <Legend wrapperStyle={{ fontSize: 11.5 }} />
              <Line type="monotone" dataKey="planejados" stroke={MUTE} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="concluídos" stroke="#a3e635" strokeWidth={2.4} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/* ================= evolução / tendências ================= */
const PACE_DISC = ["Corrida", "Pedal", "Natação"];
function paceVal(w) {
  if (!w.durationMin || !w.distance) return null;
  if (w.discipline === "Pedal") return w.distance / (w.durationMin / 60);          // km/h (maior = melhor)
  if (w.discipline === "Natação") return (w.durationMin * 60) / (w.distance / 100); // s/100m (menor = melhor)
  return (w.durationMin * 60) / w.distance;                                         // s/km (menor = melhor)
}
function fmtPaceVal(disc, v) {
  if (v == null) return "—";
  if (disc === "Pedal") return `${(+v).toFixed(1)} km/h`;
  return `${mmss(v)}${disc === "Natação" ? "/100m" : "/km"}`;
}
function weeklyPaceSeries(workouts, disc) {
  const better = disc === "Pedal" ? Math.max : Math.min;
  const m = {};
  workouts.filter((w) => w.discipline === disc && w.status === "concluído").forEach((w) => {
    const v = paceVal(w); if (v == null) return;
    const k = weekStart(w.date).toISOString().slice(0, 10);
    m[k] = m[k] == null ? v : better(m[k], v);
  });
  return Object.keys(m).sort().map((k) => ({ week: dm(toDate(k)), _k: k, val: disc === "Pedal" ? +m[k].toFixed(1) : Math.round(m[k]) }));
}
function weeklyHrSeries(workouts, disc) {
  const s = {}, c = {};
  workouts.filter((w) => w.discipline === disc && w.status === "concluído" && w.avgHr).forEach((w) => {
    const k = weekStart(w.date).toISOString().slice(0, 10);
    s[k] = (s[k] || 0) + w.avgHr; c[k] = (c[k] || 0) + 1;
  });
  return Object.keys(s).sort().map((k) => ({ week: dm(toDate(k)), _k: k, hr: Math.round(s[k] / c[k]) }));
}
function weeklyVolumeSeries(workouts) {
  const m = {};
  workouts.filter((w) => w.status === "concluído").forEach((w) => {
    const k = weekStart(w.date).toISOString().slice(0, 10);
    m[k] = (m[k] || 0) + (w.durationMin || 0) / 60;
  });
  return Object.keys(m).sort().map((k) => ({ week: dm(toDate(k)), _k: k, h: +m[k].toFixed(2) }));
}
/* km percorridos por semana, por modalidade (natação convertida de m p/ km) */
function weeklyDistanceSeries(workouts) {
  const km = (w) => (w.distUnit === "m" ? (w.distance || 0) / 1000 : (w.distance || 0));
  const present = {}, m = {};
  workouts.filter((w) => w.status === "concluído" && w.distance > 0).forEach((w) => {
    const k = weekStart(w.date).toISOString().slice(0, 10);
    m[k] = m[k] || { week: dm(toDate(k)), _k: k };
    m[k][w.discipline] = +((m[k][w.discipline] || 0) + km(w)).toFixed(1);
    present[w.discipline] = true;
  });
  const discs = DISCIPLINES.filter((d) => present[d]);
  const data = Object.keys(m).sort().map((k) => {
    const row = m[k];
    discs.forEach((d) => { if (row[d] == null) row[d] = 0; }); // semana sem aquele esporte = 0 km
    return row;
  });
  return { data, discs };
}
function TrendCard({ label, value, sub, good, color }) {
  const Arrow = good == null ? null : good ? TrendingUp : TrendingDown;
  const ac = good == null ? MUTE : good ? "#a3e635" : "#ff8a73";
  return (
    <div style={{ ...card.base, padding: 16 }}>
      <div style={{ fontSize: 11.5, color: MUTE, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
      <div className="disp mono" style={{ fontWeight: 900, fontSize: 26, color: color || TEXT, marginTop: 6, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: ac, marginTop: 5, fontWeight: 600 }}>{Arrow && <Arrow size={14} />}{sub}</div>}
    </div>
  );
}
export function Evolution({ workouts }) {
  const avail = PACE_DISC.filter((d) => weeklyPaceSeries(workouts, d).length >= 2);
  const [discSel, setDiscSel] = useState(null);
  const sel = (discSel && avail.includes(discSel)) ? discSel : (avail[0] || "Corrida");
  const pace = useMemo(() => weeklyPaceSeries(workouts, sel), [workouts, sel]);
  const hr = useMemo(() => weeklyHrSeries(workouts, sel), [workouts, sel]);
  const vol = useMemo(() => weeklyVolumeSeries(workouts), [workouts]);
  const dist = useMemo(() => weeklyDistanceSeries(workouts), [workouts]);

  if (!avail.length) return <Empty>Sem dados suficientes ainda. Conclua ou importe alguns treinos (de pelo menos 2 semanas) para ver sua evolução.</Empty>;

  const isBike = sel === "Pedal";
  const vals = pace.map((p) => p.val);
  const best = isBike ? Math.max(...vals) : Math.min(...vals);
  const first = vals[0], last = vals[vals.length - 1];
  const paceImproved = isBike ? last > first : last < first;
  const paceDelta = isBike ? `${Math.abs(last - first).toFixed(1)} km/h` : `${mmss(Math.abs(last - first))}`;
  const paceSign = isBike ? (paceImproved ? "+" : "−") : (paceImproved ? "−" : "+");
  const hrFirst = hr.length ? hr[0].hr : null, hrLast = hr.length ? hr[hr.length - 1].hr : null;
  const hrImproved = hrFirst != null && hrLast < hrFirst;
  const totalH = sum(vol.map((v) => v.h));
  const c = DISC[sel].c;
  const tip = { background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10, color: TEXT, fontSize: 12 };

  return (
    <div className="rise">
      <div style={{ ...card.base, marginBottom: 16 }}>
        <SectionTitle>Distância por semana, por modalidade <span style={{ color: MUTE, fontWeight: 400, fontSize: 11.5 }}>· km total empilhado (natação convertida de m)</span></SectionTitle>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={dist.data} margin={{ top: 6, right: 12, left: -6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
            <XAxis dataKey="week" stroke={MUTE} fontSize={11} tickLine={false} />
            <YAxis domain={[0, "auto"]} stroke={MUTE} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}`} />
            <Tooltip contentStyle={tip} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v, name) => [`${v} km`, name]} />
            <Legend wrapperStyle={{ fontSize: 11.5 }} />
            {dist.discs.map((d, i) => (
              <Bar key={d} dataKey={d} name={d} stackId="km" fill={DISC[d].c} radius={i === dist.discs.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {avail.map((d) => {
          const Icon = DISC[d].icon;
          return (
            <button key={d} onClick={() => setDiscSel(d)} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 11, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${sel === d ? DISC[d].c : LINE}`, background: sel === d ? `${DISC[d].c}1f` : PANEL, color: sel === d ? TEXT : MUTE,
            }}><Icon size={15} color={DISC[d].c} /> {d}</button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
        <TrendCard label="Melhor ritmo" value={fmtPaceVal(sel, best)} color={c}
          sub={`recorde de ${pace.length} semanas`} good={null} />
        <TrendCard label="Evolução no período" value={`${paceSign}${paceDelta}`}
          sub={paceImproved ? "mais rápido que no início" : "mais lento que no início"} good={paceImproved} color={paceImproved ? "#a3e635" : "#ff8a73"} />
        {hrFirst != null && (
          <TrendCard label="FC média (eficiência)" value={`${hrLast} bpm`}
            sub={hrImproved ? `${hrFirst - hrLast} bpm mais baixa` : `${hrLast - hrFirst} bpm mais alta`} good={hrImproved} color="#ff8a73" />
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14, marginTop: 14 }}>
        <div style={card.base}>
          <SectionTitle>Ritmo por semana · {sel} {!isBike && <span style={{ color: MUTE, fontWeight: 400, fontSize: 11.5 }}>(↑ = mais rápido)</span>}</SectionTitle>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={pace} margin={{ top: 6, right: 10, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
              <XAxis dataKey="week" stroke={MUTE} fontSize={11} tickLine={false} />
              <YAxis reversed={!isBike} domain={["auto", "auto"]} stroke={MUTE} fontSize={11} tickLine={false} axisLine={false} width={52}
                tickFormatter={(v) => (isBike ? v : mmss(v))} />
              <Tooltip contentStyle={tip} formatter={(v) => [fmtPaceVal(sel, v), "ritmo"]} />
              <Line type="monotone" dataKey="val" stroke={c} strokeWidth={2.6} dot={{ r: 3, fill: c }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={card.base}>
          <SectionTitle>FC média por semana · {sel} <span style={{ color: MUTE, fontWeight: 400, fontSize: 11.5 }}>(↓ = mais eficiente)</span></SectionTitle>
          {hr.length >= 2 ? (
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={hr} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
                <XAxis dataKey="week" stroke={MUTE} fontSize={11} tickLine={false} />
                <YAxis domain={["auto", "auto"]} stroke={MUTE} fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tip} formatter={(v) => [`${v} bpm`, "FC média"]} />
                <Line type="monotone" dataKey="hr" stroke="#ff5a3c" strokeWidth={2.6} dot={{ r: 3, fill: "#ff5a3c" }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty>Sem dados de FC para {sel} ainda.</Empty>}
        </div>
      </div>

      <div style={{ ...card.base, marginTop: 14 }}>
        <SectionTitle>Volume concluído por semana <span style={{ color: MUTE, fontWeight: 400, fontSize: 11.5 }}>· {fmtDur(totalH * 60)} no total</span></SectionTitle>
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={vol} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
            <XAxis dataKey="week" stroke={MUTE} fontSize={11} tickLine={false} />
            <YAxis stroke={MUTE} fontSize={11} tickLine={false} axisLine={false} width={46} tickFormatter={(v) => fmtDur(v * 60)} />
            <Tooltip contentStyle={tip} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v) => [fmtDur(v * 60), "volume"]} />
            <Bar dataKey="h" fill="#22d3ee" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
