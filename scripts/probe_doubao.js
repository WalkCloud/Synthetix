const Database = require('better-sqlite3');
const { createDecipheriv, scryptSync } = require('crypto');
const db = new Database('E:/project01/dev.db');

const p = db.prepare(`
  SELECT p.id as pid, p.api_key, p.api_base_url, m.model_id, m.embedding_dim 
  FROM model_providers p 
  JOIN model_configs m ON m.provider_id = p.id 
  WHERE p.name = 'volcengine' AND m.capabilities LIKE '%embedding%'
`).get();

if (!p || !p.api_key) { console.log('no api key'); process.exit(0); }

const ENC_KEY = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-me';
const key = scryptSync(ENC_KEY, 'synthetix-salt', 32);
const data = Buffer.from(p.api_key, 'base64');
const iv = data.subarray(0, 16);
const authTag = data.subarray(16, 32);
const enc = data.subarray(32);
const decipher = createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(authTag);
const decrypted = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');

console.log('url:', p.api_base_url, 'model:', p.model_id, 'key:', decrypted.slice(0,8)+'...');

// Normalize URL
const base = p.api_base_url.replace(/\/+$/, '').replace(/\/v\d+\/(embeddings|chat\/completions)(\/\w+)?$/, '').replace(/\/v\d+$/, '');
const probeUrl = base + '/v3/embeddings';
console.log('base:', base);
console.log('probe:', probeUrl);

fetch(probeUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + decrypted },
  body: JSON.stringify({ input: ['test'], model: p.model_id, dimensions: 1536 }),
}).then(r => {
  console.log('status:', r.status, r.statusText);
  return r.text().then(t => ({ status: r.status, text: t.slice(0,500) }));
}).then(d => {
  console.log('response:', d.text);
  try {
    const j = JSON.parse(d.text);
    const dim = j.data?.[0]?.embedding?.length;
    console.log('dimension:', dim);
  } catch {}
}).catch(e => console.log('error:', e.message));
