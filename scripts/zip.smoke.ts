import { createZip, looksLikeZip, readZip } from '../src/persistence/zip';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const asset = Uint8Array.from([0, 1, 2, 3, 250, 251, 252, 253]);
  const project = JSON.stringify({ format: 'my-board-project', schemaVersion: 12, archiveVersion: 1, elements: [], assets: [] });
  const zip = await createZip([
    { name: 'project.json', data: project },
    { name: 'preview.png', data: Uint8Array.from([137, 80, 78, 71]) },
    { name: 'assets/a1.png', data: asset },
  ]);
  assert(looksLikeZip(zip), 'ZIP signature not detected');
  const entries = await readZip(zip);
  assert(new TextDecoder().decode(entries.get('project.json')) === project, 'project.json round trip failed');
  assert(entries.has('preview.png'), 'preview.png missing');
  assert(Array.from(entries.get('assets/a1.png') || []).join(',') === Array.from(asset).join(','), 'binary asset round trip failed');
  console.log('OK: ZIP writer/reader round-trips project.json, preview.png, and raw binary assets.');
}

void main();
