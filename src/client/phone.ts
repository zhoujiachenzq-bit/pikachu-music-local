import { Capacitor } from '@capacitor/core';
import { SOURCES, type MusicSource } from '../shared/types';

export const phoneApp = Capacitor.isNativePlatform();

// Without the go-music-api service only these two give playable audio reliably.
export const searchSources: readonly MusicSource[] = phoneApp ? ['netease', 'kuwo'] : SOURCES;
