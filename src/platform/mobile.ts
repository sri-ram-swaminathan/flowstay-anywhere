// Android / iOS app (Tauri mobile): same UI as the web app, but with native clipboard,
// notifications and model storage that the OS doesn't evict.
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Platform } from './index';
import { nativeModelStore } from './tauri';
import { webPlatform } from './web';
import { toast } from '../ui/toast';

export function mobilePlatform(kind: 'android' | 'ios'): Platform {
  const web = webPlatform();
  const copy = async (text: string) => {
    try { await writeText(text); return true; } catch { return web.copy(text); }
  };
  return {
    ...web,
    kind,
    isStandalone: true,
    modelStore: nativeModelStore(),
    copy,
    async deliver(text, o) {
      if (o.autoCopy && (await copy(text))) return 'copied';
      return 'none';
    },
    async notify(title, body) {
      if (document.visibilityState === 'visible') return toast(`${title}: ${body}`);
      try {
        let ok = await isPermissionGranted();
        if (!ok) ok = (await requestPermission()) === 'granted';
        if (ok) sendNotification({ title, body });
      } catch {}
    },
    openUrl: (url) => { openUrl(url).catch(() => {}); },
    async oauthBegin() {
      throw new Error('On the phone app, paste an OpenRouter API key instead (openrouter.ai/keys).');
    },
  };
}
