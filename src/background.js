chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'capture') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, function(dataUrl) {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ screenshot: dataUrl });
      }
    });
    // Return true to indicate that we wish to send a response asynchronously
    return true;
  }
});
