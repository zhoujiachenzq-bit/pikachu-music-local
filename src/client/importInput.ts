import type { MusicSource } from '../shared/types';

export function playlistImportRequest(raw: string, selected: MusicSource) {
  const value = raw.trim();
  const link = value.match(/https?:\/\/[^\s<>"“”]+/i)?.[0]?.replace(/[，。；）)]+$/, '');
  return link ? { input: link } : { input: value, source: selected };
}
