# Kaowz — rastreio de postagem

Sistema interno estático para consultar postagens e pendências. O browser acessa apenas o Supabase com a **anon key**; a consulta a Bling e Correios roda exclusivamente no GitHub Actions com secrets. GitHub Pages não torna o app privado: o login do Supabase Auth e as políticas RLS são obrigatórios.

## Decisão do agendamento

Foi escolhido **GitHub Actions agendado**. É a alternativa mais simples aqui: o código do job, o histórico de execução e os secrets ficam no mesmo repositório, sem configurar Edge Function, `pg_cron` e uma integração adicional no Supabase. A contrapartida é que `schedule` do GitHub não é um relógio de precisão (pode atrasar em horários concorridos) e jobs agendados podem ser desativados em repositórios inativos. Para uma operação que exija horário rigoroso e monitoramento centralizado no banco, a alternativa seria Supabase `pg_cron` chamando uma Edge Function; ela reduz essa dependência do GitHub, mas aumenta a superfície de deploy e de secrets no Supabase.

## Estrutura

```
src/                         # React/Vite, publicado no GitHub Pages
jobs/daily.mjs               # job server-side: Bling → Correios → Supabase
supabase/migrations/         # schema e RLS
.github/workflows/daily-job.yml
.github/workflows/deploy-pages.yml
```

## Deploy inicial

1. Crie um projeto no Supabase e aplique `supabase/migrations/20260923000000_initial_schema.sql` pelo SQL Editor ou Supabase CLI.
2. Em **Authentication > Providers**, habilite e-mail/senha. Em **Users**, crie/convide somente as 3–4 pessoas da equipe. Mantenha confirmação de e-mail conforme sua política interna.
3. Em **GitHub > Settings > Secrets and variables > Actions**, cadastre os **secrets** abaixo. Nunca cadastre qualquer um deles no frontend.
4. Na mesma página, em **Variables**, cadastre as duas variáveis públicas do frontend. Elas serão embutidas no bundle, portanto somente URL e anon key podem ficar aqui.
5. Abra **Settings > Pages** do repositório e, em **Build and deployment**, escolha **GitHub Actions**. É necessário salvar essa configuração antes da primeira execução do workflow; ela cria/habilita o site do GitHub Pages para o repositório.
6. Faça push na branch `main` (ou execute **Publicar frontend no GitHub Pages** manualmente) e aguarde todas as etapas concluírem.
7. Após o deploy, acesse `https://kaowzfacas-sketch.github.io/log_envios_diarios/`.
8. Rode manualmente o workflow **Consulta diária de rastreio** uma vez para validar as credenciais e criar o primeiro log.

> O `base` do Vite contém `/log_envios_diarios/`. Se o nome do repositório mudar, altere `vite.config.js` antes do deploy.

### Erro `Creating Pages deployment failed` com status `404`

Esse erro acontece antes de o site ser publicado: o build e o artefato podem ter sido gerados corretamente, mas o GitHub ainda não habilitou o Pages para o repositório. Abra [Settings > Pages](https://github.com/kaowzfacas-sketch/log_envios_diarios/settings/pages), selecione **GitHub Actions** em **Build and deployment**, salve e reexecute o workflow **Publicar frontend no GitHub Pages**. Não é um erro do React nem das variáveis do Supabase.

## GitHub Actions secrets (job diário)

| Nome | Uso |
| --- | --- |
| `SUPABASE_URL` | URL do projeto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Acesso administrativo do job; nunca expor ao navegador. |
| `BLING_CLIENT_ID` | OAuth2 do Bling. |
| `BLING_CLIENT_SECRET` | OAuth2 do Bling. |
| `BLING_REFRESH_TOKEN` | Token usado para renovar o access token do Bling. |
| `CORREIOS_USUARIO` | Usuário da API Correios. |
| `CORREIOS_CHAVE_ACESSO_DELEGADA` | Chave delegada — não use o código mestre. |
| `CORREIOS_CARTAO_POSTAGEM` | Número do cartão de postagem. |

### Erro `invalid_grant` do Bling

O erro `Invalid refresh token` no workflow não é causado pelo runner, pelo Node.js nem pelos Correios: o valor salvo em `BLING_REFRESH_TOKEN` foi recusado pelo OAuth do Bling. Ele não pode ser corrigido pelo código do job, pois o GitHub Actions recebe os secrets somente para leitura.

Para recuperar a execução, autorize novamente **o mesmo aplicativo OAuth do Bling** e obtenha um novo refresh token. Em seguida, abra **Settings > Secrets and variables > Actions > Secrets** no repositório, edite `BLING_REFRESH_TOKEN`, cole o novo valor sem aspas nem espaços e execute **Consulta diária de rastreio** manualmente. Não altere `BLING_CLIENT_ID` nem `BLING_CLIENT_SECRET` ao menos que também tenha recriado o aplicativo; o refresh token precisa pertencer a esse par de credenciais.

O job agora identifica esse caso explicitamente e encerra sem consultar ou alterar pedidos. O valor do token nunca é mostrado no log.

## GitHub Actions variables (build público)

| Nome | Uso |
| --- | --- |
| `VITE_SUPABASE_URL` | URL pública do projeto. |
| `VITE_SUPABASE_ANON_KEY` | Chave anon pública. As políticas RLS restringem os dados a usuários autenticados. |

Para desenvolvimento local, copie `.env.example` para `.env` e preencha somente essas duas variáveis. Rode `npm install` e `npm run dev`.

Se a página exibir `Invalid supabaseUrl`, confira o valor de `VITE_SUPABASE_URL` em **Settings > Secrets and variables > Actions > Variables**. Ele deve ser a URL completa do projeto, começando com `https://` (por exemplo, `https://abc123.supabase.co`), sem aspas, espaços ou o placeholder `SEU-PROJETO`. O frontend agora mostra a tela de configuração, em vez de falhar ao iniciar, quando a URL não for HTTP(S).

## Operação e segurança

O job busca pedidos alterados nos últimos três dias, insere rastreios novos como pendentes, consulta todos os pendentes nos Correios em grupos de no máximo 50 e move os objetos com evento `PO` para confirmados. Cada tentativa (inclusive com erro) é gravada em `log_execucoes`.

RLS permite somente `select` para o papel `authenticated`; não existe política de escrita para usuários do site. A `service_role` usada pelo workflow ignora RLS e não deve sair dos GitHub Secrets. O botão de resumo somente monta e copia o texto localmente: ele não chama APIs externas nem envia WhatsApp.

## Verificação

```bash
npm install
npm run build
```
