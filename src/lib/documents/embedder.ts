export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function float32ToBuffer(arr: Float32Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(arr.byteLength);
  const view = new Uint8Array(buf);
  new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).forEach((v, i) => { view[i] = v; });
  return view;
}

export function bufferToFloat32(buf: Uint8Array): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}
