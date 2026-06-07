# TRIBASE — plataforma de treinos de triathlon

> 🚀 **Demo no ar:** https://tribase-app.vercel.app — modo demo (`DEMO=true`), sem login,
> com alternador Atleta/Treinador. Deploy automático: cada push na branch `main` deste
> repositório (`GuiCasagrande1306/tribase-app`) publica na Vercel.

App de treinos com **login real** e **privacidade por atleta** (Supabase + Row Level
Security). Treinador cadastra atletas e sobe treinos; cada atleta acessa apenas os
seus, com visão geral, **calendário em grade semanal**, relatórios, importação de
Strava/Garmin e exportação da performance para recalibração mensal.

**O que o atleta vê:**
- **Visão geral** — sequência (streak) de dias treinados, meta da semana ("semana fechada!"),
  próximo treino, aderência e volume por modalidade.
- **Calendário** — grade semanal (seg–dom) com o dia de hoje destacado; clicar num treino
  abre o **detalhe** com as observações do treinador, alvo, pace e métricas (FC, elevação,
  calorias, potência), e permite marcar como feito + RPE.
- **Evolução** — gráfico de **barras empilhadas com a distância por semana** dividida por modalidade
  (uma cor cada, em km; natação convertida de metros) — a altura mostra o volume total da semana;
  abaixo, por modalidade: **ritmo por semana** (↑ = mais rápido),
  **FC média** (↓ = mais eficiente) e **volume concluído**, com destaques de recorde e quanto
  melhorou no período.
- **Relatórios** — começa com o **Planejado × cumprido**: aderência ao plano (treinos feitos /
  prescritos), volume planejado × realizado e um gráfico de barras por modalidade comparando o
  prescrito com o efetivamente treinado (inclui os extras importados do Strava). Depois: horas/semana,
  distribuição por modalidade e planejado × concluído. Após importar, o atleta cai direto aqui.
- **Importar / Exportar** — ver seções abaixo.

**O que o treinador vê (Painel do treinador):**
- **Visão geral de todos os atletas** — nº de atletas, treinos feitos na semana,
  aderência média e quantos **precisam de atenção**.
- **Card por atleta** com contagem regressiva até a prova (colorida por urgência),
  barra de aderência, atividade recente e **alertas**: `atrasado`, `sem plano à frente`,
  `importou Strava`, `em dia`. Os atletas que precisam de atenção aparecem primeiro.
- Clicar num card abre **Gerenciar treinos**: dados da prova, **Planejado × cumprido do atleta**
  (mesma comparação visual), **gerar plano com o Claude**, **importar plano em lote** e treinos avulsos.

> **Importante:** este projeto está pronto para você publicar. Eu (assistente) não
> consigo fazer o deploy por você porque isso exige entrar nas suas contas
> (Supabase / hospedagem) e usar suas chaves — coisas que eu não faço. Siga os
> passos abaixo: leva ~10–15 minutos e você fica no ar.

---

