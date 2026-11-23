const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

const file = path.join(__dirname, '../src/auth-session.ts');
const compiled = new Module(file, module);
compiled._compile(esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, file);
const { readStoredSession, removeExpiredStoredSession, monitorSession } = compiled.exports;
const fixedNow = Date.parse('2026-11-22T00:00:00Z');
const session = (expiresAt = fixedNow + 120_000, token = 'test-token') => ({ token, expiresAt: new Date(expiresAt).toISOString(), user: { id: 'user' }, currentWorkspaceId: 'workspace', workspaces: [{ id: 'workspace' }] });

function storage(initial) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key), values };
}

function clock() {
  let time = fixedNow;
  let counter = 0;
  const tasks = new Map();
  return {
    now: () => time,
    schedule: (callback, delay) => { const id = ++counter; tasks.set(id, { callback, time: time + delay }); return id; },
    cancel: (id) => tasks.delete(id),
    advance(ms) {
      const end = time + ms;
      while (true) {
        const next = [...tasks].filter(([, task]) => task.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
        if (!next) break;
        time = next[1].time;
        tasks.delete(next[0]);
        next[1].callback();
      }
      time = end;
    },
    pending: () => tasks.size,
  };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('expired startup authentication goes to login and removes only the auth key', () => {
  const snapshot = JSON.stringify({ drafts: [{ edited: true }], stocks: [{ id: 'old' }] });
  const store = storage({ auth: JSON.stringify(session(fixedNow)), workspace_snapshot: snapshot, confirmed_keys: '["old:0"]' });
  assert.deepEqual(readStoredSession(store, 'auth', fixedNow), { session: null, expired: true });
  // Reading can run twice in React StrictMode without consuming the notice.
  assert.deepEqual(readStoredSession(store, 'auth', fixedNow), { session: null, expired: true });
  assert.equal(removeExpiredStoredSession(store, 'auth', fixedNow), true);
  assert.equal(store.getItem('auth'), null);
  assert.equal(store.getItem('workspace_snapshot'), snapshot);
  assert.equal(store.getItem('confirmed_keys'), '["old:0"]');
});

test('newer valid login survives startup cleanup; malformed or missing expiry is not accepted', () => {
  const fresh = session();
  const store = storage({ auth: JSON.stringify(fresh) });
  assert.deepEqual(readStoredSession(store, 'auth', fixedNow), { session: fresh, expired: false });
  assert.equal(removeExpiredStoredSession(store, 'auth', fixedNow), false);
  assert.equal(store.getItem('auth'), JSON.stringify(fresh));
  for (const expiresAt of [undefined, 'not-a-date']) {
    const invalid = storage({ auth: JSON.stringify({ ...fresh, expiresAt }) });
    assert.deepEqual(readStoredSession(invalid, 'auth', fixedNow), { session: null, expired: true });
  }
  assert.deepEqual(readStoredSession(storage({ auth: '{' }), 'auth', fixedNow), { session: null, expired: false });
});

test('local expiry triggers once even if an offline request never completes', async () => {
  const timers = clock();
  let expired = 0;
  let signal;
  const current = session(fixedNow + 3000);
  const monitor = monitorSession({ session: current, currentToken: () => current.token, onExpired: () => expired++, ...timers,
    request: (_url, init) => { signal = init.signal; return new Promise(() => {}); } });
  timers.advance(2999);
  assert.equal(expired, 0);
  timers.advance(1);
  assert.equal(expired, 1);
  assert.equal(signal.aborted, true);
  monitor.check();
  timers.advance(180_000);
  assert.equal(expired, 1);
  assert.equal(timers.pending(), 0);
});

test('only a current authoritative 401 expires login; network and 5xx failures retain it', async () => {
  for (const response of [200, 403, 500, 'offline', 401]) {
    const timers = clock();
    let expired = 0;
    const current = session();
    const monitor = monitorSession({ session: current, currentToken: () => current.token, onExpired: () => expired++, ...timers,
      request: async () => { if (response === 'offline') throw new TypeError('offline'); return { status: response }; } });
    await flush();
    assert.equal(expired, response === 401 ? 1 : 0);
    monitor.stop();
    assert.equal(timers.pending(), 0);
  }
});

test('an old response cannot expire a newer login and disposed monitoring aborts its request', async () => {
  for (const scenario of ['new-login', 'disposed']) {
    const timers = clock();
    const current = session();
    let currentToken = current.token;
    let resolve;
    let signal;
    let expired = 0;
    const monitor = monitorSession({ session: current, currentToken: () => currentToken, onExpired: () => expired++, ...timers,
      request: (_url, init) => { signal = init.signal; return new Promise((done) => { resolve = done; }); } });
    if (scenario === 'new-login') currentToken = 'new-token';
    else monitor.stop();
    resolve({ status: 401 });
    await flush();
    timers.advance(180_000);
    assert.equal(expired, 0);
    if (scenario === 'disposed') assert.equal(signal.aborted, true);
    monitor.stop();
  }
});

test('focus checks do not overlap requests and the monitor retries after a temporary failure', async () => {
  const timers = clock();
  const current = session();
  let calls = 0;
  let resolve;
  let expired = 0;
  const monitor = monitorSession({ session: current, currentToken: () => current.token, onExpired: () => expired++, ...timers,
    request: () => { calls++; return new Promise((done) => { resolve = done; }); } });
  monitor.check(); monitor.check();
  assert.equal(calls, 1);
  resolve({ status: 503 });
  await flush();
  timers.advance(60_000);
  assert.equal(calls, 2);
  resolve({ status: 401 });
  await flush();
  assert.equal(expired, 1);
  monitor.stop();
});
