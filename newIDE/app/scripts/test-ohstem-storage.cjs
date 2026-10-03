// Run with: node scripts/test-ohstem-storage.cjs
// Executes the real Flow module against an IndexedDB test double:
// - importing a ZIP inside a lesson slot replaces that slot only after confirmation (R18);
// - saving reuses opened assets without downloading them again, keeps content-based ids,
//   frees blob URLs of the previous project, asks for persistent storage and explains a full disk (D4).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const babel = require('@babel/core');
const filename = path.resolve(__dirname, '../src/ProjectsStorage/OhStemStorageProvider/index.js');
const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, babelrc: false, configFile: false,
  presets: [['@babel/preset-env', {targets: {node: 'current'}}], '@babel/preset-flow'],
}).code;

let confirmed = true, quota = false, persisted = 0;
const fetched = [];
const records = new Map();
const database = {
  transaction() {
    const transaction = {
      error: Object.assign(new Error('full'), {name: 'QuotaExceededError'}),
      objectStore: () => ({
        put(value, key) { queueMicrotask(() => { if (quota) return transaction.onabort(); records.set(key, value); transaction.oncomplete(); }); },
        get(key) { const r = {}; queueMicrotask(() => { r.result = records.get(key); r.onsuccess(); }); return r; },
      }),
    };
    return transaction;
  },
};
let blobCounter = 0;
const created = new Map(), revoked = [];
class TestURL extends URL {
  static createObjectURL(blob) { const url = `blob:https://gdevelop.ohstem.vn/${++blobCounter}`; created.set(url, blob); return url; }
  static revokeObjectURL(url) { revoked.push(url); }
}
const indexedDB = {open() { const r = {}; queueMicrotask(() => { r.result = database; r.onsuccess(); }); return r; }};
const window = {location: {href: ''}, confirm: () => confirmed, alert() {}, indexedDB, crypto: crypto.webcrypto};
const moduleExports = {};
vm.runInNewContext(code, {
  exports: moduleExports, URL: TestURL, window, crypto: crypto.webcrypto, Blob, TextEncoder,
  navigator: {storage: {persist: async () => { persisted++; return true; }}},
  global: {gd: {}}, console: {error() {}},
  indexedDB,
  fetch: async url => { fetched.push(url); return {ok: true, blob: async () => new Blob([`remote:${url}`])}; },
  require(name) {
    if (name === '@lingui/macro') return {t: s => s[0]};
    if (name.endsWith('/OhStem/Config')) return {getLearnerId: () => 'qa_student', isValidSlot: s => /^[A-Za-z0-9_-]{1,128}$/.test(s)};
    if (name.endsWith('/Serializer')) return {serializeToJSObject: p => p.json()};
    if (name.endsWith('/Zip.js')) return {};
    throw new Error(`Unexpected dependency ${name}`);
  },
});
const ops = moduleExports.default.createOperations();
const fakeProject = files => ({
  json: () => ({properties: {name: 'P'}, layouts: [], resources: {resources: Object.entries(files).map(([name, file]) => ({name, file}))}}),
  getResourcesManager: () => ({
    getAllResourceNames: () => ({toJSArray: () => Object.keys(files)}),
    getResource: name => ({getFile: () => files[name]}),
  }),
});
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const imported = {project: {properties: {name: 'FromZip'}, layouts: []}, assets: {}};

(async () => {
  // R18: inside a lesson slot, confirm → the slot is replaced; cancel → a copy.
  window.location.href = 'https://gdevelop.ohstem.vn/?slot=gamedev-l11-main&seed=https://x/seed.json';
  let result = await moduleExports.storeImportedProject(imported, 'em.zip');
  assert.equal(result.fileIdentifier, 'slot:gamedev-l11-main');
  assert.equal(records.get('qa_student:slot:gamedev-l11-main'), imported);
  confirmed = false;
  result = await moduleExports.storeImportedProject(imported, 'em.zip');
  assert.match(result.fileIdentifier, /^copy:/);
  confirmed = true;
  for (const href of ['https://gdevelop.ohstem.vn/?lang=vi', 'https://gdevelop.ohstem.vn/?template=https://x/t.json', 'https://gdevelop.ohstem.vn/?slot=bad%2Fslot']) {
    window.location.href = href;
    assert.match((await moduleExports.storeImportedProject(imported, 'z')).fileIdentifier, /^copy:/, href);
  }

  // D4: open a stored project with two assets.
  window.location.href = 'https://gdevelop.ohstem.vn/?slot=lesson&seed=https://x/seed.json';
  const glb = new Blob(['glb-bytes']), png = new Blob(['png-bytes']);
  records.set('qa_student:slot:lesson', {project: {resources: {resources: [{name: 'Hero', file: 'ohstem-asset://a1'}, {name: 'Tex', file: 'ohstem-asset://a2'}]}}, assets: {a1: glb, a2: png}});
  const opened = (await ops.onOpen({fileIdentifier: 'slot:lesson'})).content;
  const [heroUrl, texUrl] = opened.resources.resources.map(r => r.file);
  assert.equal(created.get(heroUrl), glb);
  // Save: opened blobs are reused (no fetch), ids stay the same; one new remote resource is fetched once.
  const remote = 'https://gdevelop.ohstem.vn/course-templates/x/Da.glb';
  const project = fakeProject({Hero: heroUrl, Tex: texUrl, Rock: remote});
  let stored = await moduleExports.createStoredProject(project);
  assert.deepEqual(fetched, [remote]);
  assert.equal(stored.assets.a1, glb);
  assert.equal(stored.assets.a2, png);
  const rockId = sha(`remote:${remote}`);
  assert.ok(stored.assets[rockId], 'new asset id is the SHA-256 of its content');
  assert.deepEqual(Array.from(stored.project.resources.resources, r => r.file), ['ohstem-asset://a1', 'ohstem-asset://a2', `ohstem-asset://${rockId}`]);
  stored = await moduleExports.createStoredProject(project);
  assert.deepEqual(fetched, [remote], 'second save downloads nothing');
  // Saving through the operation asks for persistent storage.
  await ops.onSaveProject(project, {fileIdentifier: 'slot:lesson'});
  assert.equal(persisted, 1);
  assert.equal(Object.keys(records.get('qa_student:slot:lesson').assets).length, 3);
  // Opening another project frees the previous blob URLs.
  await ops.onOpen({fileIdentifier: 'slot:lesson'});
  assert.ok(revoked.includes(heroUrl) && revoked.includes(texUrl));
  // Full disk → clear Vietnamese message, saved record untouched.
  const before = records.get('qa_student:slot:lesson');
  quota = true;
  await assert.rejects(moduleExports.saveStoredProject('slot:lesson', {project: {}, assets: {}}), /hết chỗ lưu bài/);
  assert.equal(records.get('qa_student:slot:lesson'), before);
  console.log('PASS: ZIP import into lesson slot (confirm/cancel/no slot/template/invalid slot); save reuses opened assets, fetches new ones once with SHA-256 ids, frees old blob URLs, requests persistent storage, explains a full disk without touching the saved work.');
})().catch(error => { console.error(error); process.exitCode = 1; });
