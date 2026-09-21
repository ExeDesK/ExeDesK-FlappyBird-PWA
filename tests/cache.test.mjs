// Service Worker logic tested in an in-memory harness.
// This does not replace a real browser/PWA installation test.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../site/', import.meta.url));
const source = readFileSync(path.join(root, 'sw.js'), 'utf8');

function harness(scope = 'https://example.invalid/lab/flappy/') {
  const listeners = {};
  const stores = new Map();

  let offline = false;
  let failPath = '';
  let network = 0;
  let claimed = false;
  let skipped = false;

  async function fetchFile(request) {
    network += 1;

    if (offline) {
      throw new Error('Offline');
    }

    const url = new URL(typeof request === 'string' ? request : request.url);

    if (failPath && url.pathname.endsWith(failPath)) {
      throw new Error('Simulated missing asset');
    }

    const scopePath = new URL(scope).pathname;
    const relativePath = url.pathname.slice(scopePath.length) || 'index.html';
    const file = path.join(root, relativePath);

    if (!existsSync(file)) {
      return new Response('404', { status: 404 });
    }

    return new Response(readFileSync(file));
  }

  class MemoryCache {
    constructor() {
      this.store = new Map();
    }

    async match(request) {
      const key = typeof request === 'string' ? request : request.url;
      return this.store.get(key)?.clone();
    }

    async put(request, response) {
      const key = typeof request === 'string' ? request : request.url;
      this.store.set(key, response.clone());
    }

    async addAll(requests) {
      const values = await Promise.all(requests.map(async request => {
        const response = await fetchFile(request);

        if (!response.ok) {
          throw new Error('Bad response');
        }

        return [request, response];
      }));

      for (const [request, response] of values) {
        await this.put(request, response);
      }
    }
  }

  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        stores.set(name, new MemoryCache());
      }

      return stores.get(name);
    },

    async keys() {
      return [...stores.keys()];
    },

    async delete(name) {
      return stores.delete(name);
    },
  };

  const self = {
    registration: { scope },
    location: new URL(`${scope}sw.js`),
    clients: {
      async claim() {
        claimed = true;
      },
    },
    skipWaiting() {
      skipped = true;
    },
    addEventListener(type, callback) {
      listeners[type] = callback;
    },
  };

  vm.runInNewContext(source, {
    self,
    caches,
    URL,
    Request,
    Response,
    fetch: fetchFile,
    Set,
  });

  async function event(type, data = {}) {
    let work = Promise.resolve();

    listeners[type]({
      ...data,
      waitUntil(promise) {
        work = promise;
      },
    });

    await work;
  }

  async function get(url) {
    let work;

    listeners.fetch({
      request: new Request(url),
      respondWith(promise) {
        work = promise;
      },
    });

    return work ? await work : null;
  }

  async function verify() {
    let result;

    await event('message', {
      data: { type: 'VERIFY_CACHE' },
      ports: [{
        postMessage(data) {
          result = data;
        },
      }],
    });

    return result;
  }

  return {
    event,
    get,
    verify,
    caches,
    stores,
    setOffline(value) {
      offline = value;
    },
    setFail(value) {
      failPath = value;
    },
    get network() {
      return network;
    },
    get claimed() {
      return claimed;
    },
    get skipped() {
      return skipped;
    },
    scope,
  };
}

test('All 32 runtime resources are cached together, including sounds and icons', async () => {
  const h = harness();
  await h.event('install');

  const result = await h.verify();
  assert.equal(result.complete, true);
  assert.equal(result.count, 32);
  assert.equal(h.skipped, false);

  await h.event('activate');
  assert.equal(h.claimed, true);
});

test('Cached navigation, modules, atlas, audio and icons work offline', async () => {
  const h = harness();
  await h.event('install');
  await h.event('activate');
  h.setOffline(true);

  const networkBefore = h.network;
  const resources = [
    '?seed=42',
    'index.html?debug=1',
    'src/game.js',
    'assets/atlas.png',
    'assets/sounds/sfx_wing.wav',
    'icons/icon-512.png',
  ];

  for (const relativePath of resources) {
    const response = await h.get(h.scope + relativePath);
    assert.equal(response.status, 200, relativePath);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }

  assert.equal(h.network, networkBefore);
});

test('A missing precache asset rejects installation instead of claiming offline readiness', async () => {
  const h = harness();
  h.setFail('sfx_wing.wav');

  await assert.rejects(() => h.event('install'));
  assert.equal(h.stores.size, 0);
});

test('Activation removes only obsolete caches from the same application scope', async () => {
  const h = harness();
  const prefix = `flappy13-${encodeURIComponent(h.scope)}-`;

  await h.caches.open(`${prefix}old`);
  await h.caches.open('another-application');
  await h.event('install');
  await h.event('activate');

  assert.equal(h.stores.has(`${prefix}old`), false);
  assert.equal(h.stores.has('another-application'), true);
});

test('Unsupported routes and external origins are not intercepted', async () => {
  const h = harness();
  await h.event('install');

  assert.equal(await h.get('https://another.invalid/x.js'), null);
  assert.equal(await h.get(`${h.scope}not-a-game-file`), null);
});

test('version.json remains network-only for GitHub Pages reachability checks', async () => {
  const h = harness();
  await h.event('install');

  const response = await h.get(`${h.scope}version.json?_check=123`);
  assert.equal(response, null);

  const cache = [...h.stores.values()][0];
  assert.equal(await cache.match(`${h.scope}version.json`), undefined);
});

test('Waiting workers expose their build number to the page', async () => {
  const h = harness();
  let result;

  await h.event('message', {
    data: { type: 'GET_BUILD' },
    ports: [{
      postMessage(data) {
        result = data;
      },
    }],
  });

  assert.equal(result.build, '0.2.7.3b-dev5.3');
});

test('Activation of a waiting update requires an explicit message', async () => {
  const h = harness();
  await h.event('install');

  assert.equal(h.skipped, false);
  await h.event('message', { data: { type: 'ACTIVATE_UPDATE' } });
  assert.equal(h.skipped, true);
});

test('A cache completeness request reports an evicted asset', async () => {
  const h = harness();
  await h.event('install');

  const cache = [...h.stores.values()][0];
  cache.store.delete(`${h.scope}assets/atlas.png`);

  const result = await h.verify();
  assert.equal(result.complete, false);
  assert.equal(result.missing.length, 1);
});
