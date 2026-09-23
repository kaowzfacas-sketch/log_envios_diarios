import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { isSupabaseConfigured, supabase } from './supabase'
import './styles.css'

const dateOnly = new Date().toISOString().slice(0, 10)
const formatDate = (value) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: value?.includes('T') ? 'short' : undefined }).format(new Date(value))

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  async function submit(event) {
    event.preventDefault()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setMessage(error ? error.message : '')
  }
  return <main className="login"><section className="card"><p className="eyebrow">KAOWZ</p><h1>Rastreio de postagem</h1><p>Entre com sua conta da equipe para consultar os envios.</p><form onSubmit={submit}><label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label><button>Entrar</button></form>{message && <p className="error">{message}</p>}</section></main>
}

function Orders({ title, orders, tone }) {
  return <section className={`card orders ${tone || ''}`}><h2>{title} <span>{orders.length}</span></h2>{orders.length === 0 ? <p className="muted">Nenhum pedido nesta lista.</p> : <ul>{orders.map((order) => <li key={order.codigo_rastreamento}><strong>{order.nome_cliente}</strong><code>{order.codigo_rastreamento}</code><small>{tone === 'alert' ? `Detectado em ${formatDate(order.data_primeira_deteccao)}` : `Confirmado em ${formatDate(order.data_confirmacao)}`}</small></li>)}</ul>}</section>
}

function Dashboard({ session }) {
  const [confirmed, setConfirmed] = useState([]); const [pending, setPending] = useState([]); const [runs, setRuns] = useState([]); const [error, setError] = useState(''); const [copied, setCopied] = useState(false)
  async function load() {
    const [confirmedResult, pendingResult, runResult] = await Promise.all([
      supabase.from('pedidos_confirmados').select('*').eq('data_confirmacao', dateOnly).order('nome_cliente'),
      supabase.from('pedidos_pendentes').select('*').order('data_primeira_deteccao'),
      supabase.from('log_execucoes').select('*').order('executado_em', { ascending: false }).limit(10),
    ])
    const firstError = confirmedResult.error || pendingResult.error || runResult.error
    if (firstError) setError(firstError.message)
    else { setConfirmed(confirmedResult.data); setPending(pendingResult.data); setRuns(runResult.data) }
  }
  useEffect(() => { load() }, [])
  const alerts = useMemo(() => pending.filter((order) => Math.floor((Date.now() - new Date(`${order.data_primeira_deteccao}T00:00:00`).getTime()) / 86400000) >= 3), [pending])
  const text = useMemo(() => ['*POSTADOS HOJE*', ...(confirmed.length ? confirmed.map((o) => `• ${o.nome_cliente} — ${o.codigo_rastreamento}`) : ['Nenhum pedido confirmado hoje.']), '', '*ALERTA — PENDÊNCIAS 3+ DIAS*', ...(alerts.length ? alerts.map((o) => `• ${o.nome_cliente} — ${o.codigo_rastreamento}`) : ['Nenhuma pendência antiga.'])].join('\n'), [confirmed, alerts])
  async function copy() { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return <main className="app"><header><div><p className="eyebrow">KAOWZ · OPERAÇÃO</p><h1>Rastreio de postagem</h1></div><div><button className="secondary" onClick={load}>Atualizar</button><button className="secondary" onClick={() => supabase.auth.signOut()}>Sair</button></div></header>{error && <p className="error">Erro ao carregar: {error}</p>}<section className="toolbar"><div><h2>Resumo de hoje</h2><p>Use o texto abaixo para copiar no WhatsApp. Nenhuma mensagem é enviada automaticamente.</p></div><button onClick={copy}>{copied ? 'Copiado!' : 'Gerar texto do dia'}</button></section><textarea aria-label="Texto do dia" readOnly value={text} /> <div className="grid"><Orders title="Postados hoje" orders={confirmed} /><Orders title="Pendentes" orders={pending} /><Orders title="Alerta (3+ dias)" orders={alerts} tone="alert" /></div><section className="card history"><h2>Últimas execuções</h2>{runs.length === 0 ? <p className="muted">Ainda não há execuções registradas.</p> : <table><thead><tr><th>Quando</th><th>Confirmados</th><th>Pendentes</th><th>Alertas</th><th>Status</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{formatDate(run.executado_em)}</td><td>{run.confirmados}</td><td>{run.pendentes}</td><td>{run.alertas}</td><td>{run.erros ? <span className="error">{run.erros}</span> : 'OK'}</td></tr>)}</tbody></table>}</section></main>
}

function App() { const [session, setSession] = useState(null); useEffect(() => { if (!supabase) return; supabase.auth.getSession().then(({ data }) => setSession(data.session)); return supabase.auth.onAuthStateChange((_event, next) => setSession(next)).data.subscription.unsubscribe }, []); if (!isSupabaseConfigured) return <main className="login"><section className="card"><h1>Configuração necessária</h1><p>Defina as variáveis públicas do Supabase antes de publicar este site.</p></section></main>; return session ? <Dashboard session={session} /> : <Login /> }

createRoot(document.getElementById('root')).render(<App />)
