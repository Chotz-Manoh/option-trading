// Vercel serverless function: forwards the app's broker calls (Zerodha Kite, Upstox, Dhan, GitHub) so the
// hosted web version is not blocked by browser CORS — the same job desktop/main.go does on Windows.
// Only https requests to the allow-listed hosts, only from this site's own pages (Origin must match).
// Keys and tokens travel in the request and are never stored here.
const HOSTS = new Set(['api.kite.trade', 'kite.zerodha.com', 'api.upstox.com', 'api-hft.upstox.com', 'api.dhan.co', 'api.github.com'])
const DROP = new Set(['host', 'content-length', 'accept-encoding', 'connection', 'cookie', 'origin', 'referer', 'transfer-encoding'])

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const origin = String(req.headers.origin || '')
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
  let originHost = ''
  try { originHost = new URL(origin).host } catch { /* no origin */ }
  if (!originHost || originHost !== host) return res.status(403).json({ error: 'forbidden' })

  const body = typeof req.body === 'string' ? safeJSON(req.body) : req.body
  if (!body || typeof body.url !== 'string') return res.status(400).json({ error: 'bad request' })
  let u
  try { u = new URL(body.url) } catch { return res.status(400).json({ error: 'bad url' }) }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname.toLowerCase()) || u.port || u.username || u.password) return res.status(403).json({ error: 'host not allowed' })
  const method = String(body.method || 'GET').toUpperCase()
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return res.status(405).json({ error: 'method not allowed' })

  const headers = {}
  for (const [k, v] of Object.entries(body.headers || {})) {
    if (typeof v === 'string' && !DROP.has(k.toLowerCase())) headers[k] = v
  }
  headers['User-Agent'] = 'OptionPulse-web'
  try {
    const r = await fetch(u.toString(), { method, headers, body: method === 'GET' ? undefined : (body.body || undefined), redirect: 'manual' })
    const text = await r.text()
    return res.status(200).json({ status: r.status, body: text })
  } catch (e) {
    return res.status(502).json({ error: String(e && e.message ? e.message : e) })
  }
}

function safeJSON(s) { try { return JSON.parse(s) } catch { return undefined } }
