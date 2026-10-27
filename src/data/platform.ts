// Platform bridge: one HTTP function and one storage API for Windows, Android and the web.
import { Capacitor, CapacitorHttp } from '@capacitor/core'

/** 'remote' = a phone (iPhone, Android, iPad) opening the app served by the Windows launcher over Wi-Fi. */
export type Platform = 'android' | 'desktop' | 'remote' | 'web'

export const DESKTOP_PORT = 47811
/** The launcher's phone-access port (see desktop/phone.go). */
export const PHONE_PORT = 47812

/** A paired phone's own token, carried in its app address: http://<pc-ip>:47812/p/<token>/ */
export const phoneToken: string | undefined =
  typeof location !== 'undefined' ? /^\/p\/([A-Za-z0-9_-]{16,64})\//.exec(location.pathname)?.[1] : undefined

/** Bridge exposed by the lightweight native Android app (android-native/), when running inside it. */
export interface NativeShell {
  request(id: string, json: string): void
  notifyUser(title: string, body: string): void
  requestNotificationPermission(): void
  installApk(id: string, url: string): void
  openExternal(url: string): void
  exitApp(): void
  copyText?(text: string): void
}
export const nativeShell: NativeShell | undefined =
  typeof window !== 'undefined' ? (window as unknown as { OptionPulseNative?: NativeShell }).OptionPulseNative : undefined

interface NativeResult { status: number; text: string; error: string | null }
const pendingNative = new Map<string, (r: NativeResult) => void>()
if (nativeShell) {
  ;(window as unknown as { __opNative: unknown }).__opNative = {
    resolve(id: string, status: number, text: string, error: string | null) {
      const f = pendingNative.get(id)
      pendingNative.delete(id)
      f?.({ status, text, error })
    },
  }
}

/** Calls an asynchronous native method; the Android side answers through window.__opNative.resolve. */
export function shellCall(start: (id: string) => void, timeoutMs = 120_000): Promise<NativeResult> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    pendingNative.set(id, resolve)
    setTimeout(() => { if (pendingNative.delete(id)) resolve({ status: 0, text: '', error: 'timed out' }) }, timeoutMs)
    try { start(id) } catch (e) { pendingNative.delete(id); resolve({ status: 0, text: '', error: String(e) }) }
  })
}

export const platform: Platform = Capacitor.isNativePlatform() || nativeShell
  ? 'android'
  : phoneToken
    ? 'remote'
    : location.hostname === '127.0.0.1' && location.port === String(DESKTOP_PORT)
      ? 'desktop'
      : 'web'

/** True when the app talks to the Windows launcher (its own window, or a phone it serves). */
export const viaLauncher = platform === 'desktop' || platform === 'remote'
/** Hosted web version (e.g. on Vercel): the site's own /api/proxy forwards broker calls. */
export const hosted = platform === 'web' && typeof location !== 'undefined' && location.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(location.hostname)
/** Where broker logins return to on this platform (Windows/Android use the launcher's address; the web version uses its own). */
export const callbackBase = platform === 'web' && typeof location !== 'undefined' ? location.origin : `http://127.0.0.1:${DESKTOP_PORT}`
export const isIOS = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
/** Opened from the iPhone/Android home screen (standalone web app) rather than inside the browser. */
export const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true)

/** Headers for a request to the launcher: JSON, plus the phone's token when served to a phone. */
export function launcherHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (phoneToken) h['X-OP-Phone'] = phoneToken
  return h
}

export const APP_VERSION: string = __APP_VERSION__
export const BUILD_UPDATE_REPO: string = __UPDATE_REPO__

export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: string
}

export interface HttpResponse {
  status: number
  text: string
}

