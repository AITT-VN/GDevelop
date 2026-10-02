// Run with: node scripts/test-ohstem-slot-reset.cjs
// Executes the real Flow module against a transactional IndexedDB test double.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const filename = path.resolve(__dirname, '../src/ProjectsStorage/OhStemStorageProvider/index.js');
const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, babelrc: false, configFile: false,
  presets: [['@babel/preset-env', {targets: {node: 'current'}}], '@babel/preset-flow'],
}).code;
let learner = 'qa_student_a', confirmed = true, failWrite = false;
let fetched = 0, reloaded = 0, alerted = 0;
const original = {project: {properties: {name: 'Edited'}, layouts: []}, assets: {kept: new Blob(['asset'])}};
const records = new Map([
  ['qa_student_a:slot:lesson', original],
  ['qa_student_b:slot:lesson', original],
  ['qa_student_a:slot:other', original],
]);
const seed = {properties: {name: 'Seed'}, layouts: [], resources: {resources: []}};
let response = {ok: true, json: async () => seed};
const database = {
  transaction() {
    const transaction = {
      error: new Error('Storage unavailable'),
      objectStore: () => ({
        put(value, key) {
          queueMicrotask(() => {
            if (failWrite) return transaction.onabort();
            records.set(key, value);
            transaction.oncomplete();
          });
        },
        get(key) {
          const request = {};
          queueMicrotask(() => { request.result = records.get(key); request.onsuccess(); });
          return request;
        },
      }),
    };
    return transaction;
  },
};
const window = {
  location: {href: '', reload: () => reloaded++},
  confirm: () => confirmed,
  alert: () => alerted++,
};
const moduleExports = {};
vm.runInNewContext(code, {
  exports: moduleExports, URL, window, global: {gd: {}}, console: {error() {}},
  indexedDB: {open() { const r = {}; queueMicrotask(() => {r.result = database; r.onsuccess();}); return r; }},
  fetch: async () => { fetched++; return response; },
  require(name) {
    if (name === '@lingui/macro') return {t: s => s[0]};
    if (name.endsWith('/OhStem/Config')) return {getLearnerId: () => learner, isValidSlot: s => /^[A-Za-z0-9_-]{1,128}$/.test(s)};
    if (name.endsWith('/Serializer')) return {serializeToJSObject: x => x};
    if (name.endsWith('/Zip.js')) return {};
    throw new Error(`Unexpected dependency ${name}`);
  },
});
const url = 'https://gdevelop.ohstem.vn/?slot=lesson&seed=https://gdevelop.ohstem.vn/seed.json';
(async () => {
  for (const suffix of ['?slot=lesson', '?slot=bad%2Fslot&seed=https://example.com/x', '?slot=lesson&seed=x&template=x']) {
    window.location.href = 'https://gdevelop.ohstem.vn/' + suffix;
    assert.equal(moduleExports.canResetSlotFromSeed(), false);
  }
  window.location.href = url;
  learner = null;
  assert.equal(moduleExports.canResetSlotFromSeed(), false);
  learner = 'qa_student_a';
  assert.equal(moduleExports.canResetSlotFromSeed(), true);
  confirmed = false;
  await moduleExports.resetSlotFromSeed();
  assert.equal(fetched, 0);
  assert.equal(records.get('qa_student_a:slot:lesson'), original);
  confirmed = true;
  response = {ok: false, status: 503};
  await moduleExports.resetSlotFromSeed();
  assert.equal(records.get('qa_student_a:slot:lesson'), original);
  assert.equal(reloaded, 0);
  response = {ok: true, json: async () => ({error: 'not a project'})};
  await moduleExports.resetSlotFromSeed();
  assert.equal(records.get('qa_student_a:slot:lesson'), original);
  response = {ok: true, json: async () => seed};
  failWrite = true;
  await moduleExports.resetSlotFromSeed();
  assert.equal(records.get('qa_student_a:slot:lesson'), original);
  assert.equal(reloaded, 0);
  assert.equal(alerted, 3);
  failWrite = false;
  await moduleExports.resetSlotFromSeed();
  assert.equal(records.get('qa_student_a:slot:lesson').project.properties.name, 'Seed');
  assert.equal(records.get('qa_student_b:slot:lesson'), original);
  assert.equal(records.get('qa_student_a:slot:other'), original);
  assert.equal(reloaded, 1);
  const opened = await moduleExports.default.createOperations().onOpen({fileIdentifier: 'slot:lesson'});
  assert.equal(opened.content.properties.name, 'Seed');
  learner = 'qa_student_b';
  const other = await moduleExports.default.createOperations().onOpen({fileIdentifier: 'slot:lesson'});
  assert.equal(other.content.properties.name, 'Edited');
  console.log('PASS: visibility, cancellation, HTTP/invalid-seed/write failure, atomic replacement, learner/slot isolation, reopen.');
})().catch(error => { console.error(error); process.exitCode = 1; });
