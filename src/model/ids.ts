// IDs are part of the persisted document model, so use collision-resistant UUIDs.
// Modern browsers and current Node versions expose crypto.randomUUID().
export function generateId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  // Fallback for test shells / older WebViews that provide Web Crypto but not
  // randomUUID(). This remains cryptographically random without a weak PRNG fallback.
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error('Secure UUID generation requires Web Crypto support.');
}
