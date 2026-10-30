import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SOURCES, type MusicSource } from '../shared/types';

export const phoneApp = Capacitor.isNativePlatform();

// Without the go-music-api service only these two give playable audio reliably.
export const searchSources: readonly MusicSource[] = phoneApp ? ['netease', 'kuwo'] : SOURCES;

// The system bar continues the app header, whichever theme is showing.
export function tintStatusBar() {
  const shell = document.querySelector('.app-shell');
  const color = shell && getComputedStyle(shell).getPropertyValue('--m-raised').trim();
  if (!phoneApp || !color) return;
  const [red, green, blue] = [1, 3, 5].map(start => Number.parseInt(color.slice(start, start + 2), 16));
  const lightBackground = red * .299 + green * .587 + blue * .114 > 140;
  void StatusBar.setBackgroundColor({ color }).catch(() => undefined);
  void StatusBar.setStyle({ style: lightBackground ? Style.Light : Style.Dark }).catch(() => undefined);
}
