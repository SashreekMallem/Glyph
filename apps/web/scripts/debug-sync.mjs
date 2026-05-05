import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';

// Re-fetch from API to get a fresh docx
const resp = await fetch('http://localhost:3000/api/mcp/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.K },
  body: JSON.stringify({
    document_type: 'resume',
    structured_data: {
      personal: { full_name: 'Test User' },
    },
    output_format: 'docx',
    title: 'Smoke',
  }),
});
const j = await resp.json();
console.log('generate status:', resp.status, j.error || 'ok');
const url = j.url;
const dl = await fetch(url);
const buf = new Uint8Array(await dl.arrayBuffer());
const files = unzipSync(buf);
const docXml = Buffer.from(files['word/document.xml']).toString('utf8');
console.log('--- document.xml ---');
console.log(docXml);

// Mimic the extractor
const paragraphs = docXml.split(/<w:p[\s>]/);
const out = [];
for (const p of paragraphs) {
  const runs = [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
  const parts = runs.map(r => r[1] ?? '');
  if (parts.length > 0) out.push(parts.join(''));
}
const visible = out.join('\n');
console.log('--- visibleText ---');
console.log(JSON.stringify(visible));
