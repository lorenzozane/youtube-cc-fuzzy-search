const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const transcript = (text, language = 'it') => ({
  title: 'Test video',
  language,
  variables: { transcript: `**0:01** · ${text}` }
});

function loadContentScript(browserName, outcomes, includeDefuddle = true) {
  const location = { search: '?v=first' };
  const optionsSeen = [];
  let listener;
  let ready = true;
  let ticks = 0;
  let readyAtTick = 0;
  const document = {
    title: 'Test video - YouTube',
    readyState: 'complete',
    get URL() { return `https://www.youtube.com/watch${location.search}`; },
    querySelector(selector) {
      if (selector === 'video') return ready ? {} : null;
      if (selector === 'ytd-watch-flexy[video-id]') {
        return { getAttribute: () => new URLSearchParams(location.search).get('v') };
      }
      return null;
    }
  };
  class Defuddle {
    constructor(_document, options) { optionsSeen.push(options); }
    parseAsync() { return outcomes.shift()(); }
  }
  const onMessage = {
    addListener(value) { listener = value; },
    removeListener() {}
  };
  const api = { runtime: { onMessage } };
  const context = {
    document,
    window: { location },
    URLSearchParams,
    ...(includeDefuddle ? { Defuddle } : {}),
    console: { log() {}, warn() {}, error() {} },
    setTimeout(callback) {
      ticks++;
      if (ticks >= readyAtTick) ready = true;
      queueMicrotask(callback);
    },
    [browserName === 'firefox' ? 'browser' : 'chrome']: api
  };
  const source = fs.readFileSync(path.join(__dirname, '..', browserName, 'content.js'), 'utf8');
  vm.runInNewContext(source, context);

  const send = message => browserName === 'chrome'
    ? new Promise(resolve => listener(message, {}, resolve))
    : listener(message);

  return {
    send,
    location,
    optionsSeen,
    isReady() { return ready; },
    setReadyAfterTicks(count) { ready = false; readyAtTick = ticks + count; },
    rerun() { vm.runInNewContext(source, context); }
  };
}

for (const browserName of ['chrome', 'firefox']) {
  test(`${browserName}: reports a missing reader for popup reinjection`, async () => {
    const script = loadContentScript(browserName, [], false);
    const result = await script.send({ action: 'getCaptions', language: '' });
    assert.equal(result.success, false);
    assert.equal(result.code, 'missing_defuddle');
  });

  test(`${browserName}: waits for the current video before extracting`, async () => {
    let script;
    script = loadContentScript(browserName, [() => {
      assert.equal(script.isReady(), true);
      return transcript('Ready');
    }]);
    script.setReadyAfterTicks(3);
    const result = await script.send({ action: 'getCaptions', language: '' });
    assert.equal(result.success, true);
    assert.equal(script.optionsSeen.length, 1);
  });

  test(`${browserName}: retries an early empty result, then caches success`, async () => {
    const script = loadContentScript(browserName, [
      () => ({ variables: {} }),
      () => transcript('Hello')
    ]);

    const first = await script.send({ action: 'getCaptions', language: '' });
    assert.equal(first.success, true);
    assert.equal(first.subtitles[0].text, 'Hello');
    assert.equal(script.optionsSeen.length, 2);
    assert.equal(script.optionsSeen[0].language, undefined);

    const cached = await script.send({ action: 'getCaptions', language: '' });
    assert.equal(cached.success, true);
    assert.equal(script.optionsSeen.length, 2);
    script.rerun(); // Programmatic reinjection must not replace the listener or reset the cache.
    assert.equal((await script.send({ action: 'getCaptions', language: '' })).success, true);
    assert.equal(script.optionsSeen.length, 2);
  });

  test(`${browserName}: a failed load can be retried with a language preference`, async () => {
    const script = loadContentScript(browserName, [
      () => { throw new Error('Temporary failure'); },
      () => ({ variables: {} }),
      () => ({ variables: {} }),
      () => transcript('Ciao')
    ]);

    const failed = await script.send({ action: 'getCaptions', language: 'it' });
    assert.equal(failed.success, false);
    assert.equal(script.optionsSeen.length, 3);
    const retried = await script.send({ action: 'getCaptions', language: 'it', force: true });
    assert.equal(retried.success, true);
    assert.equal(retried.transcriptMetadata.language, 'it');
    assert.equal(script.optionsSeen[3].language, 'it');
  });

  test(`${browserName}: an old video cannot overwrite the current video`, async () => {
    let resolveFirst;
    const firstExtraction = new Promise(resolve => { resolveFirst = resolve; });
    const script = loadContentScript(browserName, [
      () => firstExtraction,
      () => transcript('Second video')
    ]);

    const oldRequest = script.send({ action: 'getCaptions', language: '' });
    for (let i = 0; i < 10 && script.optionsSeen.length === 0; i++) await Promise.resolve();
    assert.equal(script.optionsSeen.length, 1);
    script.location.search = '?v=second';
    const current = await script.send({ action: 'getCaptions', language: '' });
    assert.equal(current.success, true);
    assert.equal(current.videoId, 'second');
    resolveFirst(transcript('Old video'));
    assert.equal((await oldRequest).success, false);
    const cached = await script.send({ action: 'getCaptions', language: '' });
    assert.equal(cached.videoId, 'second');
    assert.equal(cached.subtitles[0].text, 'Second video');
  });
}
