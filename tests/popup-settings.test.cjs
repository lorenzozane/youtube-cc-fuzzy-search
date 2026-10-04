const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPopup(browserName, preferences = {}, deferReplies = false) {
  const elements = new Map();
  const events = {};
  const writes = [];
  const requests = [];
  const replies = [];
  const timers = new Map();
  let timerId = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: id === 'settings-page',
      value: '',
      style: {},
      options: [{ value: '' }, { value: 'it' }],
      children: [],
      attributes: {},
      listeners: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      focus() { document.activeElement = this; },
      appendChild(child) { this.children.push(child); },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
      get firstChild() { return this.children[0]; }
    });
    return elements.get(id);
  };
  const document = {
    activeElement: null,
    getElementById: element,
    createElement: () => element(Symbol()),
    documentElement: { setAttribute() {} },
    addEventListener(name, handler) { events[name] = handler; }
  };
  const api = {
    storage: { local: {
      get: async () => preferences,
      set: async value => { writes.push(value); }
    } },
    runtime: {},
    tabs: {
      query(_options, callback) {
        const tabs = [{ id: 7, url: 'https://www.youtube.com/watch?v=first' }];
        if (callback) callback(tabs);
        else return Promise.resolve(tabs);
      },
      sendMessage(_tabId, message, callback) {
        requests.push(message);
        if (message.action === 'jumpToTimestamp') return Promise.resolve({ success: true });
        const response = {
          success: true, videoId: 'first', videoTitle: 'Test video',
          subtitles: message.preserveTranscriptSegments ? captions : [
            { ...captions[0], text: 'First Second', end: 4 },
            ...captions.slice(2)
          ]
        };
        if (callback) {
          if (deferReplies) replies.push(() => callback(response));
          else callback(response);
        } else {
          if (deferReplies) return new Promise(resolve => replies.push(() => resolve(response)));
          return Promise.resolve(response);
        }
      }
    }
  };
  const context = vm.createContext({
    document, console, navigator: { language: 'en' },
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    [browserName === 'chrome' ? 'chrome' : 'browser']: api
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', browserName, 'popup.js'), 'utf8'), context);
  return {
    context, element, document, events, writes, requests, replies, timers,
    fireTimer(ms) {
      const entry = Array.from(timers.entries()).find(([, timer]) => timer.ms === ms);
      assert.ok(entry, 'Expected pending timer at ' + ms);
      timers.delete(entry[0]);
      entry[1].callback();
    }
  };
}

const captions = [
  { text: 'First', start: 0, end: 2, timestamp: '0:00', section: '' },
  { text: 'Second', start: 2, end: 4, timestamp: '0:02', section: '' },
  { text: 'Chapter', start: 4, end: 6, timestamp: '0:04', section: 'Next' },
  { text: 'After a pause', start: 20, end: 22, timestamp: '0:20', section: 'Next' }
];

for (const browserName of ['chrome', 'firefox']) {
  test(`${browserName}: clicking the first transcript row sends timestamp zero`, async () => {
    const popup = loadPopup(browserName);
    await popup.events.DOMContentLoaded();
    popup.element('results-list').children[0].listeners.click();
    await Promise.resolve();
    assert.equal(popup.requests.at(-1).action, 'jumpToTimestamp');
    assert.equal(popup.requests.at(-1).timestamp, 0);
  });

  test(`${browserName}: a slow load offers retry then clears timers on success`, async () => {
    const popup = loadPopup(browserName, {}, true);
    await popup.events.DOMContentLoaded();
    popup.fireTimer(5000);
    assert.match(popup.element('status').textContent, /Still trying/);
    assert.equal(popup.element('retry-button').hidden, false);
    popup.replies[0]();
    await Promise.resolve();
    assert.equal(popup.element('status').className, 'message success');
    assert.equal(popup.element('retry-button').hidden, true);
    assert.equal(popup.timers.size, 0);
  });

  test(`${browserName}: an unanswered request shows an error and ignores late replies`, async () => {
    const popup = loadPopup(browserName, {}, true);
    await popup.events.DOMContentLoaded();
    popup.fireTimer(35000);
    assert.equal(popup.element('status').className, 'message error');
    assert.equal(popup.element('retry-button').hidden, false);
    popup.replies[0]();
    await Promise.resolve();
    assert.equal(popup.element('status').className, 'message error');
    popup.element('retry-button').listeners.click();
    assert.equal(popup.requests.at(-1).force, true);
    popup.replies[1]();
    await Promise.resolve();
    assert.equal(popup.element('status').className, 'message success');
  });

  test(`${browserName}: settings reload captions in the requested extraction mode`, async () => {
    const popup = loadPopup(browserName, { captionLanguage: 'it', aggregateSegments: false });
    await popup.events.DOMContentLoaded();
    const { element, context, document } = popup;
    assert.equal(element('language-select').value, 'it');
    assert.equal(element('aggregate-segments').checked, false);
    assert.equal(popup.requests[0].preserveTranscriptSegments, true);
    assert.equal(element('results-list').children.length, 5);
    element('settings-toggle').listeners.click();
    assert.equal(element('settings-page').hidden, false);
    assert.equal(element('transcript-page').hidden, true);
    assert.equal(element('settings-toggle').attributes['aria-expanded'], 'true');
    assert.equal(document.activeElement, element('settings-back'));
    element('aggregate-segments').checked = true;
    element('aggregate-segments').listeners.change();
    await Promise.resolve();
    assert.equal(popup.writes[0].aggregateSegments, true);
    assert.equal(popup.requests[1].preserveTranscriptSegments, false);
    assert.equal(popup.requests[1].language, 'it');
    assert.equal(element('results-list').children.length, 4);
    assert.equal(element('results-list').children[0].children[1].textContent, 'First Second');
    assert.equal(document.activeElement, element('settings-back'));
    element('aggregate-segments').checked = false;
    element('aggregate-segments').listeners.change();
    await Promise.resolve();
    assert.equal(popup.requests[2].preserveTranscriptSegments, true);
    assert.equal(element('results-list').children.length, 5);
    popup.events.keydown({ key: 'Escape', target: element('settings-back'), preventDefault() {} });
    assert.equal(element('settings-page').hidden, true);
    assert.equal(element('transcript-page').hidden, false);
    assert.equal(document.activeElement, element('settings-toggle'));
    assert.equal(popup.writes[1].aggregateSegments, false);
  });

  test(`${browserName}: separate segments are the default and retain their timestamps in searches`, async () => {
    const { context, element, events } = loadPopup(browserName);
    await events.DOMContentLoaded();
    assert.equal(element('aggregate-segments').checked, false);
    context.captions = captions;
    assert.equal(captions[0].text, 'First');
    const separate = vm.runInContext('createSearchableSegments(captions)', context);
    assert.deepEqual(Array.from(separate, segment => segment.text), captions.map(caption => caption.text));
    assert.deepEqual(Array.from(separate, segment => segment.contextStart), [0, 2, 4, 20]);
  });

  test(`${browserName}: saved grouping preference is used on opening`, async () => {
    const popup = loadPopup(browserName, { aggregateSegments: true });
    await popup.events.DOMContentLoaded();
    assert.equal(popup.element('aggregate-segments').checked, true);
    assert.equal(popup.requests[0].preserveTranscriptSegments, false);
    assert.equal(popup.element('results-list').children[0].children[1].textContent, 'First Second');
  });

  test(`${browserName}: changing modes keeps the search query and searches the reloaded transcript`, async () => {
    const popup = loadPopup(browserName);
    await popup.events.DOMContentLoaded();
    popup.element('search-input').value = 'First';
    vm.runInContext('performSearch = (query) => { globalThis.lastQuery = query; globalThis.lastText = subtitles[0].text; }', popup.context);
    popup.element('settings-toggle').listeners.click();
    popup.element('aggregate-segments').checked = true;
    popup.element('aggregate-segments').listeners.change();
    await Promise.resolve();
    assert.equal(popup.context.lastQuery, 'First');
    assert.equal(popup.context.lastText, 'First Second');
    assert.equal(popup.element('search-input').value, 'First');
    assert.equal(popup.document.activeElement, popup.element('settings-back'));
  });
}
