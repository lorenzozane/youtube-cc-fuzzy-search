(() => {
if (globalThis.__ytCCSearchContentLoaded) return;
globalThis.__ytCCSearchContentLoaded = true;

let subtitles = [];
let videoId = '';
let messageListener = null;
let transcriptMarkdown = '';
let transcriptDocumentMarkdown = '';
let transcriptMetadata = {};
let activeCaptionRequest = null;
let completedCaptionKey = '';
let captionRequestVersion = 0;

const CAPTION_RETRY_DELAYS = [0, 1200, 2500];
const VIDEO_READY_TIMEOUT = 6000;

function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function parseTimestamp(timestampText) {
  const parts = timestampText.split(':').map(Number);
  if (parts.some(Number.isNaN)) {
    return null;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

function parseTranscriptMarkdown(markdownText) {
  const lines = (markdownText || '').split(/\r?\n/);
  const parsed = [];
  let currentSection = '';
  let currentCaption = null;

  const flushCurrentCaption = () => {
    if (!currentCaption) {
      return;
    }

    parsed.push(currentCaption);
    currentCaption = null;
  };

  for (const line of lines) {
    const sectionMatch = line.match(/^###\s+(.+)$/);
    if (sectionMatch) {
      flushCurrentCaption();
      currentSection = sectionMatch[1].trim();
      continue;
    }

    const transcriptMatch = line.match(/^\*\*(\d{1,2}:\d{2}(?::\d{2})?)\*\*\s*·\s*(.+)$/);
    if (transcriptMatch) {
      flushCurrentCaption();

      const timestamp = transcriptMatch[1];
      const start = parseTimestamp(timestamp);
      if (start === null) {
        continue;
      }

      currentCaption = {
        text: transcriptMatch[2].trim(),
        start,
        end: start + 2,
        timestamp,
        section: currentSection
      };

      continue;
    }

    if (!currentCaption) {
      continue;
    }

    const continuation = line.trim();
    if (!continuation) {
      continue;
    }

    currentCaption.text = `${currentCaption.text} ${continuation}`;
  }

  flushCurrentCaption();

  for (let i = 0; i < parsed.length; i++) {
    const current = parsed[i];
    const next = parsed[i + 1];
    if (!next) {
      break;
    }
    current.end = Math.max(current.start + 1, next.start);
  }

  return parsed;
}

function escapeYamlString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildTranscriptDocumentMarkdown(metadata, transcript, sourceUrl) {
  const frontmatter = [
    '---',
    `title: "${escapeYamlString(metadata.title || '')}"`,
    `author: "${escapeYamlString(metadata.author || '')}"`,
    `published: ${metadata.published || ''}`,
    `source: "${escapeYamlString(sourceUrl)}"`,
    `domain: "${escapeYamlString(metadata.domain || '')}"`,
    `language: "${escapeYamlString(metadata.language || '')}"`,
    `description: "${escapeYamlString(metadata.description || '')}"`,
    `word_count: ${Number(metadata.word_count) || 0}`,
    '---',
    `![](${sourceUrl})`,
    '## Transcript',
    transcript || ''
  ];

  return frontmatter.join('\n');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function videoChanged(targetVideoId, requestVersion) {
  return getVideoId() !== targetVideoId || requestVersion !== captionRequestVersion;
}

async function waitForVideoReady(targetVideoId, requestVersion) {
  const deadline = Date.now() + VIDEO_READY_TIMEOUT;

  while (Date.now() < deadline) {
    if (videoChanged(targetVideoId, requestVersion)) return false;

    const watch = document.querySelector('ytd-watch-flexy[video-id]');
    const watchVideoId = watch?.getAttribute('video-id');
    if (document.readyState !== 'loading' && document.querySelector('video') &&
        (!watchVideoId || watchVideoId === targetVideoId)) {
      // Give YouTube a moment to finish replacing player data after navigation.
      await delay(350);
      const currentWatchId = document.querySelector('ytd-watch-flexy[video-id]')?.getAttribute('video-id');
      if (!videoChanged(targetVideoId, requestVersion) &&
          (!currentWatchId || currentWatchId === targetVideoId)) return true;
    }

    await delay(250);
  }

  // Defuddle can still find captions when the video element is slow to appear.
  const watchVideoId = document.querySelector('ytd-watch-flexy[video-id]')?.getAttribute('video-id');
  return !videoChanged(targetVideoId, requestVersion) &&
    (!watchVideoId || watchVideoId === targetVideoId);
}

function captionResponse() {
  return {
    success: true,
    subtitles,
    videoTitle: transcriptMetadata.title || document.title.replace(' - YouTube', ''),
    videoId,
    transcriptMarkdown,
    transcriptDocumentMarkdown,
    transcriptMetadata
  };
}

async function loadCaptions(targetVideoId, language, requestVersion) {
  for (let attempt = 0; attempt < CAPTION_RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) await delay(CAPTION_RETRY_DELAYS[attempt]);
    if (videoChanged(targetVideoId, requestVersion)) break;
    if (!await waitForVideoReady(targetVideoId, requestVersion)) break;

    try {
      const source = document.URL;
      const options = { url: source };
      if (language) options.language = language;
      const defuddled = await new Defuddle(document, options).parseAsync();
      if (videoChanged(targetVideoId, requestVersion)) break;

      const markdown = defuddled?.variables?.transcript || '';
      const parsed = parseTranscriptMarkdown(markdown);
      if (parsed.length === 0) {
        console.warn(`YouTube CC Search: No captions on attempt ${attempt + 1}; retrying if possible`);
        continue;
      }

      const metadata = {
        title: defuddled.title || document.title.replace(' - YouTube', ''),
        author: defuddled.author || '',
        published: defuddled.published || '',
        domain: defuddled.domain || 'youtube.com',
        language: defuddled.language || '',
        description: defuddled.description || '',
        word_count: defuddled.wordCount || 0,
        source
      };

      subtitles = parsed;
      videoId = targetVideoId;
      transcriptMarkdown = markdown;
      transcriptMetadata = metadata;
      transcriptDocumentMarkdown = buildTranscriptDocumentMarkdown(metadata, markdown, source);
      completedCaptionKey = `${targetVideoId}|${language}`;
      console.log(`YouTube CC Search: Loaded ${subtitles.length} transcript segments from Defuddle`);
      return captionResponse();
    } catch (error) {
      console.warn(`YouTube CC Search: Caption attempt ${attempt + 1} failed`, error);
    }
  }

  return {
    success: false,
    error: getVideoId() !== targetVideoId
      ? 'The video changed while captions were loading. Please try again.'
      : 'Could not load captions yet. Please try again.'
  };
}

async function fetchCaptions(language = '', force = false) {
  const targetVideoId = getVideoId();
  if (!targetVideoId) {
    return { success: false, error: 'Open a YouTube video to load captions.' };
  }
  if (typeof Defuddle !== 'function') {
    return { success: false, code: 'missing_defuddle', error: 'Caption reader is still initializing.' };
  }

  const normalizedLanguage = typeof language === 'string' ? language.trim() : '';
  const key = `${targetVideoId}|${normalizedLanguage}`;
  if (!force && completedCaptionKey === key && subtitles.length > 0) return captionResponse();
  if (!force && activeCaptionRequest?.key === key) return activeCaptionRequest.promise;

  const requestVersion = ++captionRequestVersion;
  completedCaptionKey = '';
  subtitles = [];
  transcriptMarkdown = '';
  transcriptDocumentMarkdown = '';
  transcriptMetadata = {};

  const promise = loadCaptions(targetVideoId, normalizedLanguage, requestVersion);
  activeCaptionRequest = { key, promise };
  try {
    return await promise;
  } finally {
    if (activeCaptionRequest?.promise === promise) activeCaptionRequest = null;
  }
}

// Setup message listener to handle extension popup requests
function setupMessageListener() {
  // Remove any existing listener to avoid duplicates
  if (messageListener) {
    browser.runtime.onMessage.removeListener(messageListener);
  }
  
  // Create a new listener
  messageListener = function(message, sender, sendResponse) {
    if (message.action === 'getCaptions') {
      return fetchCaptions(message.language, message.force === true).catch((error) => {
        console.error('Error handling getCaptions message:', error);
        return {
          success: false,
          error: 'Could not load captions yet. Please try again.'
        };
      });
    } else if (message.action === 'jumpToTimestamp' && message.timestamp) {
      const video = document.querySelector('video');
      if (video) {
        video.currentTime = message.timestamp;
        video.play();
      }
      return Promise.resolve({ success: true });
    } else if (message.action === 'ping') {
      // Simple ping to check if content script is loaded
      return Promise.resolve({ success: true, initialized: subtitles.length > 0 });
    }
  };
  
  // Add the new listener
  browser.runtime.onMessage.addListener(messageListener);
}

// Start loading when the popup requests captions. This avoids caching an early empty result.
setupMessageListener();

// Inform that content script is loaded
console.log('YouTube CC Search: Content script loaded');
})();
