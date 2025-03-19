let subtitles = [];
let currentVideoId = '';
let retryCount = 0;
let currentSortOrder = 'score'; // Default sort order
let currentTheme = 'light'; // Default theme
const MAX_RETRIES = 5;
const RETRY_INTERVAL = 2000; // 2 seconds

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  const statusDiv = document.getElementById('status');
  const searchContainer = document.getElementById('search-container');
  const searchInput = document.getElementById('search-input');
  const resultsList = document.getElementById('results-list');
  const sortToggle = document.getElementById('sort-toggle');
  const sortText = document.getElementById('sort-text');
  const themeToggle = document.getElementById('theme-toggle');
  
  // Initialize theme from storage
  initializeTheme();
  
  // Set up theme toggle
  themeToggle.addEventListener('click', toggleTheme);
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    
    if (!currentTab.url.includes('youtube.com/watch')) {
      statusDiv.textContent = 'Please navigate to a YouTube video to use this extension.';
      statusDiv.className = 'message error';
      return;
    }
    
    // Check if content script is loaded properly and request captions
    requestCaptions(currentTab.id, statusDiv, searchContainer, searchInput);
    
    // Set up search functionality
    searchInput.addEventListener('input', debounce(() => {
      const searchTerm = searchInput.value.trim();
      
      if (searchTerm.length < 2) {
        resultsList.innerHTML = '';
        return;
      }
      
      performSearch(searchTerm, resultsList, currentSortOrder);
    }, 300));
    
    // Set up sort toggle button handler
    sortToggle.addEventListener('click', () => {
      // Toggle between 'score' and 'timestamp'
      currentSortOrder = currentSortOrder === 'score' ? 'timestamp' : 'score';
      
      // Update the button text
      sortText.textContent = currentSortOrder.charAt(0).toUpperCase() + currentSortOrder.slice(1);
      
      const searchTerm = searchInput.value.trim();
      
      if (searchTerm.length < 2) {
        return;
      }
      
      performSearch(searchTerm, resultsList, currentSortOrder);
    });
    
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'message error';
  }
});

// Get theme from storage and apply it
async function initializeTheme() {
  try {
    const result = await chrome.storage.local.get('theme');
    currentTheme = result.theme || 'light';
    applyTheme(currentTheme);
    document.documentElement.setAttribute('data-theme', currentTheme);
  } catch (error) {
    console.error('Error initializing theme:', error);
    // Default to light theme if there's an error
    currentTheme = 'light';
    applyTheme('light');
  }
}

// Toggle between light and dark themes
function toggleTheme() {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(currentTheme);
  saveTheme(currentTheme);
}

// Apply the selected theme
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// Save theme preference to storage
async function saveTheme(theme) {
  try {
    await chrome.storage.local.set({ theme: theme });
  } catch (error) {
    console.error('Error saving theme:', error);
  }
}

// Function to request captions with retry logic
function requestCaptions(tabId, statusDiv, searchContainer, searchInput) {
  const attemptsLeft = MAX_RETRIES - retryCount;
  statusDiv.textContent = retryCount > 0 
    ? `Loading captions... (${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left)`
    : 'Loading captions...';
  statusDiv.className = 'message loading';
  
  chrome.tabs.sendMessage(
    tabId, 
    { action: 'getCaptions' },
    (response) => {
      // Handle connection error
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        injectContentScriptAndRetry(tabId, statusDiv, searchContainer, searchInput);
        return;
      }
      
      if (!response) {
        statusDiv.textContent = 'Extension not loaded properly. Try refreshing the page.';
        statusDiv.className = 'message error';
        return;
      }
      
      if (!response.success) {
        handleCaptionError(tabId, statusDiv, searchContainer, searchInput, response);
        return;
      }
      
      subtitles = response.subtitles;
      currentVideoId = response.videoId;
      retryCount = 0; // Reset retry count on success
      
      if (subtitles.length === 0) {
        handleEmptyCaptions(tabId, statusDiv, searchContainer, searchInput);
        return;
      }
      
      // Show search interface
      statusDiv.innerHTML = `Loaded captions for: <b>${response.videoTitle}</b>`;
      statusDiv.className = 'message success';
      searchContainer.style.display = 'block';
      searchInput.focus();
    }
  );
}

