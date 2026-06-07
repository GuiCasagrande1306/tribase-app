import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(url && key);
if (!hasSupabaseConfig) {
  console.warn("Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env (a interface carrega, mas login/dados não funcionam sem isso).");
}
// fallback placeholder para o app inicializar mesmo sem .env (evita tela branca em dev/preview)
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  key || "placeholder-anon-key",
);
