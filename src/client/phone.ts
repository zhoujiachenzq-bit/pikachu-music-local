import { Capacitor, registerPlugin } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SEARCH_SOURCES, type MusicSource } from '../shared/types';

export const phoneApp = Capacitor.isNativePlatform();

// Phones without the bundled go-music-api build only get reliable audio from these two.
let localMusicApiReady = false;
export function markLocalMusicApiReady() { localMusicApiReady = true; }
export function phoneCoverUrl(source: MusicSource, id: string): string | null {
  return phoneApp && localMusicApiReady ? `http://127.0.0.1:8080/api/v1/music/cover?${new URLSearchParams({ source, id })}` : null;
}
export const searchSources = (): readonly MusicSource[] => !phoneApp || localMusicApiReady ? SEARCH_SOURCES : ['netease', 'kuwo'];

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

export type PhonePlaybackAction = 'play' | 'pause' | 'next' | 'previous';
interface MusicPlaybackPlugin {
  saveBackup(options: { data: string }): Promise<{ saved: boolean }>;
  localMusicApi(): Promise<{ available: boolean }>;
  update(options: { title: string; artist: string; playing: boolean }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: 'action', listener: (data: { action: PhonePlaybackAction }) => void): Promise<{ remove: () => Promise<void> }>;
}
const MusicPlayback = registerPlugin<MusicPlaybackPlugin>('MusicPlayback');
export const savePhoneBackup = (data: string) => MusicPlayback.saveBackup({ data });

// The Android service keeps playback alive with the screen off and shows lock-screen controls.
export function syncPhonePlayback(track: { title: string; artist: string } | null, playing: boolean) {
  if (!phoneApp) return;
  void (track ? MusicPlayback.update({ title: track.title, artist: track.artist, playing }) : MusicPlayback.stop()).catch(() => undefined);
}

export const localMusicApiAvailable = () => MusicPlayback.localMusicApi().then(result => result.available).catch(() => false);

export function onPhonePlaybackAction(handler: (action: PhonePlaybackAction) => void) {
  if (!phoneApp) return () => undefined;
  const listening = MusicPlayback.addListener('action', data => handler(data.action));
  return () => { void listening.then(listener => listener.remove()).catch(() => undefined); };
}
