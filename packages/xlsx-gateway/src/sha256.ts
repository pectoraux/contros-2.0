/**
 * Pure SHA-256 implementation for the xlsx-gateway package.
 *
 * The xlsx-gateway package must be pure (ZERO node:* imports), so it
 * cannot use `node:crypto.createHash('sha256')`. This is a minimal
 * pure-JavaScript SHA-256 implementation used only for entry inventory
 * hashing (PackageEntry.sha256).
 *
 * Performance is not critical here — this is used for archive entry
 * comparison in assertOnlyTouchedEntriesChanged, not for security.
 */

// SHA-256 constants (fractional parts of cube roots of first 64 primes)
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n))
}

/**
 * Compute the SHA-256 hash of a byte array and return a hex string.
 *
 * @param input — the bytes to hash (Uint8Array or Buffer)
 * @returns 64-character lowercase hex string
 */
export function sha256Hex(input: Uint8Array): string {
  // Pre-processing: padding
  const len = input.length
  const bitLen = len * 8
  // Padded length: len + 1 (0x80) + padding zeros + 8 (length) = multiple of 64
  const paddedLen = ((len + 9 + 63) >>> 6) << 6
  const padded = new Uint8Array(paddedLen)
  padded.set(input)
  padded[len] = 0x80
  // Append 64-bit big-endian length (we only support up to 2^32 bits = 512MB)
  const dv = new DataView(padded.buffer)
  dv.setUint32(paddedLen - 4, bitLen >>> 0, false)
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false)

  // Initial hash values (fractional parts of square roots of first 8 primes)
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19

  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLen; offset += 64) {
    // Copy block into w[0..15] (big-endian)
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(offset + i * 4, false)
    }
    // Extend the first 16 words into the remaining 48
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!
      const w2 = w[i - 2]!
      const w16 = w[i - 16]!
      const w7 = w[i - 7]!
      const s0 = rotr(7, w15) ^ rotr(18, w15) ^ (w15 >>> 3)
      const s1 = rotr(17, w2) ^ rotr(19, w2) ^ (w2 >>> 10)
      w[i] = (w16 + s0 + w7 + s1) >>> 0
    }

    // Compression
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  // Produce hex output
  const parts = [h0, h1, h2, h3, h4, h5, h6, h7]
  return parts.map((h) => h.toString(16).padStart(8, '0')).join('')
}
