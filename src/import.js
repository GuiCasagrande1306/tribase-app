/* ============================================================
 *  import.js — converte exports de Strava/Garmin em treinos
 *  Suporta: CSV (Bulk Export do Strava ou lista do Garmin),
 *           GPX e TCX (arquivos individuais de atividade).
 *  Saída: { date, discipline, type, durationMin, distance, distUnit,
 *           status:'concluído', source }
 * ============================================================ */

export function mapType(raw) {
  const s = (raw || "").toLowerCase();
  if (s.includes("swim") || s.includes("nat")) return "Natação";
  if (s.includes("ride") || s.includes("cycl") || s.includes("bik") || s.includes("pedal")) return "Pedal";
  if (s.includes("run") || s.includes("corr")) return "Corrida";
  if (s.includes("strength") || s.includes("weight") || s.includes("workout") || s.includes("forç") || s.includes("forc")) return "Força";
  if (s.includes("brick")) return "Brick";
  return "Corrida";
}

function parseDuration(v) {
  if (v == null) return 0;
  const str = String(v).trim();
  if (str.includes(":")) {
    const p = str.split(":").map(Number);
    let sec = 0;
    if (p.length === 3) sec = p[0] * 3600 + p[1] * 60 + p[2];
    else if (p.length === 2) sec = p[0] * 60 + p[1];
    return Math.round(sec / 60);
  }
  const n = parseFloat(str.replace(",", "."));
  if (!isFinite(n)) return 0;
  return Math.round(n / 60); // assume segundos
}

function parseNum(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.,-]/g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}

/* número opcional: devolve null (não 0) quando a coluna está ausente/vazia,
   para não gravar métrica de performance falsa (FC 0, etc.) */
function numOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/[^0-9.,-]/g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}
function intOrNull(v) {
  const n = numOrNull(v);
  return n == null ? null : Math.round(n);
}

/* meses em PT e EN, casados pelos 3 primeiros caracteres (sem acento/ponto) */
const PT_MON = "jan fev mar abr mai jun jul ago set out nov dez".split(" ");
const EN_MON = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
function monthFromName(w) {
  const k = String(w).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\.+$/, "").slice(0, 3);
  const i = PT_MON.indexOf(k);
  if (i >= 0) return i + 1;
  const j = EN_MON.indexOf(k);
  return j >= 0 ? j + 1 : 0;
}

/* Converte datas de várias origens para "YYYY-MM-DD".
   Cobre: ISO, "1 de ago. de 2024" (Strava PT), "Aug 1, 2024" (Strava EN),
   "01/08/2024" (Garmin/planilhas, assume DD/MM no padrão BR). */
