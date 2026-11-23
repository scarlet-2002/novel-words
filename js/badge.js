// Home-screen icon badge with the number of words due (iOS 16.4+ home-screen apps, macOS Dock apps).
import { getSettings, todayStr } from './db.js';
import { dueCount } from './checkin.js';

export const badgeEnabled = () => { try { return localStorage.getItem('nv-badge') === '1'; } catch { return false; } };

export async function enableBadge() {
  if (!('setAppBadge' in navigator)) return false;
  if ('Notification' in window && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return false;
  }
  try { localStorage.setItem('nv-badge', '1'); } catch {}
  await updateBadge();
  return true;
}

export async function updateBadge() {
  if (!badgeEnabled() || !('setAppBadge' in navigator)) return;
  const s = await getSettings();
  const n = await dueCount(s.review_mode, todayStr());
  try { n ? await navigator.setAppBadge(n) : await navigator.clearAppBadge(); } catch {}
}
