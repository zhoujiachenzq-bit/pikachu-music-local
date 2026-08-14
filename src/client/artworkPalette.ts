import { useEffect, useState } from 'react';

const artworkCache = new Map<string, string | null>();

function channelHex(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0');
}

function hueFor(red: number, green: number, blue: number): number {
  const r = red / 255; const g = green / 255; const b = blue / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
  if (!delta) return 0;
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

/** Extracts the strongest useful colour family while ignoring black, white and transparent pixels. */
export function dominantArtworkColor(pixels: Uint8ClampedArray): string | null {
  const buckets = Array.from({ length: 12 }, () => ({ red: 0, green: 0, blue: 0, weight: 0 }));
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const red = pixels[index]; const green = pixels[index + 1]; const blue = pixels[index + 2]; const alpha = pixels[index + 3];
    if (alpha < 160) continue;
    const max = Math.max(red, green, blue); const min = Math.min(red, green, blue);
    const chroma = max - min; const lightness = (max + min) / 2;
    if (lightness < 28 || lightness > 238 || chroma < 18) continue;
    const bucket = buckets[Math.floor(hueFor(red, green, blue) / 30) % buckets.length];
    const middleBias = 1 - Math.min(1, Math.abs(lightness - 138) / 160);
    const weight = chroma * (.65 + middleBias * .7);
    bucket.red += red * weight; bucket.green += green * weight; bucket.blue += blue * weight; bucket.weight += weight;
  }
  const winner = buckets.reduce((best, bucket) => bucket.weight > best.weight ? bucket : best, buckets[0]);
  if (!winner.weight) return null;
  return `#${channelHex(winner.red / winner.weight)}${channelHex(winner.green / winner.weight)}${channelHex(winner.blue / winner.weight)}`;
}

async function extractArtworkColor(url: string): Promise<string | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32; canvas.height = 32;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(dominantArtworkColor(context.getImageData(0, 0, canvas.width, canvas.height).data));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export function useArtworkAccent(url: string | null | undefined): string | null {
  const [accent, setAccent] = useState<string | null>(() => url && artworkCache.has(url) ? artworkCache.get(url) || null : null);
  useEffect(() => {
    let cancelled = false;
    if (!url) { setAccent(null); return; }
    if (artworkCache.has(url)) { setAccent(artworkCache.get(url) || null); return; }
    setAccent(null);
    void extractArtworkColor(url).then(color => {
      if (artworkCache.size >= 120) artworkCache.delete(artworkCache.keys().next().value || '');
      artworkCache.set(url, color);
      if (!cancelled) setAccent(color);
    });
    return () => { cancelled = true; };
  }, [url]);
  return accent;
}