// Handle empty captions with retry
function handleEmptyCaptions(tabId, statusDiv, searchContainer, searchInput) {
  if (retryCount < MAX_RETRIES) {
    const attemptsLeft = MAX_RETRIES - retryCount;
    statusDiv.textContent = `No captions found yet. The video may still be loading. Retrying in ${RETRY_INTERVAL/1000} seconds... (${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left)`;
    statusDiv.className = 'message loading';
    retryCount++;
    
    setTimeout(() => {
      requestCaptions(tabId, statusDiv, searchContainer, searchInput);
    }, RETRY_INTERVAL);
  } else {
    statusDiv.textContent = 'No captions found after multiple attempts.\r\nThe video may not have captions available.\r\n\r\nIf the video has captions, click outside the extension and reopen it.';
    statusDiv.className = 'message error';
    retryCount = 0;
  }
}

// Handle caption errors with retry
function handleCaptionError(tabId, statusDiv, searchContainer, searchInput, response) {
  if (retryCount < MAX_RETRIES) {
    const attemptsLeft = MAX_RETRIES - retryCount;
    statusDiv.textContent = `Video or captions still loading. Retrying in ${RETRY_INTERVAL/1000} seconds... (${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left)`;
    statusDiv.className = 'message loading';
    retryCount++;
    
    setTimeout(() => {
      requestCaptions(tabId, statusDiv, searchContainer, searchInput);
    }, RETRY_INTERVAL);
  } else {
    statusDiv.textContent = `Error: ${response.error || 'This video may not have captions available.'}`;
    statusDiv.className = 'message error';
    retryCount = 0;
  }
}

// Function to inject content script and retry connection
function injectContentScriptAndRetry(tabId, statusDiv, searchContainer, searchInput) {
  statusDiv.textContent = 'Initializing extension...';
  statusDiv.className = 'message loading';
  
  // Inject content script
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['content.js']
  })
  .then(() => {
    // Wait a moment for content script to initialize
    setTimeout(() => {
      statusDiv.textContent = 'Extension initialized. Fetching captions...';
      
      // Try to get captions again
      requestCaptions(tabId, statusDiv, searchContainer, searchInput);
    }, 1000);
  })
  .catch(err => {
    console.error('Error injecting content script:', err);
    statusDiv.textContent = 'Failed to initialize extension. Please refresh the page and try again.';
    statusDiv.className = 'message error';
  });
}

// Perform fuzzy search
function performSearch(query, resultsList, sortOrder = 'score') {
  if (!subtitles.length) return;
  
  // Create searchable caption segments with context
  const searchableSegments = createSearchableSegments(subtitles);
  
  // Perform search using fuzzysort
  const results = fuzzysort.go(query, searchableSegments, {
    key: 'text',
    limit: 100, // Increase limit since we'll filter duplicates
    threshold: -10000 // Lower threshold to get more results
  });

  // Deduplicate results based on timestamp proximity
  const deduplicatedResults = deduplicateResults(results);
  
  // Sort results based on selected order
  const sortedResults = sortResults(deduplicatedResults, sortOrder);
  
  // Display results
  resultsList.innerHTML = '';
  
  if (sortedResults.length === 0) {
    resultsList.innerHTML = '<div class="message">No matches found</div>';
    return;
  }
  
  sortedResults.forEach(result => {
    const item = document.createElement('div');
    item.className = 'result-item';
    
    // Format the timestamp MM:SS - still display the original caption's start time
    const timestamp = formatTime(result.obj.contextStart);
    const endingTimestamp = formatTime(result.obj.contextEnd);
    
    // Get the highlighted text - properly use the highlight method from the result
    const highlightedText = result.highlight('<span class="highlight">', '</span>');
    
    // Format score to 2 decimal places
    const score = result.score.toFixed(2);
    
    item.innerHTML = `
      <div class="result-left">
        <div class="timestamp">${timestamp}</div>
        <div class="timestamp">${endingTimestamp}</div>
        <div class="score-label">Match</div>
        <span class="score-value">${score}</span>
      </div>
      <span class="caption-text">${highlightedText || result.obj.text}</span>
    `;
    
    // Add click event to jump to that timestamp in the video
    item.addEventListener('click', () => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        chrome.tabs.sendMessage(
          tabs[0].id, 
          { 
            action: 'jumpToTimestamp', 
            timestamp: result.obj.contextStart
          }
        );
      });
    });
    
    resultsList.appendChild(item);
  });
}

