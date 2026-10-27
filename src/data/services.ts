// Notifications and app updates for each platform.
import { registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { APP_VERSION, BUILD_UPDATE_REPO, desktopCall, httpJSON, nativeShell, openExternal, platform, shellCall } from './platform'
import { arr, obj } from './provider'

// ---------- Notifications ----------

export async function requestNotifications(): Promise<boolean> {
  try {
    if (nativeShell) { nativeShell.requestNotificationPermission(); return true }
    if (platform === 'android') return (await LocalNotifications.requestPermissions()).display === 'granted'
    if ('Notification' in window) return (await Notification.requestPermission()) === 'granted'
  } catch { /* unsupported */ }
  return false
}

export async function notify(title: string, body: string) {
  try {
    if (nativeShell) nativeShell.notifyUser(title, body)
    else if (platform === 'android') {
      await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Date.now() % 2_000_000_000), title, body }] })
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  } catch { /* ignore */ }
}

// ---------- Updates (GitHub Releases) ----------

/** Native helper in the Android app (android/app/src/main/java/.../AppUpdaterPlugin.java). */
const AppUpdater = registerPlugin<{ install(o: { url: string }): Promise<{ started: boolean }> }>('AppUpdater')

export interface UpdateInfo {
  version: string
  notes: string
  pageUrl: string
  exeUrl?: string
  apkUrl?: string
}

export const currentVersion = APP_VERSION

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/** Updates only ever come from the repository this copy was built from (set by the release workflow). */
export const updateRepo = BUILD_UPDATE_REPO.trim()

/** Returns the newer release, or null when up to date. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const repo = updateRepo
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('This copy was built without an update source. Install it once from your GitHub Releases — later versions then update in one click.')
  const j = obj(await httpJSON({ url: `https://api.github.com/repos/${repo}/releases/latest`, headers: { Accept: 'application/vnd.github+json' } }))
  const tag = String(j.tag_name ?? '')
  if (!tag || compareVersions(tag, APP_VERSION) <= 0) return null
  const assets = arr(j.assets).map(obj)
  const find = (re: RegExp) => assets.find((a) => re.test(String(a.name ?? '')))?.browser_download_url as string | undefined
  return {
    version: tag.replace(/^v/i, ''),
    notes: String(j.body ?? '').slice(0, 600),
    pageUrl: String(j.html_url ?? `https://github.com/${repo}/releases`),
    exeUrl: find(/\.exe$/i),
    apkUrl: find(/\.apk$/i),
  }
}

/** Desktop: wait for the restarted launcher to report the new version, then reload the window. */
async function reloadWhenVersion(v: string) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const info = await desktopCall<{ version?: string }>('/api/info')
      if (info.version && compareVersions(info.version, v) >= 0) { location.reload(); return }
    } catch { /* restarting */ }
  }
}

/** One-click update: Windows swaps the exe and restarts; Android downloads the new APK to install. */
export async function installUpdate(u: UpdateInfo): Promise<string> {
  if (platform === 'remote') return `Open OptionPulse on your Windows PC and click Update there — this phone runs the PC's copy, so it gets ${u.version} at the same time.`
  if (platform === 'desktop' && u.exeUrl) {
    // The launcher looks up the release itself (pinned repository + SHA-256 check); we only ask it to start.
    await desktopCall('/api/update', {})
    void reloadWhenVersion(u.version)
    return `Installing ${u.version} — OptionPulse restarts by itself in a few seconds.`
  }
  if (nativeShell && u.apkUrl) {
    const shell = nativeShell, url = u.apkUrl
    const r = await shellCall((id) => shell.installApk(id, url), 10 * 60_000)
    if (!r.error) return 'Downloaded — tap Update on the Android screen to finish.'
    if (r.error.startsWith('PERMISSION')) return 'Turn on “Allow from this source” for OptionPulse, come back, then tap Update again.'
    openExternal(u.apkUrl)
    return 'Downloading the update in your browser — open it when done and tap Install.'
  }
  if (platform === 'android' && u.apkUrl) {
    try {
      await AppUpdater.install({ url: u.apkUrl })
      return 'Downloaded — tap Update on the Android screen to finish.'
    } catch (e) {
      const err = e as { code?: string; message?: string }
      if (err.code === 'PERMISSION') return err.message ?? 'Allow OptionPulse to install updates, then tap Update again.'
      openExternal(u.apkUrl)
      return 'Downloading the update in your browser — open it when done and tap Install.'
    }
  }
  openExternal(u.pageUrl)
  return 'Opened the download page.'
}
