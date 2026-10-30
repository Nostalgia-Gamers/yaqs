// Automatic updates from GitHub Releases: checked at startup and every few
// hours (YAQS tends to stay open on a second screen), installed without asking.
import { invoke } from '@tauri-apps/api/core'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { toast } from './alerts'
import { t } from './i18n'

const EVERY = 6 * 60 * 60 * 1000

let busy = false

async function run() {
  if (busy) return
  busy = true
  try {
    // A portable copy can't run the installer; it swaps its own exe instead.
    if (await invoke<boolean>('is_portable')) {
      const version = await invoke<string | null>('portable_update_check')
      if (!version) return
      toast(t('up.installing', version), t('up.restart'))
      await invoke('portable_update_install') // exits and restarts YAQS
      return
    }

    const update = await check()
    if (!update) return
    toast(t('up.installing', update.version), t('up.restart'))
    await update.downloadAndInstall() // on Windows the installer closes YAQS itself
    await relaunch()
  } catch (e) {
    console.warn('update check failed', e) // offline or GitHub down: try again later
  } finally {
    busy = false
  }
}

export function startUpdater() {
  if (import.meta.env.DEV) return
  setTimeout(run, 3000) // let the window settle first
  setInterval(run, EVERY)
}
