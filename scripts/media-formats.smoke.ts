import { isSupportedMediaName, mediaKindFromName, mediaMimeFromName, unsupportedMotionSummary } from '../src/media/formats';

const supportedCases: Array<[string, 'image', string]> = [
  ['photo.png', 'image', 'image/png'],
  ['PHOTO.JPEG', 'image', 'image/jpeg'],
  ['art.webp', 'image', 'image/webp'],
  ['diagram.svg', 'image', 'image/svg+xml'],
  ['compressed.svgz', 'image', 'image/svg+xml'],
  ['photo.avif', 'image', 'image/avif'],
];

for (const [name, kind, mime] of supportedCases) {
  if (!isSupportedMediaName(name)) throw new Error(`${name} should be supported`);
  if (mediaKindFromName(name) !== kind) throw new Error(`${name} should classify as ${kind}`);
  if (mediaMimeFromName(name) !== mime) throw new Error(`${name} should map to ${mime}`);
}

for (const name of ['animation.gif', 'animation.apng', 'clip.mp4', 'clip.m4v', 'clip.webm', 'clip.mov', 'clip.qt', 'sound.mp3', 'sound.wav']) {
  if (isSupportedMediaName(name)) throw new Error(`${name} should not be accepted as supported media`);
  if (mediaKindFromName(name) !== null) throw new Error(`${name} should have no supported media kind`);
}

for (const name of ['notes.txt', 'document.pdf', 'archive.zip', 'folder']) {
  if (isSupportedMediaName(name)) throw new Error(`${name} should not be accepted as media`);
  if (mediaKindFromName(name) !== null) throw new Error(`${name} should have no media kind`);
}

if (!/GIF/.test(unsupportedMotionSummary()) || !/MP4/.test(unsupportedMotionSummary()) || !/MP3/.test(unsupportedMotionSummary())) {
  throw new Error('unsupported-media guidance should mention animated, video, and audio examples');
}

console.log('OK: media format classification accepts only still image/vector formats and rejects animated/video/audio formats.');
