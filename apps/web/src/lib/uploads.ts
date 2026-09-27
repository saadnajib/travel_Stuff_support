import { createUpload } from '../api/endpoints';
import type { UploadResponse } from '../api/types';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_UPLOAD_TYPES = 'image/*,application/pdf';

export function validateUploadFile(file: File, opts: { imagesOnly?: boolean } = {}): string | null {
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';
  if (opts.imagesOnly && !isImage) return 'Please choose an image file.';
  if (!isImage && !isPdf) return 'Only images or PDF files are accepted.';
  if (file.size > MAX_UPLOAD_BYTES) return 'File is larger than 10 MB.';
  if (file.size === 0) return 'File is empty.';
  return null;
}

/** Hex-encoded SHA-256 of the file, computed in the browser. */
export async function sha256Hex(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Your browser cannot compute file checksums here (a secure https/localhost context is required).');
  }
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Registers the file with the (mock) upload service and returns its ref.
 * The contract's dev/mock uploads only store metadata, so file bytes are not
 * transferred to `uploadUrl` here.
 */
export async function registerUpload(file: File): Promise<UploadResponse> {
  const sha256 = await sha256Hex(file);
  return createUpload({
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    sha256,
  });
}
