let subtitles = [];
let currentVideoId = '';
let currentSortOrder = 'score'; // Default sort order
let currentTheme = 'light'; // Default theme
let transcriptMarkdown = '';
let transcriptDocumentMarkdown = '';
let transcriptMetadata = {};

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  const statusDiv = document.getElementById('status');
  const searchContainer = document.getElementById('search-container');
  const searchInput = document.getElementById('search-input');
  const resultsList = document.getElementById('results-list');
  const sortToggle = document.getElementById('sort-toggle');
  const sortText = document.getElementById('sort-text');
  const themeToggle = document.getElementById('theme-toggle');
  
  // Initialize theme and sort order from storage
  await initializePreferences(sortText);
  
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
    requestCaptions(currentTab.id, statusDiv, searchContainer, searchInput, resultsList);
    
    // Set up search functionality
    searchInput.addEventListener('input', debounce(() => {
      const searchTerm = searchInput.value.trim();
      
      if (searchTerm.length < 2) {
        renderTranscriptList(resultsList, subtitles);
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
      
      // Save the sort order preference
      saveSortOrder(currentSortOrder);
      
      const searchTerm = searchInput.value.trim();
      
      if (searchTerm.length < 2) {
        renderTranscriptList(resultsList, subtitles);
        return;
      }
      
      performSearch(searchTerm, resultsList, currentSortOrder);
    });
    
  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'message error';
  }
});

// Get theme and sort order from storage and apply them
async function initializePreferences(sortText) {
  try {
    const result = await chrome.storage.local.get(['theme', 'sortOrder']);
    
    // Initialize theme
    currentTheme = result.theme || 'light';
    applyTheme(currentTheme);
    document.documentElement.setAttribute('data-theme', currentTheme);
    
    // Initialize sort order
    currentSortOrder = result.sortOrder || 'score';
    if (sortText) {
      sortText.textContent = currentSortOrder.charAt(0).toUpperCase() + currentSortOrder.slice(1);
    }
  } catch (error) {
    console.error('Error initializing preferences:', error);
    // Default to light theme and score sort if there's an error
    currentTheme = 'light';
    currentSortOrder = 'score';
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

// Save sort order preference to storage
async function saveSortOrder(sortOrder) {
  try {
    await chrome.storage.local.set({ sortOrder: sortOrder });
  } catch (error) {
    console.error('Error saving sort order:', error);
  }
}

// Request captions once and wait for the content script to complete Defuddle parsing.
function requestCaptions(tabId, statusDiv, searchContainer, searchInput, resultsList, didBootstrap = false) {
  statusDiv.textContent = 'Loading transcript...';
  statusDiv.className = 'message loading';
  
  chrome.tabs.sendMessage(
    tabId, 
    { action: 'getCaptions' },
    (response) => {
      // Handle connection error
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        if (!didBootstrap) {
          bootstrapContentScriptAndRetry(tabId, statusDiv, searchContainer, searchInput, resultsList);
          return;
        }
        statusDiv.textContent = 'Transcript is not available right now. Please refresh the video page and try again.';
        statusDiv.className = 'message error';
        return;
      }
      
      if (!response) {
        if (!didBootstrap) {
          bootstrapContentScriptAndRetry(tabId, statusDiv, searchContainer, searchInput, resultsList);
          return;
        }
        statusDiv.textContent = 'Extension not loaded properly. Try refreshing the page.';
        statusDiv.className = 'message error';
        return;
      }
      
      if (!response.success) {
        statusDiv.textContent = response.error || 'Transcriptions were not available, or the extension was not able to fetch them.';
        statusDiv.className = 'message error';
        return;
      }
      
      subtitles = response.subtitles;
      currentVideoId = response.videoId;
      transcriptMarkdown = response.transcriptMarkdown || '';
      transcriptDocumentMarkdown = response.transcriptDocumentMarkdown || '';
      transcriptMetadata = response.transcriptMetadata || {};
      
      if (subtitles.length === 0) {
        statusDiv.textContent = 'Transcript not available.';
        statusDiv.className = 'message error';
        return;
      }
      
      // Show search interface - using DOM manipulation instead of innerHTML
      statusDiv.textContent = 'Loaded captions for: ';
      const boldElement = document.createElement('b');
      boldElement.textContent = response.videoTitle;
      statusDiv.appendChild(boldElement);
      statusDiv.className = 'message success';
      searchContainer.style.display = 'block';
      renderTranscriptList(resultsList, subtitles);
      searchInput.focus();
    }
  );
}

function bootstrapContentScriptAndRetry(tabId, statusDiv, searchContainer, searchInput, resultsList) {
  statusDiv.textContent = 'Initializing extension...';
  statusDiv.className = 'message loading';

  chrome.scripting.executeScript({
    target: { tabId },
    files: ['defuddle.js', 'content.js']
  }, () => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      statusDiv.textContent = 'Transcript is not available right now. Please refresh the video page and try again.';
      statusDiv.className = 'message error';
      return;
    }

    requestCaptions(tabId, statusDiv, searchContainer, searchInput, resultsList, true);
  });
}