// Sort results based on the selected sorting method
function sortResults(results, sortOrder) {
  if (sortOrder === 'timestamp') {
    // Sort by timestamp (chronological order)
    return [...results].sort((a, b) => a.obj.contextStart - b.obj.contextStart);
  } else {
    // Default - sort by score (already done by deduplicateResults)
    return results;
  }
}

// Function to deduplicate search results based on context overlap
function deduplicateResults(results) {
  if (!results.length) return [];
  
  // Sort results by score first (best matches first)
  const sortedByScore = [...results].sort((a, b) => b.score - a.score);
  
  const deduplicatedResults = [];
  const processedTimeRanges = [];
  
  // Process results in order of relevance (score)
  for (let i = 0; i < sortedByScore.length; i++) {
    const currentResult = sortedByScore[i];
    let isDuplicate = false;
    
    // Check if this result overlaps significantly with any already-selected result
    for (const timeRange of processedTimeRanges) {
      // Calculate overlap between current result and existing result
      const overlapStart = Math.max(currentResult.obj.contextStart, timeRange.start);
      const overlapEnd = Math.min(currentResult.obj.contextEnd, timeRange.end);
      const overlapDuration = Math.max(0, overlapEnd - overlapStart);
      
      // Calculate the percentage of overlap relative to the current result's context duration
      const currentDuration = currentResult.obj.contextEnd - currentResult.obj.contextStart;
      const overlapPercentage = currentDuration > 0 ? (overlapDuration / currentDuration) * 100 : 0;
      
      // If overlap percentage exceeds threshold, consider it a duplicate
      if (overlapPercentage > 50) { // 50% overlap threshold
        isDuplicate = true;
        break;
      }
    }
    
    // If not a duplicate, add to results
    if (!isDuplicate) {
      deduplicatedResults.push(currentResult);
      processedTimeRanges.push({
        start: currentResult.obj.contextStart,
        end: currentResult.obj.contextEnd
      });
      
      // Limit the number of results
      if (deduplicatedResults.length >= 20) {
        break;
      }
    }
  }
  
  return deduplicatedResults;
}

// Create searchable segments with context from the captions
function createSearchableSegments(subtitles) {
  const segments = [];
  const maxContextSize = 5; // Maximum number of captions to include after (increased since we're only looking forward)
  const maxSegmentDuration = 30; // Maximum duration of a segment in seconds
  const maxTimeBetweenCaptions = 5; // Maximum allowed time gap between captions in seconds
  
  // Process each caption with only following context
  for (let i = 0; i < subtitles.length; i++) {
    // Get current caption
    const currentCaption = subtitles[i];
    
    // Extract the primary text from this caption
    const primaryText = currentCaption.text;
    
    // Initialize array to hold context segments
    const afterContext = [];
    
    // Track the start and end time of the context window
    let contextStartTime = currentCaption.start;
    let contextEndTime = currentCaption.end;
    
    // Add following captions for context, respecting time limit
    for (let j = i + 1; j <= Math.min(subtitles.length - 1, i + maxContextSize); j++) {
      // Check if adding this caption would exceed our time limit
      if (subtitles[j].end - contextStartTime > maxSegmentDuration) {
        break;
      }
      
      // Check if the time gap between captions is too large
      const timeGap = subtitles[j].start - contextEndTime;
      if (timeGap > maxTimeBetweenCaptions) {
        break;
      }
      
      afterContext.push(subtitles[j].text);
      contextEndTime = subtitles[j].end;
    }
    
    // Combine all text with proper spacing
    const contextText = [
      primaryText,
      ...afterContext
    ].join(' ');
    
    // Add the segment with its context and expanded time boundaries
    segments.push({
      text: contextText,
      start: currentCaption.start,        // Original start time (for jumping to timestamp)
      end: currentCaption.end,            // Original end time
      contextStart: contextStartTime,     // Start time in the context window
      contextEnd: contextEndTime,         // Latest time in the context window
      originalIndex: i
    });
  }
  
  return segments;
}

// Helper function to debounce input events
function debounce(func, delay) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

// Format time from seconds to MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
