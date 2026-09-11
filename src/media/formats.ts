const STILL_IMAGE_EXTENSIONS = new Set([
  'pjp', 'jfif', 'jpe', 'pjpeg', 'jpeg', 'jpg',
  'png', 'webp', 'svgz', 'svg', 'avif',
]);

const ANIMATED_IMAGE_EXTENSIONS = new Set(['gif', 'apng']);
const VIDEO_EXTENSIONS = new Set(['m4v', 'mp4', 'webm', 'mov', 'qt']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac']);

function extensionFromName(name: string): string {
  const clean = name.split(/[?#]/, 1)[0].replace(/\\/g, '/');
  const fileName = clean.slice(clean.lastIndexOf('/') + 1);
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match?.[1] || '';
}

export type MediaSupportKind = 'image' | 'animated' | 'video' | 'audio' | 'unsupported';

export function mediaSupportKindFromName(name: string): MediaSupportKind {
  const ext = extensionFromName(name);
  if (STILL_IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ANIMATED_IMAGE_EXTENSIONS.has(ext)) return 'animated';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return 'unsupported';
}

export function mediaKindFromName(name: string): 'image' | null {
  return mediaSupportKindFromName(name) === 'image' ? 'image' : null;
}

export function isSupportedMediaName(name: string): boolean {
  return mediaSupportKindFromName(name) === 'image';
}

export function isUnsupportedMotionOrAudioName(name: string): boolean {
  const kind = mediaSupportKindFromName(name);
  return kind === 'animated' || kind === 'video' || kind === 'audio';
}

export function mediaMimeFromName(name: string): string {
  switch (extensionFromName(name)) {
    case 'pjp':
    case 'jfif':
    case 'jpe':
    case 'pjpeg':
    case 'jpeg':
    case 'jpg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'svg':
    case 'svgz': return 'image/svg+xml';
    case 'avif': return 'image/avif';
    case 'gif': return 'image/gif';
    case 'apng': return 'image/apng';
    case 'webm': return 'video/webm';
    case 'mov':
    case 'qt': return 'video/quicktime';
    case 'mp4':
    case 'm4v': return 'video/mp4';
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'ogg':
    case 'oga': return 'audio/ogg';
    case 'm4a': return 'audio/mp4';
    case 'aac': return 'audio/aac';
    case 'flac': return 'audio/flac';
    default: return 'application/octet-stream';
  }
}

export function supportedMediaSummary(): string {
  return 'PNG, JPEG, WebP, SVG, SVGZ, and AVIF';
}

export function unsupportedMotionSummary(): string {
  return 'Animated, video, and audio files such as GIF, APNG, MP4, MOV, WebM, and MP3 are not supported.';
}

export const MEDIA_INPUT_ACCEPT = [...STILL_IMAGE_EXTENSIONS].map(ext => `.${ext}`).join(',');