## Pré-requisitos
- Node.js 18+ instalado (para rodar/buildar localmente).
- Uma conta no **Supabase** (gratuita): https://supabase.com
- Uma conta de hospedagem para o front-end: **Vercel** (https://vercel.com) ou
  Netlify. Ambas têm plano gratuito.

---

## Passo 1 — Criar o projeto no Supabase
1. Em https://supabase.com, crie um projeto (escolha região e uma senha do banco).
2. Aguarde o provisionamento (~1–2 min).

## Passo 2 — Criar as tabelas e a segurança
1. No painel do Supabase, abra **SQL Editor**.
2. Cole **todo** o conteúdo de `supabase/schema.sql` e clique em **Run**.
   Isso cria as tabelas `profiles` e `workouts`, o gatilho que cria o perfil ao
   registrar usuário, as funções `become_coach` / `link_athlete` e as políticas de
   RLS que garantem a privacidade.

## Passo 3 — Pegar as chaves
1. No Supabase: **Project Settings → API**.
2. Copie **Project URL** e a chave **anon public**.
3. Na raiz do projeto, copie `.env.example` para `.env` e preencha:
   ```
   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-anon-public-key
   ```
   (A chave `anon` é pública por design — a segurança vem das políticas de RLS.)

## Passo 4 — (Opcional) Confirmação de email
Para testar rápido: **Authentication → Providers → Email** e desligue
"Confirm email" enquanto desenvolve. Em produção, deixe ligado e configure o
**Site URL** (Passo 6) para os links de confirmação funcionarem.

## Passo 5 — Rodar localmente
```bash
npm install
npm run dev
```
Abra o endereço que aparecer (ex.: http://localhost:5173).

## Passo 6 — Publicar (Vercel)
1. Suba este projeto para um repositório no GitHub.
2. Em https://vercel.com, **Add New → Project** e importe o repositório.
3. Em **Environment Variables**, adicione `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY` (os mesmos valores do `.env`).
4. Deploy. (Build: `npm run build`, saída: `dist` — já configurado em `vercel.json`.)
5. Volte ao Supabase em **Authentication → URL Configuration** e coloque a URL
   publicada em **Site URL** (e em Redirect URLs, se usar confirmação por email).

Alternativa por CLI:
```bash
npm i -g vercel
vercel        # siga o assistente; configure as env vars quando pedir
vercel --prod
```
Netlify funciona igual: build `npm run build`, publish `dist`, mesmas env vars.

---

## Como usar (fluxo)
1. **Treinador:** cria a conta → na tela inicial clica em **"Ativar modo treinador"**.
2. **Atleta:** cria a própria conta → vê a tela "aguardando vínculo" e **compartilha
   o email** com o treinador.
3. **Treinador:** em "Vincular atleta", informa o email do atleta → pronto.
4. Treinador sobe treinos por atleta; o atleta vê só os seus no calendário, abre o
   detalhe (com as observações do treinador), marca como feitos e registra o RPE; a
   visão geral, os relatórios e a sequência se atualizam sozinhos.
5. Fim do mês: o atleta usa a aba **Exportar** e entrega o JSON ao treinador / Claude
   para recalibrar o plano pela performance real (ver seções abaixo).

A privacidade é garantida no banco: as políticas de RLS só deixam cada atleta ler os
próprios treinos, e cada treinador ver os dos seus atletas.

---

## Gerar o plano com o Claude (treinador)
Ao gerenciar um atleta, o treinador tem o card **"Gerar plano com o Claude"**, que
**prepara os dados reais do atleta** (perfil, prova, semanas até a prova, volume e
**melhores ritmos por modalidade** estimados a partir do que o atleta importou do Strava)
e monta um **briefing** pronto para a skill `triathlon-coach`:
- escolha a base de análise (4/8/12 semanas ou tudo);
- **"Copiar briefing p/ o Claude"** → cole numa conversa com o Claude → ele roda a skill
  e devolve um **CSV** no formato exato do TRIBASE;
- traga esse CSV de volta pelo card **"Importar plano em lote"** logo abaixo.

Fluxo (sem backend/IA no app — assistido pelo Claude): *atleta importa Strava →
treinador copia o briefing → Claude gera o plano (CSV) → treinador importa em lote*.
O briefing instrui o Claude a responder **só com o CSV**, então é só colar e importar.

## Importar plano em lote (treinador)
Ao gerenciar um atleta, o treinador tem o card **"Importar plano em lote"**: cole ou
suba o plano gerado pelo Claude (skill `triathlon-coach`) e crie **todos os treinos de
uma vez**, com prévia antes de salvar. Aceita:
- **CSV** com cabeçalho — colunas: `date, discipline, type, duration_min, distance, dist_unit, target, notes`
  (datas em ISO ou `DD/MM/AAAA`; duração em minutos ou `h:mm`). Há um botão **"baixar modelo CSV"**.
- **JSON** — array de objetos com chaves em PT (`data, modalidade, sessao, duracao, distancia, alvo, notas`) ou EN.

Isso fecha o ciclo com o Claude: **gerar/recalibrar o plano → colar no app (lote) →
atleta treina e importa → atleta exporta a performance → recalibrar** (ver seções abaixo).

## Importar treinos do Strava/Garmin (grátis, sem API paga)
O atleta tem uma aba **Importar**:
- **Strava:** Configurações → Minha conta → "Baixar ou excluir sua conta" → solicitar arquivo
  (Bulk Export). No zip recebido, use o `activities.csv`.
- **Garmin:** exporte atividades como `.gpx` ou `.tcx`.

O app lê o arquivo, mostra uma **prévia** e o atleta seleciona o que importar. Cada
atividade é **reconciliada com o plano**: se casar com um treino **planejado** (mesma
modalidade, data ±1 dia), ela **vincula** a esse treino — marca como concluído, mantém a
prescrição (tipo, alvo, observações do treinador) e preenche os **dados reais**
(duração, distância, FC…), **sem duplicar no calendário**. O que não casa entra como
treino novo (extra). A prévia mostra em cada linha se vai *vincular* ou entrar como *novo*.
Isso usa só o export pessoal (grátis) — não depende da API paga do Strava.

**O parser entende exports em português e inglês** — datas como `1 de ago. de 2024`
(Strava PT), `Aug 1, 2024` (Strava EN), `01/08/2024` (Garmin/BR) e ISO. Além de
data/modalidade/duração/distância, ele captura **métricas de performance** quando o
arquivo traz: FC média/máx, ganho de elevação, calorias e potência (CSV); o `.tcx`/`.gpx`
também extrai FC dos trackpoints. Essas métricas alimentam a recalibração mensal (abaixo).

> Se você já rodou o `schema.sql` antes desta versão, **rode-o novamente** (ele é
> idempotente). Ele cria as políticas de import do atleta **e** as colunas de métrica
> (`source`, `avg_hr`, `max_hr`, `elevation_m`, `calories`, `avg_power`) via `ALTER ... IF NOT EXISTS`.

## Exportar para recalibrar o plano todo mês
O atleta tem uma aba **Exportar** que gera um pacote com a **performance real** do
período (4/8/12 semanas ou tudo), incluindo os treinos importados do Strava/Garmin:
- **JSON** estruturado (resumo + cada treino com pace calculado, FC, elevação, potência, RPE);
- **CSV** equivalente em planilha;
- **Copiar resumo** — texto pronto pra colar numa conversa.

O ciclo mensal fica: o atleta treina e importa → no fim do mês exporta o JSON →
entrega ao treinador (ou cola para o Claude / skill `triathlon-coach`) → o plano é
**recalibrado pela performance** → o treinador sobe os treinos novos. O *pace* é
calculado por modalidade (min/km na corrida, km/h no pedal, min/100m na natação).

## Instalar no celular (PWA)
O app é um **PWA**: dá para instalar na tela inicial do celular e abrir em tela cheia,
com ícone próprio e funcionamento offline básico (cache do service worker).
- **Android/Chrome:** menu → "Adicionar à tela inicial" / "Instalar app".
- **iPhone/Safari:** Compartilhar → "Adicionar à Tela de Início".

A instalação só funciona **em produção, sob HTTPS** (o service worker não roda no
`npm run dev`). Para testar localmente: `npm run build && npm run preview`. Arquivos
do PWA: `public/manifest.webmanifest`, `public/sw.js` e os ícones `public/icon-*.png`.
O layout é responsivo — no celular o calendário vira uma **agenda vertical** (dia a dia).

## Modo demo (login desativado)
Há uma flag no topo de `src/App.jsx`:
```js
export const DEMO = true;  // abre direto como atleta, com dados de exemplo em memória
```
Com `DEMO = true` o app abre **sem login e sem Supabase**, útil para navegar/testar a
interface. Há um **alternador de papel** flutuante (Atleta / Treinador) para explorar
os dois lados com dados de exemplo (3 atletas, um deles "precisando de atenção"). Para
ligar o backend real, troque para `false` e configure o `.env`. A autenticação real
continua intacta no código (apenas desviada pela flag).

## Notas de segurança / endurecimento
- A política `profiles_update_own` permite o usuário atualizar o próprio perfil.
  Para um MVP está ok; se quiser impedir que um atleta altere o próprio `role` ou
  `coach_id`, troque por uma função `security definer` que atualize apenas campos
  específicos.
- Mantenha a `service_role key` **fora** do front-end (ela não é usada aqui).
- Configure o **Site URL** correto em produção para evitar problemas de auth.

## Próximo passo (Strava)
Para puxar treinos automaticamente, dá para adicionar a integração do Strava
(OAuth) numa função de borda do Supabase (Edge Function) que importa as atividades
e preenche a tabela `workouts`. Posso te ajudar com isso quando quiser.