export class HttpError extends Error {
  status: number
  body: string
  constructor(status: number, body: string) {
    super(`HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

/** Whether the hosted site has its /api/proxy (decided on the first call). */
let webProxy: 'unknown' | 'yes' | 'no' = platform === 'web' ? 'unknown' : 'no'
export const hasWebProxy = () => webProxy === 'yes'

/**
 * Sends a request the way each platform allows:
 * - Windows, and phones served by the Windows app: through the OptionPulse launcher (no browser CORS limits),
 * - Android: through Capacitor's native HTTP client,
 * - Web: plain fetch (brokers usually block this — demo data still works).
 */
export async function http(req: HttpRequest): Promise<HttpResponse> {
  const method = req.method ?? 'GET'
  if (viaLauncher) {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: launcherHeaders(),
      body: JSON.stringify({ url: req.url, method, headers: req.headers ?? {}, body: req.body ?? '' }),
    })
    if (!res.ok) throw new HttpError(res.status, await res.text())
    const j = (await res.json()) as { status: number; body: string }
    return { status: j.status, text: j.body }
  }
  if (nativeShell) {
    const shell = nativeShell
    const r = await shellCall((id) => shell.request(id, JSON.stringify({ url: req.url, method, headers: req.headers ?? {}, body: req.body ?? '' })))
    if (r.error) throw new Error(r.error)
    return { status: r.status, text: r.text }
  }
  if (platform === 'android') {
    const res = await CapacitorHttp.request({
      url: req.url,
      method,
      headers: req.headers ?? {},
      data: req.body,
      responseType: 'text',
    })
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    return { status: res.status, text }
  }
  // Web: the site's own proxy (Vercel serverless function) when it exists; otherwise a plain fetch
  // (brokers usually block that with CORS — the app then tells the user to use the Windows/Android app or the hosted site).
  if (webProxy !== 'no') {
    try {
      const res = await fetch('/api/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: req.url, method, headers: req.headers ?? {}, body: req.body ?? '' }) })
      if (res.status === 404 || res.status === 405) webProxy = 'no'
      else {
        webProxy = 'yes'
        if (!res.ok) throw new HttpError(res.status, await res.text())
        const j = (await res.json()) as { status: number; body: string }
        return { status: j.status, text: j.body }
      }
    } catch (e) {
      if (webProxy === 'yes') throw e
      webProxy = 'no'
    }
  }
  const res = await fetch(req.url, { method, headers: req.headers, body: method === 'GET' ? undefined : req.body })
  return { status: res.status, text: await res.text() }
}


/** http() + JSON parse + non-2xx → HttpError */
export async function httpJSON<T = unknown>(req: HttpRequest): Promise<T> {
  const res = await http(req)
  if (res.status < 200 || res.status >= 300) throw new HttpError(res.status, res.text)
  try {
    return JSON.parse(res.text) as T
  } catch {
    throw new Error('Could not read the server response.')
  }
}

// ---------- Storage ----------

/** Keys shared between the PC window and paired phones (see sessionSync.ts). */
export const SHARED_KEYS = ['settings', 'kite', 'upstox.creds'] as const
let sharedListener: ((key: string) => void) | undefined
export function onSharedChange(f: ((key: string) => void) | undefined) { sharedListener = f }
const noteChange = (key: string) => { if ((SHARED_KEYS as readonly string[]).includes(key)) sharedListener?.(key) }

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`op.${key}`)
      return raw == null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`op.${key}`, JSON.stringify(value))
    } catch {
      /* storage full or unavailable */
    }
    noteChange(key)
  },
  remove(key: string) {
    try {
      localStorage.removeItem(`op.${key}`)
    } catch {
      /* ignore */
    }
    noteChange(key)
  },
}

/** Opens a URL outside the app (system browser on Android, new window on desktop). */
export function openExternal(url: string) {
  if (nativeShell) nativeShell.openExternal(url)
  else window.open(url, platform === 'android' ? '_system' : '_blank')
}

/** Lets the launcher know this screen is still open (it exits a few minutes after the last one closes). */
export function pingLauncher(): Promise<'ok' | 'down' | 'unpaired'> {
  return fetch('/api/ping', { method: 'POST', headers: launcherHeaders(), body: '{}' })
    .then((r) => (r.ok ? 'ok' : r.status === 403 && phoneToken ? 'unpaired' : 'down')).catch(() => 'down' as const)
}

/** Copies text to the clipboard on every platform (native clipboard on Android, a fallback where the async API is blocked). */
export async function copyText(text: string): Promise<boolean> {
  if (nativeShell?.copyText) { nativeShell.copyText(text); return true }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** Launcher API (Windows window, or a phone served by it — phones must POST with their token). */
export async function desktopCall<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined && !phoneToken ? 'GET' : 'POST',
    headers: launcherHeaders(),
    body: body === undefined ? (phoneToken ? '{}' : undefined) : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as T
}
