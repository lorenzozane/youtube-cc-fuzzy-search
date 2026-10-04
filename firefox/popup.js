let subtitles = [];
let currentVideoId = '';
let currentSortOrder = 'score'; // Default sort order
let currentTheme = 'light'; // Default theme
let transcriptMarkdown = '';
let transcriptDocumentMarkdown = '';
let transcriptMetadata = {};
let currentLanguage = '';
let aggregateSegments = false;
let captionRequestSequence = 0;
let captionSlowTimer;
let captionDeadlineTimer;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  const statusDiv = document.getElementById('status');
  const searchContainer = document.getElementById('search-container');
  const searchInput = document.getElementById('search-input');
  const resultsList = document.getElementById('results-list');
  const sortToggle = document.getElementById('sort-toggle');
  const sortText = document.getElementById('sort-text');
  const themeToggle = document.getElementById('theme-toggle');
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsPage = document.getElementById('settings-page');
  const transcriptPage = document.getElementById('transcript-page');
  const settingsBack = document.getElementById('settings-back');
  const aggregateCheckbox = document.getElementById('aggregate-segments');
  const languageSelect = document.getElementById('language-select');
  const retryButton = document.getElementById('retry-button');
  let activeVideoTabId = null;
  
  // Initialize theme and sort order from storage
  await initializePreferences(sortText, languageSelect, aggregateCheckbox);
  
  // Set up theme toggle
  themeToggle.addEventListener('click', toggleTheme);

  const setSettingsOpen = (open) => {
    settingsPage.hidden = !open;
    transcriptPage.hidden = open;
    settingsToggle.setAttribute('aria-expanded', String(open));
    if (open) settingsBack.focus();
    else settingsToggle.focus();
  };
  settingsToggle.addEventListener('click', () => setSettingsOpen(settingsPage.hidden));
  settingsBack.addEventListener('click', () => setSettingsOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !settingsPage.hidden && event.target !== languageSelect) {
      event.preventDefault();
      setSettingsOpen(false);
    }
  });
  languageSelect.addEventListener('change', () => {
    currentLanguage = languageSelect.value;
    saveLanguagePreference(currentLanguage);
    if (activeVideoTabId !== null) {
      requestCaptions(activeVideoTabId, statusDiv, searchContainer, searchInput, resultsList);
    }
  });
  aggregateCheckbox.addEventListener('change', () => {
    aggregateSegments = aggregateCheckbox.checked;
    saveAggregationPreference(aggregateSegments);
    if (activeVideoTabId !== null) {
      requestCaptions(activeVideoTabId, statusDiv, searchContainer, searchInput, resultsList);
    }
  });
  
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    
    if (!currentTab.url.includes('youtube.com/watch')) {
      statusDiv.textContent = 'Please navigate to a YouTube video to use this extension.';
      statusDiv.className = 'message error';
      return;
    }

    activeVideoTabId = currentTab.id;
    
    // Check if content script is loaded properly and request captions
    requestCaptions(currentTab.id, statusDiv, searchContainer, searchInput, resultsList);

    retryButton.addEventListener('click', () => {
      requestCaptions(currentTab.id, statusDiv, searchContainer, searchInput, resultsList, false, true);
    });
    
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

// Get saved popup preferences and apply them
async function initializePreferences(sortText, languageSelect, aggregateCheckbox) {
  try {
    const result = await browser.storage.local.get(['theme', 'sortOrder', 'captionLanguage', 'aggregateSegments']);
    
    // Initialize theme
    currentTheme = result.theme || 'light';
    applyTheme(currentTheme);
    document.documentElement.setAttribute('data-theme', currentTheme);
    
    // Initialize sort order
    currentSortOrder = result.sortOrder || 'score';
    if (sortText) {
      sortText.textContent = currentSortOrder.charAt(0).toUpperCase() + currentSortOrder.slice(1);
    }

    aggregateSegments = result.aggregateSegments === true;
    aggregateCheckbox.checked = aggregateSegments;
    currentLanguage = result.captionLanguage || '';
    if (Array.from(languageSelect.options).some(option => option.value === currentLanguage)) {
      languageSelect.value = currentLanguage;
    } else {
      currentLanguage = '';
    }
  } catch (error) {
    console.error('Error initializing preferences:', error);
    // Default to light theme and score sort if there's an error
    currentTheme = 'light';
    currentSortOrder = 'score';
    currentLanguage = '';
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
    await browser.storage.local.set({ theme: theme });
  } catch (error) {
    console.error('Error saving theme:', error);
  }
}

// Save sort order preference to storage
async function saveSortOrder(sortOrder) {
  try {
    await browser.storage.local.set({ sortOrder: sortOrder });
  } catch (error) {
    console.error('Error saving sort order:', error);
  }
}

async function saveLanguagePreference(language) {
  try {
    await browser.storage.local.set({ captionLanguage: language });
  } catch (error) {
    console.error('Error saving caption language:', error);
  }
}

function showCaptionError(statusDiv, searchContainer, message) {
  statusDiv.textContent = message;
  statusDiv.className = 'message error';
  searchContainer.style.display = 'none';
  document.getElementById('retry-button').hidden = false;
}

async function saveAggregationPreference(aggregate) {
  try {
    await browser.storage.local.set({ aggregateSegments: aggregate });
  } catch (error) {
    console.error('Error saving segment preference:', error);
  }
}

function displayLoadedLanguage(language) {
  if (!language) return '';
  try {
    return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(language) || language;
  } catch {
    return language;
  }
}

