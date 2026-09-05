// Read-only Companion data audit; writes only a generated release receipt.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('Expected before or after');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const root = '/Users/yao/Library/Application Support/aid-companion';
const output = path.resolve('out/releases', `v${version}`);
async function manifest(folder) {
  const rows = [];
  async function walk(dir) {
    for (const item of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) {
        // Credentials are not release evidence and are never read by this audit.
        if (item.name === 'credentials.key') continue;
        const hash = createHash('sha256'); let bytes = 0;
        for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
        rows.push({ path: path.relative(folder, file), bytes, sha256: hash.digest('hex') });
      }
    }
  }
  await walk(folder);
  return { files: rows.length, bytes: rows.reduce((sum,r)=>sum+r.bytes,0), sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), manifest: rows };
}
const db = JSON.parse(await readFile(path.join(root, 'series/index.json'), 'utf8'));
const activeJobs = db.jobs.filter(j=>['queued','running'].includes(j.status)).map(j=>({ id:j.id,status:j.status }));
if (activeJobs.length) throw new Error(`Active production jobs: ${JSON.stringify(activeJobs)}`);
const groups = {};
for (const name of ['series','pipeline-drafts','series-drafts','video-exports']) groups[name] = await manifest(path.join(root,name));
await mkdir(output, { recursive:true });
const report = { checkedAt: new Date().toISOString(), root, projects: db.projects.length, activeJobs, groups };
await writeFile(path.join(output, `data-${phase}.json`), JSON.stringify(report,null,2));
console.log(JSON.stringify({ phase, projects: report.projects, activeJobs, groups: Object.fromEntries(Object.entries(groups).map(([name,{manifest,...summary}])=>[name,summary])) },null,2));
if (phase === 'after') {
  const before = JSON.parse(await readFile(path.join(output,'data-before.json'),'utf8'));
  const changed = Object.keys(groups).filter(name=>before.groups[name].sha256!==groups[name].sha256);
  if (changed.length) throw new Error(`Data changed; inspect before/after manifests: ${changed.join(', ')}`);
  console.log('PASS: persistent project, draft and export content unchanged');
}
