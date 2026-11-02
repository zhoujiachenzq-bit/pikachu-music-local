import { describe, expect, it } from 'vitest';
import { playlistImportRequest } from './importInput';

describe('playlist import input', () => {
  it('keeps the selected source for non-numeric platform IDs', () => {
    expect(playlistImportRequest('  abC_-123  ', 'jamendo')).toEqual({ input: 'abC_-123', source: 'jamendo' });
  });
  it('extracts a shared URL and lets the server detect its source', () => {
    expect(playlistImportRequest('分享歌单：https://y.qq.com/n/ryqq/playlist/123456。', 'netease')).toEqual({ input: 'https://y.qq.com/n/ryqq/playlist/123456' });
  });
});
