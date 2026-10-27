// Upstox one-tap login (OAuth 2 authorization code). Upstox's trading and market-data APIs are free for
// Upstox account holders, so this is the no-cost way to get real-time NSE & BSE prices, option chains,
// OI, IV and Greeks. Docs: https://upstox.com/developer/api-documentation/authentication
import { dayStart, dayString } from '../engine/market'
import { callbackBase, http, store } from './platform'
import { obj } from './provider'

/** The redirect URL to register for the Upstox app: the launcher's address on Windows/Android, the site's own address on the web. */
export const UPSTOX_REDIRECT = `${callbackBase}/upstox-callback`
const API = 'https://api.upstox.com'

export interface UpstoxCreds {
  apiKey: string
  apiSecret: string
  userName?: string
  /** When the current access token stops working (Upstox tokens end at 3:30 AM IST). */
  expiresAt?: number
}

export const upstoxCreds = (): UpstoxCreds => ({ apiKey: '', apiSecret: '', ...store.get<Partial<UpstoxCreds>>('upstox.creds', {}) })
export function saveUpstoxCreds(p: Partial<UpstoxCreds>) {
  store.set('upstox.creds', { ...upstoxCreds(), ...p })
}

/** Upstox access tokens expire at 3:30 AM IST on the day after they are issued (same day if issued before 3:30). */
export function upstoxTokenExpiry(issuedAt: number): number {
  const today330 = dayStart(dayString(issuedAt)) + 3.5 * 3600_000
  return issuedAt < today330 ? today330 : today330 + 86_400_000
}

export const upstoxTokenExpired = (now = Date.now()) => {
  const e = upstoxCreds().expiresAt
  return e !== undefined && now >= e
}

export function upstoxLoginURL(state: string): string {
  const { apiKey } = upstoxCreds()
  if (!apiKey) return ''
  const q = new URLSearchParams({ response_type: 'code', client_id: apiKey, redirect_uri: UPSTOX_REDIRECT, state })
  return `${API}/v2/login/authorization/dialog?${q.toString()}`
}

/** Exchanges the one-time authorization code for today's access token. Returns the token and the user's name. */
export async function upstoxExchangeCode(code: string): Promise<{ token: string; name: string; expiresAt: number }> {
  const { apiKey, apiSecret } = upstoxCreds()
  if (!apiKey || !apiSecret) throw new Error('Add your Upstox API key and secret first (Settings → Data source → Upstox).')
  const body = new URLSearchParams({ code, client_id: apiKey, client_secret: apiSecret, redirect_uri: UPSTOX_REDIRECT, grant_type: 'authorization_code' })
  const res = await http({
    url: `${API}/v2/login/authorization/token`, method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  let j: Record<string, unknown> = {}
  try { j = obj(JSON.parse(res.text)) } catch { /* not JSON */ }
  const token = typeof j.access_token === 'string' ? j.access_token : ''
  if (res.status !== 200 || !token) {
    const err = obj((Array.isArray(j.errors) ? j.errors[0] : undefined) ?? {})
    const why = String(err.message ?? j.message ?? `HTTP ${res.status}`)
    throw new Error(`Upstox login failed: ${why}. Check that the app's redirect URL is exactly ${UPSTOX_REDIRECT} and the API key/secret are right.`)
  }
  const name = String(j.user_name ?? j.user_id ?? 'Upstox user')
  const expiresAt = upstoxTokenExpiry(Date.now())
  saveUpstoxCreds({ userName: name, expiresAt })
  return { token, name, expiresAt }
}

export function upstoxLogoutLocal() {
  saveUpstoxCreds({ userName: undefined, expiresAt: undefined })
}
