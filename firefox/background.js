// Listen for tab updates (navigation events)
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only run on YouTube video pages when they're fully loaded
  if (changeInfo.status === 'complete' && 
      tab.url && 
      tab.url.includes('youtube.com/watch')) {
    
    console.log('YouTube CC Search: Tab updated to YouTube video, checking content script...');
    
    // Check if content script is loaded by sending a ping
    browser.tabs.sendMessage(tabId, { action: 'ping' }).then(response => {
      console.log('YouTube CC Search: Content script already loaded');
    }).catch(error => {
      console.log('YouTube CC Search: Content script not detected, injecting...');
      
      // Inject the content script
      browser.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      })
      .then(() => {
        console.log('YouTube CC Search: Content script injected successfully');
      })
      .catch(err => {
        console.error('YouTube CC Search: Failed to inject content script:', err);
      });
    });
  }
});
