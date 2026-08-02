// strava-oauth — troca o "code" do OAuth do Strava por access/refresh token
// e salva vinculado ao atleta logado. O client_secret fica AQUI (segredo),
// nunca no navegador. verify_jwt=true: só usuários autenticados.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: "Strava não configurado no servidor." }, 500);

  const auth = req.headers.get("Authorization") || "";
  const { data: { user } } = await createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } }).auth.getUser();
  if (!user) return json({ error: "Não autenticado" }, 401);

  let code = "";
  try { code = (await req.json())?.code || ""; } catch { /* */ }
  if (!code) return json({ error: "code ausente" }, 400);

  // troca o code por tokens
  const tokRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: "authorization_code" }),
  });
  const tok = await tokRes.json();
  if (!tokRes.ok || !tok.access_token) return json({ error: "Falha ao autorizar no Strava", detail: tok }, 502);

  const a = tok.athlete || {};
  const admin = createClient(SUPABASE_URL, SERVICE);
  const { error } = await admin.from("strava_accounts").upsert({
    athlete_id: user.id,
    strava_athlete_id: a.id ?? null,
    athlete_name: [a.firstname, a.lastname].filter(Boolean).join(" ") || null,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: tok.expires_at,
    scope: null,
    connected_at: new Date().toISOString(),
  }, { onConflict: "athlete_id" });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, connected: true, name: [a.firstname, a.lastname].filter(Boolean).join(" ") || null });
});
