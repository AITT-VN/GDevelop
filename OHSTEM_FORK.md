# OhStem Game Studio fork

Upstream: [4ian/GDevelop](https://github.com/4ian/GDevelop), pinned at `v5.6.283`
(`00b0041478eb4a69473ae9a4875400a2aa97de42`). The code in Core, GDJS,
newIDE, and Extensions is MIT licensed; see their existing license files. The
GDevelop name and logo are owned by Florian Rival.

This branch implements the first usable browser editor for the LMS: Vietnamese
UI, an embeddable editor, learner and slot scoped project storage in IndexedDB,
fresh template copies, optional seed projects, local asset import, ZIP backup
and import, and a same-origin game preview. The OhStem build hides GDevelop
account, store, AI, promotion, and publishing entry points and suppresses their
startup requests. The normal GDevelop build is unchanged.

IndexedDB is local to one browser profile and origin. The `learner` URL value is
only a workspace key, not authentication or a security boundary. A student can
enter another learner key on the same browser. The LMS must use opaque learner
keys and avoid sharing browser profiles if this provisional storage option is
used. Server persistence requires an authenticated LMS storage API.

Not yet implemented: OhStem link publishing, LMS/S3 project sync, curriculum
templates/assets, and school-computer performance validation. Deployment to
`gdevelop.ohstem.vn` also needs the hosting account and DNS configuration.

## Build

```sh
cd newIDE/app
npm ci
npm run build:ohstem
```

`build:ohstem` places the editor and `GDJS/Runtime` in the same `build/`
directory. Deploy the entire directory to the `gdevelop.ohstem.vn` origin.
Serve it over HTTPS for Service Worker preview and IndexedDB. The build pins
the prebuilt `libGD.js` and WASM to the upstream commit above.
Never use the upstream `newIDE/web-app/scripts/deploy.js` for this fork: it
publishes to upstream destinations. Set a CloudFront response headers policy
with `Content-Security-Policy: frame-ancestors https://courses.openstem.vn
http://localhost:*` (also allow the actual local test host origin if different).
Do not set `X-Frame-Options: DENY` or `SAMEORIGIN`. Test COOP/COEP headers with
the lesson iframe before enabling either one.

## Test host

Serve `test-host/` from a local HTTP server, then load `index.html`. Test a
student's `slot` on two lessons and across a browser restart; repeat with a
second student on the same machine. Use the Template input to check that each
open starts a fresh copy. Import a GLB and verify that it survives a save and
reload. Check Preview → close → edit again, copy and paste events, and inspect
the network log for upstream domain requests. Record FPS and editor load time
on the target school computer. These are manual acceptance checks; they have
not been completed merely by building the code.

For the LMS iframe, use `allow="fullscreen; clipboard-read; clipboard-write;
autoplay; camera; microphone; gamepad"` with no `sandbox`. Keep the iframe
mounted throughout a lesson. Do not use `step.embedUrl`, which reloads it.
