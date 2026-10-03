// Run with: node scripts/test-ohstem-network-guard.cjs
// Executes the real Flow module: requests to GDevelop services are refused before being sent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const filename = path.resolve(__dirname, '../src/OhStem/NetworkGuard.js');
const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, babelrc: false, configFile: false,
  presets: [['@babel/preset-env', {targets: {node: 'current'}}], '@babel/preset-flow'],
}).code;
const moduleExports = {};
vm.runInNewContext(code, {exports: moduleExports, URL, setTimeout, TypeError});
const {isBlockedUpstreamUrl, installOhStemNetworkGuard} = moduleExports;

for (const url of ['https://api.gdevelop.io/user/recommendation', 'https://api-dev.gdevelop.io/asset/example',
  'https://public-resources.gdevelop.io/ai/ai-settings-v2.json', 'https://api.gdevelop-app.com/analytics/session'])
  assert.equal(isBlockedUpstreamUrl(url), true, url);
for (const url of ['https://gdevelop.ohstem.vn/course-templates/x.json', 'https://resources.gdevelop-app.com/assets/a.png',
  '/static/js/main.js', 'blob:https://gdevelop.ohstem.vn/1', 'data:,x', 12, null, 'not a url'])
  assert.equal(isBlockedUpstreamUrl(url, 'https://gdevelop.ohstem.vn/'), false, String(url));

const sent = [];
class FakeXHR {
  open(method, url) { this.url = url; }
  send() { sent.push(['xhr', this.url]); }
}
const win = {
  location: {href: 'https://gdevelop.ohstem.vn/?lang=vi'},
  fetch: async url => { sent.push(['fetch', String(url)]); return {ok: true}; },
  XMLHttpRequest: FakeXHR,
  navigator: {sendBeacon: url => { sent.push(['beacon', url]); return true; }},
};
installOhStemNetworkGuard(win);
installOhStemNetworkGuard(win); // idempotent

(async () => {
  await assert.rejects(win.fetch('https://api.gdevelop.io/asset/course'), /blocked request to GDevelop services/);
  await assert.rejects(win.fetch({url: 'https://public-resources.gdevelop.io/ai/x.json'}), /blocked/);
  assert.deepEqual(await win.fetch('https://gdevelop.ohstem.vn/course-templates/a.json'), {ok: true});
  const blocked = new win.XMLHttpRequest();
  const failed = new Promise(resolve => { blocked.onerror = resolve; });
  blocked.open('GET', 'https://api.gdevelop.io/shop/product-license');
  blocked.send();
  await failed;
  const allowed = new win.XMLHttpRequest();
  allowed.open('GET', '/libGD.wasm');
  allowed.send();
  assert.equal(win.navigator.sendBeacon('https://api.gdevelop-app.com/analytics/session-hit', '{}'), false);
  assert.equal(win.navigator.sendBeacon('https://gdevelop.ohstem.vn/ok', '{}'), true);
  assert.deepEqual(sent, [['fetch', 'https://gdevelop.ohstem.vn/course-templates/a.json'], ['xhr', '/libGD.wasm'], ['beacon', 'https://gdevelop.ohstem.vn/ok']]);
  console.log('PASS: blocked hosts never sent (fetch, Request-like, XHR with onerror, sendBeacon); own origin, resources CDN, blob/data URLs allowed; install is idempotent.');
})().catch(error => { console.error(error); process.exitCode = 1; });
