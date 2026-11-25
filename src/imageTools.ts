import sharp from 'sharp';
import { config } from './config.js';

export const DISCORD_ROLE_ICON_MAX_BYTES = 256 * 1024; // 256 KB

export interface ProcessedImageResult {
  buffer: Buffer;
  format: 'png' | 'jpeg';
  originalBytes: number;
  finalBytes: number;
  width: number;
  height: number;
  method?: 'remove.bg' | 'local';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function downloadImageBuffer(imageUrl: string, maxInputMB = 10): Promise<Buffer> {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Gagal mengunduh gambar (HTTP ${res.status}).`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error('File/URL tersebut bukan gambar yang valid (harus JPG/PNG/WEBP/GIF).');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxInputMB * 1024 * 1024) {
    throw new Error(`Ukuran gambar awal terlalu besar (maksimal ${maxInputMB} MB).`);
  }
  return buffer;
}

/**
 * Compress & convert any image to PNG or JPEG strictly <= targetMaxBytes (default 256 KB for Discord Role Icon).
 */
export async function compressImageBuffer(
  inputBuffer: Buffer,
  options?: {
    maxBytes?: number;
    maxDimension?: number;
    preferFormat?: 'png' | 'jpeg';
  }
): Promise<ProcessedImageResult> {
  const maxBytes = options?.maxBytes ?? DISCORD_ROLE_ICON_MAX_BYTES;
  const maxDim = options?.maxDimension ?? 256;
  const originalBytes = inputBuffer.length;

  // Try PNG first (preserves transparency) with progressive palette/size reduction
  const tryPngSizes = [maxDim, Math.min(maxDim, 192), Math.min(maxDim, 128), 96];

  if (options?.preferFormat !== 'jpeg') {
    for (const dim of tryPngSizes) {
      for (const quality of [90, 75, 60]) {
        const out = await sharp(inputBuffer)
          .rotate()
          .resize(dim, dim, { fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 9, palette: true, quality, effort: 8 })
          .toBuffer({ resolveWithObject: true });

        if (out.data.length <= maxBytes) {
          return {
            buffer: out.data,
            format: 'png',
            originalBytes,
            finalBytes: out.data.length,
            width: out.info.width,
            height: out.info.height,
          };
        }
      }
    }
  }

  // Fallback to JPEG (or if preferFormat === 'jpeg')
  for (const dim of tryPngSizes) {
    for (const quality of [85, 70, 55, 40]) {
      const out = await sharp(inputBuffer)
        .rotate()
        .resize(dim, dim, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      if (out.data.length <= maxBytes) {
        return {
          buffer: out.data,
          format: 'jpeg',
          originalBytes,
          finalBytes: out.data.length,
          width: out.info.width,
          height: out.info.height,
        };
      }
    }
  }

  throw new Error(
    `Gambar masih melebihi batas ${formatBytes(maxBytes)} setelah kompresi maksimal. Coba gunakan gambar yang lebih sederhana.`
  );
}

/**
 * Remove background:
 * 1) Uses remove.bg API if REMOVE_BG_API_KEY is configured in .env
 * 2) Otherwise uses built-in local border-connected flood-fill with soft alpha feathering
 * Then compresses the resulting transparent PNG to <= maxBytes (default 256 KB).
 */
export async function removeBackgroundBuffer(
  inputBuffer: Buffer,
  options?: { maxBytes?: number; maxDimension?: number; tolerance?: number }
): Promise<ProcessedImageResult> {
  const originalBytes = inputBuffer.length;
  const maxBytes = options?.maxBytes ?? DISCORD_ROLE_ICON_MAX_BYTES;
  const maxDimension = options?.maxDimension ?? 512;

  // 1) Try remove.bg API if configured
  if (config.removeBgApiKey) {
    const form = new FormData();
    form.append('image_file', new Blob([new Uint8Array(inputBuffer)]), 'image.png');
    form.append('size', 'auto');

    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': config.removeBgApiKey },
      body: form,
    });

    if (res.ok) {
      const cutBuf = Buffer.from(await res.arrayBuffer());
      const compressed = await compressImageBuffer(cutBuf, {
        maxBytes,
        maxDimension,
        preferFormat: 'png',
      });
      return { ...compressed, originalBytes, method: 'remove.bg' };
    }
    console.warn('[ImageTools] remove.bg API gagal, fallback ke algoritma lokal:', res.status);
  }

  // 2) Built-in local border flood-fill background remover
  const { data, info } = await sharp(inputBuffer)
    .rotate()
    .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const pixels = new Uint8Array(data);
  const tolerance = options?.tolerance ?? 42;
  const softRange = 18;

  // Sample 4 corners to find the dominant background color
  const cornerCoords = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let opaqueCorners = 0;

  for (const [cx, cy] of cornerCoords) {
    const idx = (cy * width + cx) * 4;
    if (pixels[idx + 3] > 20) {
      bgR += pixels[idx];
      bgG += pixels[idx + 1];
      bgB += pixels[idx + 2];
      opaqueCorners++;
    }
  }

  if (opaqueCorners > 0) {
    bgR = Math.round(bgR / opaqueCorners);
    bgG = Math.round(bgG / opaqueCorners);
    bgB = Math.round(bgB / opaqueCorners);

    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;

    const colorDist = (pIdx: number) => {
      const dr = pixels[pIdx] - bgR;
      const dg = pixels[pIdx + 1] - bgG;
      const db = pixels[pIdx + 2] - bgB;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };

    const enqueue = (x: number, y: number) => {
      const pos = y * width + x;
      if (visited[pos]) return;
      const pIdx = pos * 4;
      const dist = colorDist(pIdx);
      if (pixels[pIdx + 3] <= 10 || dist <= tolerance + softRange) {
        visited[pos] = 1;
        queue[tail++] = pos;
      }
    };

    // Seed from all 4 borders
    for (let x = 0; x < width; x++) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      enqueue(0, y);
      enqueue(width - 1, y);
    }

    while (head < tail) {
      const pos = queue[head++];
      const x = pos % width;
      const y = (pos - x) / width;
      const pIdx = pos * 4;
      const dist = colorDist(pIdx);

      if (dist <= tolerance) {
        pixels[pIdx + 3] = 0;
        // Continue flood-fill to 4-neighbors
        if (x > 0) enqueue(x - 1, y);
        if (x + 1 < width) enqueue(x + 1, y);
        if (y > 0) enqueue(x, y - 1);
        if (y + 1 < height) enqueue(x, y + 1);
      } else if (dist <= tolerance + softRange) {
        // Soft edge feathering
        const factor = (dist - tolerance) / softRange;
        pixels[pIdx + 3] = Math.round(pixels[pIdx + 3] * factor);
      }
    }
  }

  const rawPng = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const compressed = await compressImageBuffer(rawPng, {
    maxBytes,
    maxDimension,
    preferFormat: 'png',
  });

  return { ...compressed, originalBytes, method: 'local' };
}