function clearCaptionLoadingTimers() {
  clearTimeout(captionSlowTimer);
  clearTimeout(captionDeadlineTimer);
}

function armCaptionLoadingTimers(statusDiv, searchContainer, requestSequence) {
  clearCaptionLoadingTimers();
  captionSlowTimer = setTimeout(() => {
    if (requestSequence !== captionRequestSequence) return;
    statusDiv.textContent = 'YouTube is taking longer to load captions. Still trying…';
    document.getElementById('retry-button').hidden = false;
  }, 5000);
  // Also cover a content script or injection that never replies.
  captionDeadlineTimer = setTimeout(() => {
    if (requestSequence !== captionRequestSequence) return;
    captionRequestSequence++;
    clearCaptionLoadingTimers();
    showCaptionError(statusDiv, searchContainer, 'YouTube took too long to load captions. Please try again.');
  }, 35000);
}

function requestCaptions(tabId, statusDiv, searchContainer, searchInput, resultsList, didBootstrap = false, force = false) {
  const requestSequence = ++captionRequestSequence;
  subtitles = [];
  searchContainer.style.display = 'none';
  document.getElementById('retry-button').hidden = true;
  statusDiv.textContent = 'Checking captions...';
  statusDiv.className = 'message loading';
  armCaptionLoadingTimers(statusDiv, searchContainer, requestSequence);
  
  browser.tabs.sendMessage(
    tabId, 
    { action: 'getCaptions', language: currentLanguage, preserveTranscriptSegments: !aggregateSegments, force }
  ).then(response => {
    if (requestSequence !== captionRequestSequence) return;
    clearCaptionLoadingTimers();
    if (!response) {
      if (!didBootstrap) {
        bootstrapContentScriptAndRetry(tabId, statusDiv, searchContainer, searchInput, resultsList, requestSequence, force);
        return;
      }
      showCaptionError(statusDiv, searchContainer, 'Could not connect to this video. Please try again.');
      return;
    }
    
    if (!response.success) {
      if (response.code === 'missing_defuddle' && !didBootstrap) {
        bootstrapContentScriptAndRetry(tabId, statusDiv, searchContainer, searchInput, resultsList, requestSequence, force);
        return;
      }
      showCaptionError(statusDiv, searchContainer, response.error || 'Could not load captions yet. Please try again.');
      return;
    }
    
    subtitles = response.subtitles;
    currentVideoId = response.videoId;
    transcriptMarkdown = response.transcriptMarkdown || '';
    transcriptDocumentMarkdown = response.transcriptDocumentMarkdown || '';
    transcriptMetadata = response.transcriptMetadata || {};
    
    if (subtitles.length === 0) {
      showCaptionError(statusDiv, searchContainer, 'Could not load captions yet. Please try again.');
      return;
    }
    
    document.getElementById('retry-button').hidden = true;
    // Show search interface - using DOM manipulation instead of innerHTML
    const loadedLanguage = displayLoadedLanguage(transcriptMetadata.language);
    statusDiv.textContent = loadedLanguage ? `Loaded ${loadedLanguage} captions for: ` : 'Loaded captions for: ';
    const boldElement = document.createElement('b');
    boldElement.textContent = response.videoTitle;
    statusDiv.appendChild(boldElement);
    statusDiv.className = 'message success';
    searchContainer.style.display = 'block';
    const query = searchInput.value.trim();
    if (query.length < 2) renderTranscriptList(resultsList, subtitles);
    else performSearch(query, resultsList, currentSortOrder);
    if (document.getElementById('settings-page').hidden) searchInput.focus();
  }).catch(error => {
    if (requestSequence !== captionRequestSequence) return;
    clearCaptionLoadingTimers();
    console.error(error);
    if (!didBootstrap) {
      bootstrapContentScriptAndRetry(tabId, statusDiv, searchContainer, searchInput, resultsList, requestSequence, force);
      return;
    }
    showCaptionError(statusDiv, searchContainer, 'Could not connect to this video. Please try again.');
  });
}

function bootstrapContentScriptAndRetry(tabId, statusDiv, searchContainer, searchInput, resultsList, requestSequence, force) {
  statusDiv.textContent = 'Initializing extension...';
  statusDiv.className = 'message loading';
  armCaptionLoadingTimers(statusDiv, searchContainer, requestSequence);

  browser.scripting.executeScript({
    target: { tabId },
    files: ['defuddle.js', 'content.js']
  }).then(() => {
    if (requestSequence !== captionRequestSequence) return;
    clearCaptionLoadingTimers();
    requestCaptions(tabId, statusDiv, searchContainer, searchInput, resultsList, true, force);
  }).catch((error) => {
    if (requestSequence !== captionRequestSequence) return;
    clearCaptionLoadingTimers();
    console.error(error);
    showCaptionError(statusDiv, searchContainer, 'Could not initialize captions. Please try again.');
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
      browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        browser.tabs.sendMessage(
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
  const deduplicatedResults = aggregateSegments ? deduplicateResults(results) : [...results].slice(0, 20);
  
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
      browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
        browser.tabs.sendMessage(
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

// Search exactly the segments returned by Defuddle in either mode.
function createSearchableSegments(subtitles) {
  return subtitles.map((caption, originalIndex) => ({
    text: caption.text,
    start: caption.start,
    end: caption.end,
    contextStart: caption.start,
    contextEnd: caption.end,
    originalIndex
  }));
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
