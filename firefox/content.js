let subtitles = [];
let videoId = '';
let isInitialized = false;
let messageListener = null;

// Extract video ID from URL
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Format time from seconds to MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Parse the XML captions to text with timestamps
function parseCaptions(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");
  const textElements = xmlDoc.getElementsByTagName('text');
  
  const captionsArray = [];
  
  for (let i = 0; i < textElements.length; i++) {
    const element = textElements[i];
    const text = element.textContent.trim();
    const start = parseFloat(element.getAttribute('start'));
    const duration = parseFloat(element.getAttribute('dur') || "0");
    
    if (text) {
      captionsArray.push({
        text: cleanCaptionText(text),
        start,
        end: start + duration,
        timestamp: formatTime(start)
      });
    }
  }
  
  return captionsArray;
}

// Clean up caption text by removing extra spaces, HTML entities, etc.
function cleanCaptionText(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Get captions URL from YouTube player
async function getCaptionsUrl() {
  try {
    videoId = getVideoId();
    if (!videoId) throw new Error('Video ID not found');
    
    // First try to get captions from the player API
    try {
      // Use a shorter timeout for fetch to avoid hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const playerResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      const html = await playerResponse.text();
      
      // Look for captions in the page source
      const captionMatch = html.match(/"captionTracks":\[(.*?)\]/);
      if (captionMatch) {
        const captionData = JSON.parse(`[${captionMatch[1]}]`);
        
        // First try to find English captions
        let caption = captionData.find(c => 
          c.languageCode === 'en' || 
          c.vssId?.indexOf('.en') > 0
        );
        
        // If no English captions, try auto-generated ones
        if (!caption) {
          caption = captionData.find(c => c.kind === 'asr');
        }
        
        // If still no captions, take the first available one
        if (!caption && captionData.length > 0) {
          caption = captionData[0];
        }
        
        if (caption && caption.baseUrl) return caption.baseUrl;
      }
      
      throw new Error('No caption tracks found in player response');
    } catch (error) {
      console.warn('Error getting captions from player API:', error);
      
      // Fall back to caption API
      return `https://www.youtube.com/api/timedtext?lang=en&v=${videoId}`;
    }
  } catch (error) {
    console.error('Error getting captions URL:', error);
    throw error;
  }
}

// Fetch the captions for the current video
async function fetchCaptions() {
  try {
    // Check if we're already in the process of fetching
    if (subtitles.length > 0) {
      return;
    }
    
    const captionsUrl = await getCaptionsUrl();
    
    // Use a shorter timeout for fetch to avoid hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(captionsUrl, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch captions: ${response.status} ${response.statusText}`);
    }
    
    const captionsXml = await response.text();
    subtitles = parseCaptions(captionsXml);
    console.log(`YouTube CC Search: Loaded ${subtitles.length} captions`);
    
    setupMessageListener();
    isInitialized = true;
    
  } catch (error) {
    console.error('Error fetching captions:', error);
    isInitialized = true; // Mark as initialized even if there's an error
    setupMessageListener(error.message);
  }
}

// Setup message listener to handle extension popup requests
function setupMessageListener(errorMessage = null) {
  // Remove any existing listener to avoid duplicates
  if (messageListener) {
    browser.runtime.onMessage.removeListener(messageListener);
  }
  
  // Create a new listener
  messageListener = function(message, sender, sendResponse) {
    if (message.action === 'getCaptions') {
      if (errorMessage) {
        return Promise.resolve({ 
          success: false, 
          error: errorMessage
        });
      } else {
        return Promise.resolve({ 
          success: true, 
          subtitles, 
          videoTitle: document.title.replace(' - YouTube', ''),
          videoId
        });
      }
    } else if (message.action === 'jumpToTimestamp' && message.timestamp) {
      const video = document.querySelector('video');
      if (video) {
        video.currentTime = message.timestamp;
        video.play();
      }
      return Promise.resolve({ success: true });
    } else if (message.action === 'ping') {
      // Simple ping to check if content script is loaded
      return Promise.resolve({ success: true, initialized: isInitialized });
    }
  };
  
  // Add the new listener
  browser.runtime.onMessage.addListener(messageListener);
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
    isInitialized = false; // Reset initialization flag
    setTimeout(initializeExtension, 1500);
  }
}, 1000);

// Export a global function that can be called from the page to force initialization
window.ytCCSearchInit = initializeExtension;

// Inform that content script is loaded
console.log('YouTube CC Search: Content script loaded');