export function resolveMediaUrl(value, base) {
  if (!value.trim()) throw new Error('Enter a video URL.');
  const url = new URL(value.trim(), base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP or HTTPS video URL without embedded credentials.');
  }
  if (new URL(base).protocol === 'https:' && url.protocol === 'http:') {
    throw new Error('Use an HTTPS video URL on this secure page.');
  }
  return url.href;
}

export function eyeAspect(width, height) {
  return width > 0 && height > 0 ? width / (2 * height) : 16 / 9;
}

export function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, '0')}`;
}

export function mediaErrorMessage(error) {
  const messages = {
    1: 'Video loading was interrupted. Try loading the clip again.',
    2: 'The video could not be downloaded. Check the URL, connection, and server CORS settings.',
    3: 'The browser could not decode this video. Try an H.264 MP4.',
    4: 'This video is unavailable or unsupported. Use a direct MP4 URL and enable CORS on its server.',
  };
  return messages[error?.code] || 'The video could not be played. Try another MP4 file or URL.';
}