function renderTranscriptList(resultsList, transcriptSubtitles) {
  // Remove all children safely instead of using innerHTML
  while (resultsList.firstChild) {
    resultsList.removeChild(resultsList.firstChild);
  }

  if (!Array.isArray(transcriptSubtitles) || transcriptSubtitles.length === 0) {
    const noTranscriptMessage = document.createElement('div');
    noTranscriptMessage.className = 'message';
    noTranscriptMessage.textContent = 'Transcript not available.';
    resultsList.appendChild(noTranscriptMessage);
    return;
  }

  let lastSection = '';

  transcriptSubtitles.forEach((segment) => {
    if (segment.section && segment.section !== lastSection) {
      lastSection = segment.section;
      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'transcript-heading';
      sectionHeader.textContent = segment.section;
      resultsList.appendChild(sectionHeader);
    }

    const item = document.createElement('div');
    item.className = 'result-item';

    const resultLeftDiv = document.createElement('div');
    resultLeftDiv.className = 'result-left';

    const timestampStartDiv = document.createElement('div');
    timestampStartDiv.className = 'timestamp';
    timestampStartDiv.textContent = segment.timestamp || formatTime(segment.start);
    resultLeftDiv.appendChild(timestampStartDiv);

    item.appendChild(resultLeftDiv);

    const captionTextSpan = document.createElement('span');
    captionTextSpan.className = 'caption-text';
    captionTextSpan.textContent = segment.text;
    item.appendChild(captionTextSpan);

    item.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(
          tabs[0].id,
          {
            action: 'jumpToTimestamp',
            timestamp: segment.start
          }
        );
      });
    });

    resultsList.appendChild(item);
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
  // Remove all children safely instead of using innerHTML
  while (resultsList.firstChild) {
    resultsList.removeChild(resultsList.firstChild);
  }
  
  if (sortedResults.length === 0) {
    // Replace innerHTML with DOM manipulation
    const noResultsMessage = document.createElement('div');
    noResultsMessage.className = 'message';
    noResultsMessage.textContent = 'No matches found';
    resultsList.appendChild(noResultsMessage);
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
    
    // Create DOM structure instead of using innerHTML
    const resultLeftDiv = document.createElement('div');
    resultLeftDiv.className = 'result-left';
    
    const timestampStartDiv = document.createElement('div');
    timestampStartDiv.className = 'timestamp';
    timestampStartDiv.textContent = timestamp;
    resultLeftDiv.appendChild(timestampStartDiv);
    
    const timestampEndDiv = document.createElement('div');
    timestampEndDiv.className = 'timestamp';
    timestampEndDiv.textContent = endingTimestamp;
    resultLeftDiv.appendChild(timestampEndDiv);
    
    const scoreLabelDiv = document.createElement('div');
    scoreLabelDiv.className = 'score-label';
    scoreLabelDiv.textContent = 'Match';
    resultLeftDiv.appendChild(scoreLabelDiv);
    
    const scoreValueSpan = document.createElement('span');
    scoreValueSpan.className = 'score-value';
    scoreValueSpan.textContent = score;
    resultLeftDiv.appendChild(scoreValueSpan);
    
    item.appendChild(resultLeftDiv);
    
    const captionTextSpan = document.createElement('span');
    captionTextSpan.className = 'caption-text';
    
    // Handle highlighted text differently
    if (highlightedText) {
      // Create a safer way to handle the HTML highlighting
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${highlightedText}</div>`, 'text/html');
      const tempContainer = doc.body.firstChild;
      
      // Move all children from the parsed container to the actual caption text span
      while (tempContainer && tempContainer.firstChild) { 
        captionTextSpan.appendChild(tempContainer.firstChild);
      }
    } else {
      captionTextSpan.textContent = result.obj.text;
    }
    
    item.appendChild(captionTextSpan);
    
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
