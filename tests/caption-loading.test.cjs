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
  const timers = new Map();
  let timerId = 0;
  const video = { currentTime: 10, playCount: 0, play() { this.playCount++; } };
  const document = {
    title: 'Test video - YouTube',
    readyState: 'complete',
    get URL() { return `https://www.youtube.com/watch${location.search}`; },
    querySelector(selector) {
      if (selector === 'video') return ready ? video : null;
      if (selector === 'ytd-watch-flexy[video-id]') {
        return { getAttribute: () => new URLSearchParams(location.search).get('v') };
      }
      return null;
    }
  };
  class Defuddle {
    constructor(_document, options) { optionsSeen.push(options); this.options = options; }
    parseAsync() { return outcomes.shift()(this.options); }
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
    setTimeout(callback, ms) {
      const id = ++timerId;
      if (ms >= 8000) {
        timers.set(id, { callback, ms });
        return id;
      }
      ticks++;
      if (ticks >= readyAtTick) ready = true;
      queueMicrotask(callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
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
    video,
    fireTimer(ms) {
      const entry = Array.from(timers.entries()).find(([, timer]) => timer.ms === ms);
      assert.ok(entry, 'Expected pending timer at ' + ms);
      timers.delete(entry[0]);
      entry[1].callback();
    },
    isReady() { return ready; },
    setReadyAfterTicks(count) { ready = false; readyAtTick = ticks + count; },
    rerun() { vm.runInNewContext(source, context); }
  };
}

for (const browserName of ['chrome', 'firefox']) {
  test(`${browserName}: jumps to 00:00 and resumes playback`, async () => {
    const script = loadContentScript(browserName, []);
    const result = await script.send({ action: 'jumpToTimestamp', timestamp: 0 });
    assert.equal(result.success, true);
    assert.equal(script.video.currentTime, 0);
    assert.equal(script.video.playCount, 1);
  });

  test(`${browserName}: a hanging extraction times out and retries successfully`, async () => {
    const script = loadContentScript(browserName, [
      () => new Promise(() => {}),
      () => transcript('Recovered')
    ]);
    const pending = script.send({ action: 'getCaptions' });
    for (let i = 0; i < 20 && script.optionsSeen.length === 0; i++) await Promise.resolve();
    script.fireTimer(8000);
    const result = await pending;
    assert.equal(result.success, true);
    assert.equal(result.subtitles[0].text, 'Recovered');
    assert.equal(script.optionsSeen.length, 2);
  });

  test(`${browserName}: the overall deadline releases a stuck request and rejects its late transcript`, async () => {
    let resolveFirst;
    const script = loadContentScript(browserName, [
      () => new Promise(resolve => { resolveFirst = resolve; }),
      () => transcript('Fresh')
    ]);
    const pending = script.send({ action: 'getCaptions' });
    for (let i = 0; i < 20 && script.optionsSeen.length === 0; i++) await Promise.resolve();
    const sameRequest = script.send({ action: 'getCaptions' });
    script.fireTimer(30000);
    const result = await pending;
    assert.equal(result.success, false);
    assert.match(result.error, /too long/);
    assert.equal((await sameRequest).success, false);
    const fresh = await script.send({ action: 'getCaptions', force: true });
    assert.equal(fresh.subtitles[0].text, 'Fresh');
    resolveFirst(transcript('Late'));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const cached = await script.send({ action: 'getCaptions' });
    assert.equal(cached.subtitles[0].text, 'Fresh');
    assert.equal(script.optionsSeen.length, 2);
  });

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
    assert.equal(script.optionsSeen[0].extractors.youtube.preserveTranscriptSegments, true);
  });

  test(`${browserName}: preserves individual transcript timestamps`, async () => {
    const script = loadContentScript(browserName, [() => ({
      variables: { transcript: '**0:01** · First\n**0:03** · Second\n### Chapter\n**0:05** · Third' }
    })]);
    const result = await script.send({ action: 'getCaptions', language: 'it' });
    assert.deepEqual(Array.from(result.subtitles, segment => segment.start), [1, 3, 5]);
    assert.equal(result.subtitles[2].section, 'Chapter');
    assert.equal(script.optionsSeen[0].extractors.youtube.preserveTranscriptSegments, true);
    assert.equal(script.optionsSeen[0].language, 'it');
  });

  test(`${browserName}: changing grouping reloads the extractor and bypasses the other mode's cache`, async () => {
    const extract = options => ({
      variables: { transcript: options.extractors.youtube.preserveTranscriptSegments
        ? '**0:01** · First\n**0:03** · Second'
        : '**0:01** · First Second' }
    });
    const script = loadContentScript(browserName, [extract, extract, extract]);
    const separate = await script.send({ action: 'getCaptions' });
    assert.equal(separate.subtitles.length, 2);
    const grouped = await script.send({ action: 'getCaptions', preserveTranscriptSegments: false });
    assert.equal(grouped.subtitles.length, 1);
    assert.equal(grouped.subtitles[0].text, 'First Second');
    assert.equal(script.optionsSeen[1].extractors.youtube.preserveTranscriptSegments, false);
    await script.send({ action: 'getCaptions', preserveTranscriptSegments: false });
    assert.equal(script.optionsSeen.length, 2);
    const separateAgain = await script.send({ action: 'getCaptions', preserveTranscriptSegments: true });
    assert.deepEqual(Array.from(separateAgain.subtitles, segment => segment.start), [1, 3]);
    assert.equal(script.optionsSeen.length, 3);

    // Verify the public option reaches the extractor through the actual bundled Defuddle.
    // A permissive mock alone would miss an option supplied at the wrong nesting level.
    const BundledDefuddle = require(path.join('..', browserName, 'defuddle.js'));
    for (const options of script.optionsSeen) {
      const reader = new BundledDefuddle({}, options);
      reader.getSchemaOrgData = () => ({});
      let forwarded;
      await reader.tryAsyncExtractor((_document, _url, _schema, extractorOptions) => {
        forwarded = extractorOptions;
        return null;
      });
      assert.equal(forwarded.youtube.preserveTranscriptSegments,
        options.extractors.youtube.preserveTranscriptSegments);
    }
  });

  test(`${browserName}: a late response from the previous grouping mode cannot replace the new transcript`, async () => {
    let resolveFirst;
    const pending = new Promise(resolve => { resolveFirst = resolve; });
    const script = loadContentScript(browserName, [
      () => pending,
      () => transcript('Grouped')
    ]);
    const oldRequest = script.send({ action: 'getCaptions', preserveTranscriptSegments: true });
    for (let i = 0; i < 10 && script.optionsSeen.length === 0; i++) await Promise.resolve();
    const current = await script.send({ action: 'getCaptions', preserveTranscriptSegments: false });
    assert.equal(current.subtitles[0].text, 'Grouped');
    resolveFirst(transcript('Old separate transcript'));
    assert.equal((await oldRequest).success, false);
    const cached = await script.send({ action: 'getCaptions', preserveTranscriptSegments: false });
    assert.equal(cached.subtitles[0].text, 'Grouped');
    assert.equal(script.optionsSeen.length, 2);
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
