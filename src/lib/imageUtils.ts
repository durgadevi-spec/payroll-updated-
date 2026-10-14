/**
 * Image helpers for the payslip template designer.
 * Uploaded images are resized/compressed before being stored inside the template JSON,
 * so saving a template stays small and fast instead of sending multi-MB base64 strings.
 */

export interface CompressOptions {
    maxWidth: number;
    maxHeight: number;
    format: 'png' | 'jpeg';
    quality?: number; // jpeg only, 0-1
    maxBytes?: number; // jpeg: lower quality until the data URL is below this size
}

export const MAX_SOURCE_FILE_BYTES = 15 * 1024 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not read this image. Try a PNG or JPG file.'));
        img.src = src;
    });
}

function drawScaled(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    { maxWidth, maxHeight, format }: CompressOptions
): HTMLCanvasElement {
    const scale = Math.min(1, maxWidth / srcW, maxHeight / srcH); // never upscale
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    if (format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    return canvas;
}

function encode(canvas: HTMLCanvasElement, opts: CompressOptions): string {
    if (opts.format === 'png') return canvas.toDataURL('image/png');
    let quality = opts.quality ?? 0.85;
    let out = canvas.toDataURL('image/jpeg', quality);
    const limit = opts.maxBytes ?? 900 * 1024;
    while (out.length > limit && quality > 0.45) {
        quality -= 0.1;
        out = canvas.toDataURL('image/jpeg', quality);
    }
    return out;
}

/** Resize + re-encode an uploaded image file to a compact data URL. */
export async function compressImageFile(file: File, opts: CompressOptions): Promise<string> {
    if (file.size > MAX_SOURCE_FILE_BYTES) {
        throw new Error('Image is too large (max 15 MB). Please choose a smaller file.');
    }
    const objectUrl = URL.createObjectURL(file);
    try {
        const img = await loadImage(objectUrl);
        const canvas = drawScaled(img, img.naturalWidth || img.width, img.naturalHeight || img.height, opts);
        return encode(canvas, opts);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

/** Resize + re-encode a rendered canvas (e.g. a PDF page) to a compact data URL. */
export function compressCanvas(source: HTMLCanvasElement, opts: CompressOptions): string {
    const canvas = drawScaled(source, source.width, source.height, opts);
    return encode(canvas, opts);
}

/** Logos keep transparency (PNG) when the source can have it; otherwise JPEG. */
export function logoFormatFor(file: File): 'png' | 'jpeg' {
    return /png|svg|gif|webp/i.test(file.type) ? 'png' : 'jpeg';
}