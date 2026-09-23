-- Dados operacionais: o navegador usa somente a anon key; o job usa a service_role key.
create table public.pedidos_confirmados (
  pedido_bling_id bigint primary key,
  nome_cliente text not null,
  codigo_rastreamento text not null unique,
  data_confirmacao date not null,
  confirmado_em timestamptz not null default now()
);

create table public.pedidos_pendentes (
  pedido_bling_id bigint primary key,
  nome_cliente text not null,
  codigo_rastreamento text not null unique,
  data_primeira_deteccao date not null default current_date,
  criado_em timestamptz not null default now()
);

create table public.log_execucoes (
  id bigint generated always as identity primary key,
  executado_em timestamptz not null default now(),
  confirmados integer not null default 0 check (confirmados >= 0),
  pendentes integer not null default 0 check (pendentes >= 0),
  alertas integer not null default 0 check (alertas >= 0),
  erros text
);

create index pedidos_confirmados_data_confirmacao_idx on public.pedidos_confirmados (data_confirmacao desc);
create index pedidos_pendentes_data_primeira_deteccao_idx on public.pedidos_pendentes (data_primeira_deteccao);

alter table public.pedidos_confirmados enable row level security;
alter table public.pedidos_pendentes enable row level security;
alter table public.log_execucoes enable row level security;

-- Não crie políticas de INSERT/UPDATE/DELETE para authenticated: alterações vêm apenas do job.
create policy "Equipe autenticada le confirmados" on public.pedidos_confirmados for select to authenticated using (true);
create policy "Equipe autenticada le pendentes" on public.pedidos_pendentes for select to authenticated using (true);
create policy "Equipe autenticada le logs" on public.log_execucoes for select to authenticated using (true);
