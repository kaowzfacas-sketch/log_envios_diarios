import { createClient } from '@supabase/supabase-js'

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BLING_CLIENT_ID', 'BLING_CLIENT_SECRET', 'BLING_REFRESH_TOKEN', 'CORREIOS_USUARIO', 'CORREIOS_CHAVE_ACESSO_DELEGADA', 'CORREIOS_CARTAO_POSTAGEM']
for (const name of required) if (!process.env[name]) throw new Error(`Variável obrigatória ausente: ${name}`)

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const today = new Date().toISOString().slice(0, 10)
const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)

async function api(url, options = {}) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${url}: HTTP ${response.status} ${await response.text()}`)
  return response.json()
}
const basic = (username, password) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

class BlingRefreshTokenError extends Error {
  constructor(cause) {
    super('Não foi possível autenticar no Bling: o refresh token foi recusado. Gere um novo refresh token para este mesmo aplicativo e atualize o secret BLING_REFRESH_TOKEN no GitHub antes de executar o workflow novamente.')
    this.name = 'BlingRefreshTokenError'
    this.cause = cause
  }
}

async function blingToken() {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.BLING_REFRESH_TOKEN })
  let data
  try {
    data = await api('https://www.bling.com.br/Api/v3/oauth/token', { method: 'POST', headers: { Authorization: basic(process.env.BLING_CLIENT_ID, process.env.BLING_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  } catch (error) {
    if (error.message.includes('HTTP 400') && error.message.includes('invalid_grant')) throw new BlingRefreshTokenError(error)
    throw error
  }
  return data.access_token
}
async function correiosToken() {
  const data = await api('https://api.correios.com.br/token/v1/autentica/cartaopostagem', { method: 'POST', headers: { Authorization: basic(process.env.CORREIOS_USUARIO, process.env.CORREIOS_CHAVE_ACESSO_DELEGADA), 'Content-Type': 'application/json' }, body: JSON.stringify({ numero: process.env.CORREIOS_CARTAO_POSTAGEM }) })
  return data.token
}
async function blingOrders(token) {
  const url = new URL('https://api.bling.com.br/Api/v3/pedidos/vendas')
  url.search = new URLSearchParams({ dataAlteracaoInicial: threeDaysAgo, dataAlteracaoFinal: today, limite: '100' })
  const data = await api(url, { headers: { Authorization: `Bearer ${token}` } })
  return data.data || []
}
async function trackingFromOrder(token, id) {
  const data = await api(`https://api.bling.com.br/Api/v3/pedidos/vendas/${id}`, { headers: { Authorization: `Bearer ${token}` } })
  const order = data.data || data
  const code = order?.transporte?.volumes?.[0]?.codigoRastreamento
  return code?.trim() || null
}
async function fetchPostedCodes(token, codes) {
  const posted = new Set()
  if (codes.length === 0) return posted
  for (let index = 0; index < codes.length; index += 50) {
    const batch = codes.slice(index, index + 50)
    const data = await api(`https://api.correios.com.br/srorastro/v1/objetos/${encodeURIComponent(batch.join(','))}?resultado=T`, { headers: { Authorization: `Bearer ${token}` } })
    for (const object of data.objetos || []) if ((object.eventos || []).some((event) => event.codigo === 'PO')) posted.add(object.codObjeto || object.codigo)
  }
  return posted
}
async function logRun(values) { const { error } = await supabase.from('log_execucoes').insert(values); if (error) console.error('Não foi possível gravar o log:', error.message) }

async function run() {
  const [bling, correios] = await Promise.all([blingToken(), correiosToken()])
  const [orders, confirmedResult, pendingResult] = await Promise.all([
    blingOrders(bling),
    supabase.from('pedidos_confirmados').select('pedido_bling_id'),
    supabase.from('pedidos_pendentes').select('pedido_bling_id, codigo_rastreamento'),
  ])
  if (confirmedResult.error) throw confirmedResult.error
  if (pendingResult.error) throw pendingResult.error
  const known = new Set([...confirmedResult.data, ...pendingResult.data].map((row) => String(row.pedido_bling_id)))
  const discovered = []
  for (const order of orders) {
    const id = order.id
    if (!id || known.has(String(id))) continue
    const code = await trackingFromOrder(bling, id)
    if (code) discovered.push({ pedido_bling_id: id, nome_cliente: order.contato?.nome || order.cliente?.nome || 'Cliente não informado', codigo_rastreamento: code, data_primeira_deteccao: today })
  }
  if (discovered.length) { const { error } = await supabase.from('pedidos_pendentes').upsert(discovered, { onConflict: 'pedido_bling_id', ignoreDuplicates: true }); if (error) throw error }
  const { data: allPending, error: allPendingError } = await supabase.from('pedidos_pendentes').select('*')
  if (allPendingError) throw allPendingError
  const postedCodes = await fetchPostedCodes(correios, allPending.map((row) => row.codigo_rastreamento))
  const posted = allPending.filter((row) => postedCodes.has(row.codigo_rastreamento))
  if (posted.length) {
    const { error: insertError } = await supabase.from('pedidos_confirmados').upsert(posted.map(({ pedido_bling_id, nome_cliente, codigo_rastreamento }) => ({ pedido_bling_id, nome_cliente, codigo_rastreamento, data_confirmacao: today })))
    if (insertError) throw insertError
    const { error: deleteError } = await supabase.from('pedidos_pendentes').delete().in('pedido_bling_id', posted.map((row) => row.pedido_bling_id))
    if (deleteError) throw deleteError
  }
  const pending = allPending.length - posted.length
  const alerts = allPending.filter((row) => !postedCodes.has(row.codigo_rastreamento) && Math.floor((Date.now() - new Date(`${row.data_primeira_deteccao}T00:00:00Z`)) / 86400000) >= 3).length
  await logRun({ confirmados: posted.length, pendentes: pending, alertas: alerts })
  console.log(`Concluído: ${posted.length} confirmados, ${pending} pendentes, ${alerts} alertas.`)
}

run().catch(async (error) => { console.error(error); await logRun({ confirmados: 0, pendentes: 0, alertas: 0, erros: error.message }); process.exitCode = 1 })
