let subtitles = [];
let videoId = '';
let isInitialized = false;
let messageListener = null;
let transcriptMarkdown = '';
let transcriptDocumentMarkdown = '';
let transcriptMetadata = {};

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

  for (const line of lines) {
    const sectionMatch = line.match(/^###\s+(.+)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    const transcriptMatch = line.match(/^\*\*(\d{1,2}:\d{2}(?::\d{2})?)\*\*\s*·\s*(.+)$/);
    if (!transcriptMatch) {
      continue;
    }

    const timestamp = transcriptMatch[1];
    const start = parseTimestamp(timestamp);
    if (start === null) {
      continue;
    }

    parsed.push({
      text: transcriptMatch[2].trim(),
      start,
      end: start + 2,
      timestamp,
      section: currentSection
    });
  }

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

async function fetchCaptions() {
  try {
    if (subtitles.length > 0 && transcriptDocumentMarkdown) {
      return;
    }

    videoId = getVideoId();
    if (!videoId) {
      throw new Error('Video ID not found');
    }

    const source = document.URL;
    const defuddle = new Defuddle(document, { url: source });
    const defuddled = await defuddle.parseAsync();

    if (!defuddled) {
      throw new Error('Defuddle did not return transcript data');
    }

    transcriptMarkdown = defuddled.variables?.transcript || '';
    subtitles = parseTranscriptMarkdown(transcriptMarkdown);

    transcriptMetadata = {
      title: defuddled.title || document.title.replace(' - YouTube', ''),
      author: defuddled.author || '',
      published: defuddled.published || '',
      domain: defuddled.domain || 'youtube.com',
      language: defuddled.language || 'en',
      description: defuddled.description || '',
      word_count: defuddled.wordCount || 0,
      source
    };

    transcriptDocumentMarkdown = buildTranscriptDocumentMarkdown(
      transcriptMetadata,
      transcriptMarkdown,
      source
    );

    console.log(`YouTube CC Search: Loaded ${subtitles.length} transcript segments from Defuddle`);

    setupMessageListener();
    isInitialized = true;
  } catch (error) {
    console.error('Error fetching captions:', error);
    isInitialized = true;
    setupMessageListener(error.message);
  }
}

// Setup message listener to handle extension popup requests
function setupMessageListener(errorMessage = null) {
  // Remove any existing listener to avoid duplicates
  if (messageListener) {
    chrome.runtime.onMessage.removeListener(messageListener);
  }
  
  // Create a new listener
  messageListener = function(message, sender, sendResponse) {
    if (message.action === 'getCaptions') {
      if (errorMessage) {
        sendResponse({ 
          success: false, 
          error: errorMessage
        });
      } else {
        sendResponse({
          success: true,
          subtitles,
          videoTitle: transcriptMetadata.title || document.title.replace(' - YouTube', ''),
          videoId,
          transcriptMarkdown,
          transcriptDocumentMarkdown,
          transcriptMetadata
        });
      }
    } else if (message.action === 'jumpToTimestamp' && message.timestamp) {
      const video = document.querySelector('video');
      if (video) {
        video.currentTime = message.timestamp;
        video.play();
      }
      sendResponse({ success: true });
    } else if (message.action === 'ping') {
      // Simple ping to check if content script is loaded
      sendResponse({ success: true, initialized: isInitialized });
    }
    
    return true; // Required for async sendResponse
  };
  
  // Add the new listener
  chrome.runtime.onMessage.addListener(messageListener);
}

// Check if we're on a YouTube video page and initialize
function initializeExtension() {
  if (!isInitialized && 
      window.location.hostname.includes('youtube.com') && 
      window.location.pathname === '/watch') {
    console.log('YouTube CC Search: Initializing extension');
    fetchCaptions();
  }
}

// Setup message listener immediately to respond to ping
setupMessageListener();

// Initialize on page load
if (document.readyState === 'loading') {
  window.addEventListener('load', () => {
    // Add a slight delay to ensure YouTube's player is fully initialized
    setTimeout(initializeExtension, 1500);
  });
} else {
  // Document already loaded, initialize with delay
  setTimeout(initializeExtension, 1500);
}

// Also re-fetch captions when navigating between videos using YouTube's SPA navigation
let lastVideoId = getVideoId();

// Watch for URL changes (YouTube uses History API for navigation)
setInterval(() => {
  const currentVideoId = getVideoId();
  if (currentVideoId && currentVideoId !== lastVideoId) {
    console.log('YouTube CC Search: Video changed, reinitializing');
    lastVideoId = currentVideoId;
    subtitles = []; // Clear existing subtitles
    transcriptMarkdown = '';
    transcriptDocumentMarkdown = '';
    transcriptMetadata = {};
    isInitialized = false; // Reset initialization flag
    setTimeout(initializeExtension, 1500);
  }
}, 1000);

// Export a global function that can be called from the page to force initialization
window.ytCCSearchInit = initializeExtension;

// Inform that content script is loaded
console.log('YouTube CC Search: Content script loaded');