function toISODate(v) {
  if (v == null) return null;
  const str = String(v).trim();
  if (!str) return null;
  const pad = (n) => String(n).padStart(2, "0");

  // 1) ISO: 2024-08-01 (com ou sem hora)
  let m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // 2) PT: "1 de ago. de 2024", "1º de agosto de 2024", "01 ago 2024"
  m = str.match(/(\d{1,2})\s*º?\s*(?:de\s+)?([A-Za-zçÇÀ-ÿ]+)\.?\s*(?:de\s+)?(\d{4})/);
  if (m) { const mo = monthFromName(m[2]); if (mo) return `${m[3]}-${pad(mo)}-${pad(+m[1])}`; }

  // 3) EN: "Aug 1, 2024"
  m = str.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) { const mo = monthFromName(m[1]); if (mo) return `${m[3]}-${pad(mo)}-${pad(+m[2])}`; }

  // 4) "01/08/2024" ou "01.08.2024" — assume DD/MM/AAAA (BR); inverte se inequívoco
  m = str.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (m) {
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; } // era MM/DD/AAAA
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${m[3]}-${pad(mo)}-${pad(d)}`;
  }

  // 5) último recurso: deixa o motor do JS tentar
  const dt = new Date(str);
  if (!isNaN(dt.getTime())) return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  return null;
}

/* normaliza distância para a unidade certa por modalidade */
function normalizeDistance(value, discipline) {
  let v = value;
  if (discipline === "Natação") {
    // queremos metros; "1.9" (km) -> 1900 m
    if (v > 0 && v <= 50) v = v * 1000;
    return { distance: Math.round(v), distUnit: "m" };
  }
  // corrida/pedal: queremos km; valores grandes provavelmente em metros
  if (v > 100) v = v / 1000;
  return { distance: Math.round(v * 100) / 100, distUnit: "km" };
}

/* ---------------- CSV ---------------- */
export function parseCSV(text) {
  const rows = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function findCol(headers, needles) {
  const h = headers.map((x) => x.toLowerCase().trim());
  for (const n of needles) {
    const idx = h.findIndex((x) => x.includes(n));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function csvToWorkouts(text) {
  const rows = parseCSV(text).filter((r) => r.length && r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];
  const headers = rows[0];
  const ci = {
    date: findCol(headers, ["activity date", "date", "data", "start time"]),
    type: findCol(headers, ["activity type", "type", "tipo", "sport"]),
    dur: findCol(headers, ["moving time", "tempo em movimento", "tempo de movimento", "elapsed time", "tempo decorrido", "duration", "duração", "duracao", "time", "tempo"]),
    dist: findCol(headers, ["distance", "distância", "distancia"]),
    name: findCol(headers, ["activity name", "name", "title", "nome"]),
    // métricas de performance (alimentam a recalibração mensal)
    hrAvg: findCol(headers, ["average heart rate", "avg heart rate", "frequência cardíaca média", "frequencia cardiaca media", "fc média", "fc media"]),
    hrMax: findCol(headers, ["max heart rate", "maximum heart rate", "frequência cardíaca máxima", "frequencia cardiaca maxima", "fc máx", "fc max"]),
    elev: findCol(headers, ["elevation gain", "ganho de elevação", "ganho de elevacao", "elevation"]),
    cal: findCol(headers, ["calories", "calorias"]),
    pow: findCol(headers, ["average watts", "average power", "potência média", "potencia media", "weighted average power"]),
  };
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const date = ci.date >= 0 ? toISODate(row[ci.date]) : null;
    if (!date) continue;
    const discipline = mapType(ci.type >= 0 ? row[ci.type] : "");
    const { distance, distUnit } = normalizeDistance(ci.dist >= 0 ? parseNum(row[ci.dist]) : 0, discipline);
    out.push({
      date, discipline,
      type: (ci.name >= 0 && row[ci.name]?.trim()) ? row[ci.name].trim() : `${discipline} (importado)`,
      durationMin: ci.dur >= 0 ? parseDuration(row[ci.dur]) : 0,
      distance, distUnit, status: "concluído", source: "csv",
      avgHr: ci.hrAvg >= 0 ? intOrNull(row[ci.hrAvg]) : null,
      maxHr: ci.hrMax >= 0 ? intOrNull(row[ci.hrMax]) : null,
      elevationM: ci.elev >= 0 ? intOrNull(row[ci.elev]) : null,
      calories: ci.cal >= 0 ? intOrNull(row[ci.cal]) : null,
      avgPower: ci.pow >= 0 ? intOrNull(row[ci.pow]) : null,
    });
  }
  return out;
}

/* ============================================================
 *  Plano em lote (lado do treinador) — cola/sobe CSV ou JSON
 *  com os treinos PLANEJADOS e cria todos de uma vez.
 *  Saída: { date, discipline, type, durationMin, distance, distUnit,
 *           target, notes, status:'planejado' }
 * ============================================================ */
const PLAN_DISC = ["Natação", "Pedal", "Corrida", "Brick", "Força", "Descanso"];
const _norm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
function normDiscipline(s) {
  const hit = PLAN_DISC.find((d) => _norm(d) === _norm(s));
  return hit || mapType(s);
}
/* duração de plano: número = minutos; "1:30" = h:mm; "1:30:00" = h:mm:ss */
function planDuration(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  if (s.includes(":")) {
    const p = s.split(":").map(Number);
    if (p.length === 3) return Math.round(p[0] * 60 + p[1] + p[2] / 60);
    if (p.length === 2) return Math.round(p[0] * 60 + p[1]);
  }
  const n = parseFloat(s.replace(",", "."));
  return isFinite(n) ? Math.round(n) : 0;
}
function normPlanRow(o) {
  const get = (...ks) => { for (const k of ks) if (o[k] != null && o[k] !== "") return o[k]; return undefined; };
  const date = toISODate(get("date", "data"));
  if (!date) return null;
  const discipline = normDiscipline(get("discipline", "modalidade", "sport", "esporte"));
  const distUnitRaw = get("distUnit", "dist_unit", "unidade", "unit");
  const distUnit = distUnitRaw ? String(distUnitRaw).trim() : (discipline === "Natação" ? "m" : "km");
  const type = get("type", "sessao", "sessão", "tipo", "treino", "title", "name", "nome");
  return {
    date, discipline,
    type: (type ? String(type).trim() : `${discipline} (planejado)`),
    durationMin: planDuration(get("durationMin", "duration_min", "duracaoMin", "duracao", "duração", "duration", "minutos", "min", "tempo")),
    distance: parseNum(get("distance", "distancia", "distância", "dist") ?? 0),
    distUnit,
    target: String(get("target", "alvo", "pace", "zona") || "").trim(),
    notes: String(get("notes", "notas", "observacoes", "observações", "obs", "descricao", "descrição") || "").trim(),
    status: "planejado",
  };
}
function csvToPlan(text) {
  const rows = parseCSV(text).filter((r) => r.length && r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];
  const headers = rows[0];
  const ci = {
    date: findCol(headers, ["date", "data"]),
    discipline: findCol(headers, ["discipline", "modalidade", "esporte", "sport"]),
    type: findCol(headers, ["tipo de sess", "sessão", "sessao", "type", "tipo", "treino", "nome", "title", "name"]),
    dur: findCol(headers, ["duration_min", "durationmin", "duração", "duracao", "duration", "minutos", "tempo", "min"]),
    dist: findCol(headers, ["distance", "distância", "distancia"]),
    unit: findCol(headers, ["dist_unit", "unidade", "unit"]),
    target: findCol(headers, ["target", "alvo", "pace", "zona"]),
    notes: findCol(headers, ["notes", "notas", "observ", "obs", "descri"]),
  };
  const at = (row, i) => (i >= 0 ? row[i] : undefined);
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const w = normPlanRow({
      date: at(row, ci.date), discipline: at(row, ci.discipline), type: at(row, ci.type),
      durationMin: at(row, ci.dur), distance: at(row, ci.dist), distUnit: at(row, ci.unit),
      target: at(row, ci.target), notes: at(row, ci.notes),
    });
    if (w) out.push(w);
  }
  return out;
}
export function parsePlanText(text) {
  const t = (text || "").trim();
  if (!t) return [];
  if (t[0] === "[" || t[0] === "{") {
    let data;
    try { data = JSON.parse(t); } catch (e) { return []; }
    let rows = [];
    if (Array.isArray(data)) rows = data;
    else if (Array.isArray(data.workouts)) rows = data.workouts;
    else if (Array.isArray(data.treinos)) rows = data.treinos;
    return rows.map(normPlanRow).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  }
  return csvToPlan(t).sort((a, b) => a.date.localeCompare(b.date));
}

/* ============================================================
 *  Reconciliação: casa cada atividade importada com um treino
 *  PLANEJADO (mesma modalidade, data ±1 dia), sem duplicar.
 *  `planned` = treinos com status 'planejado' (camelCase, do app).
 *  Devolve as atividades anotadas com _matchId / _matchType / _matchDate.
 * ============================================================ */
export function matchPlan(activities, planned) {
  const used = new Set();
  const pool = (planned || []).filter((p) => p.status === "planejado");
  const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
  return (activities || []).map((a) => {
    let best = null, bestDiff = 99;
    for (const p of pool) {
      if (used.has(p.id) || p.discipline !== a.discipline) continue;
      const dd = dayDiff(a.date, p.date);
      if (dd <= 1 && dd < bestDiff) { best = p; bestDiff = dd; }
    }
    if (best) { used.add(best.id); return { ...a, _matchId: best.id, _matchType: best.type, _matchDate: best.date }; }
    return { ...a, _matchId: null };
  });
}

/* ---------------- GPX / TCX ---------------- */
function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function parseXML(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}

function tcxToWorkout(doc) {
  const act = doc.querySelector("Activity");
  const sport = act?.getAttribute("Sport") || "";
  const id = doc.querySelector("Activity > Id")?.textContent;
  let totalSec = 0, totalM = 0, cal = 0;
  doc.querySelectorAll("Lap").forEach((lap) => {
    totalSec += parseFloat(lap.querySelector("TotalTimeSeconds")?.textContent || 0);
    totalM += parseFloat(lap.querySelector("DistanceMeters")?.textContent || 0);
    cal += parseFloat(lap.querySelector("Calories")?.textContent || 0);
  });
  // FC: média das amostras dos trackpoints
  const hrs = [...doc.querySelectorAll("Trackpoint HeartRateBpm Value")]
    .map((v) => parseFloat(v.textContent)).filter(isFinite);
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHr = hrs.length ? Math.max(...hrs) : null;
  const discipline = mapType(sport);
  const { distance, distUnit } = normalizeDistance(totalM, discipline);
  return {
    date: toISODate(id || Date.now()), discipline, type: `${discipline} (importado)`,
    durationMin: Math.round(totalSec / 60), distance, distUnit, status: "concluído", source: "tcx",
    avgHr, maxHr, elevationM: null, calories: cal ? Math.round(cal) : null, avgPower: null,
  };
}

function gpxToWorkout(doc) {
  const type = doc.querySelector("trk > type")?.textContent || doc.querySelector("type")?.textContent || "";
  const pts = [...doc.querySelectorAll("trkpt")].map((p) => ({
    lat: parseFloat(p.getAttribute("lat")), lon: parseFloat(p.getAttribute("lon")),
    time: p.querySelector("time")?.textContent,
  }));
  let dist = 0;
  for (let i = 1; i < pts.length; i++) {
    if (isFinite(pts[i].lat) && isFinite(pts[i - 1].lat)) dist += haversine(pts[i - 1], pts[i]);
  }
  const times = pts.map((p) => p.time).filter(Boolean);
  let sec = 0;
  if (times.length >= 2) sec = (new Date(times[times.length - 1]) - new Date(times[0])) / 1000;
  const discipline = mapType(type);
  const { distance, distUnit } = normalizeDistance(dist, discipline);
  // FC opcional (extensões Garmin: <gpxtpx:hr> ou <ns3:hr>)
  const hrs = [...doc.querySelectorAll("trkpt *")]
    .filter((el) => el.localName === "hr")
    .map((el) => parseFloat(el.textContent)).filter(isFinite);
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHr = hrs.length ? Math.max(...hrs) : null;
  return {
    date: toISODate(times[0] || Date.now()), discipline, type: `${discipline} (importado)`,
    durationMin: Math.round(sec / 60), distance, distUnit, status: "concluído", source: "gpx",
    avgHr, maxHr, elevationM: null, calories: null, avgPower: null,
  };
}

/* ---------------- entrada principal ---------------- */
export async function parseImportFiles(files) {
  const result = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    let text = "";
    try { text = await file.text(); } catch (e) { continue; }
    try {
      if (name.endsWith(".csv")) {
        result.push(...csvToWorkouts(text));
      } else if (name.endsWith(".tcx")) {
        result.push(tcxToWorkout(parseXML(text)));
      } else if (name.endsWith(".gpx")) {
        result.push(gpxToWorkout(parseXML(text)));
      }
      // .fit / .gz não suportados (binário) — orientar o usuário a usar CSV/GPX/TCX
    } catch (e) { /* ignora arquivo problemático */ }
  }
  // ordena por data e remove entradas sem data
  return result.filter((w) => w.date).sort((a, b) => a.date.localeCompare(b.date));
}
