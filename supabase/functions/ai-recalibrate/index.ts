// ai-recalibrate — analisa a semana treinada (planejado × realizado) com o Gemini
// e devolve uma análise + treinos sugeridos para a próxima semana.
// A chave do Gemini fica AQUI (segredo do projeto), nunca no navegador.
// verify_jwt = true (default): só usuários autenticados chamam esta função.

const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// esquema que o Gemini deve devolver (structured output)
const responseSchema = {
  type: "object",
  properties: {
    analise: { type: "string" }, // resumo em texto: aderência, sinais de fadiga, o que ajustar
    aderencia: { type: "string" }, // ex.: "8/10 treinos concluídos"
    ajustes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },        // AAAA-MM-DD
          discipline: { type: "string" },  // Natação | Pedal | Corrida | Brick | Força | Descanso
          type: { type: "string" },        // ex.: Limiar, Z2, VO2, Longo, Brick T2...
          duration_min: { type: "integer" },
          distance: { type: "number" },
          dist_unit: { type: "string" },   // km | m
          target: { type: "string" },      // zona/pace-alvo
          notes: { type: "string" },       // aquecimento + série + soltura
        },
        required: ["date", "discipline", "type", "duration_min", "target", "notes"],
      },
    },
  },
  required: ["analise", "ajustes"],
};

const SYSTEM = `Você é um treinador de triathlon/corrida experiente e baseado em ciência do esporte.
Recebe os dados REAIS da última(s) semana(s) de um atleta (planejado × realizado, com FC, distância, ritmo e RPE) e o perfil/meta dele.
Sua tarefa: analisar a semana e PROPOR os treinos da PRÓXIMA semana, ajustados à performance e aos sinais de fadiga.

PRINCÍPIOS OBRIGATÓRIOS:
- Distribuição polarizada/piramidal (~80% aeróbio fácil, ~20% forte).
- Sobrecarga progressiva gradual; se a aderência foi baixa ou o RPE/FC indicam fadiga, RECUE o volume/intensidade.
- Se a aderência foi alta e o atleta respondeu bem, progrida ~5–10%.
- VARIE o formato das sessões em relação à semana anterior (evite repetir o mesmo treino) mantendo o alvo fisiológico.
- Planeje EXATAMENTE "treinosPorSemana" sessões na semana (se informado no perfil); distribua com bom senso (dias de descanso entre os fortes).
- Respeite a MODALIDADE do atleta: em "Triathlon", combine natação/pedal/corrida + brick e, aos sábados, 2 modalidades em sequência com transição (alterne T2 bike→corrida e, pontualmente, T1 nado→bike); em "Corrida"/"Natação"/"Ciclismo", foque SÓ nesse esporte (sem brick/transição), variando os tipos de sessão.
- Os ritmos/zonas devem sair dos dados REAIS (melhoresRitmos e realizados vindos do Strava); não invente FC/pace se não houver dado — use percepção de esforço.
- Datas da próxima semana: use as datas reais (a partir de "hoje" informado no payload).

Escreva a "analise" em português, curta e direta, como um treinador falando com outro (o treinador humano vai revisar e aprovar).
Devolva SOMENTE o JSON no schema pedido.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!GEMINI_KEY) return json({ error: "GEMINI_API_KEY não configurada no projeto." }, 500);

  let payload: unknown;
  try { payload = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const userPrompt = `${SYSTEM}\n\nDADOS DO ATLETA (JSON):\n${JSON.stringify(payload, null, 2)}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
    const gRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.6,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    });

    if (!gRes.ok) {
      const t = await gRes.text();
      return json({ error: `Gemini ${gRes.status}`, detail: t.slice(0, 500) }, 502);
    }
    const data = await gRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: "Resposta vazia do Gemini", raw: data }, 502);

    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return json({ error: "Gemini não devolveu JSON válido", text }, 502); }
    return json({ ok: true, result: parsed, model: MODEL });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
