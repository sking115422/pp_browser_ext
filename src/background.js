chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);
  if (message.action === 'capture') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, function(dataUrl) {
      if (chrome.runtime.lastError || !dataUrl) {
        console.error("Error capturing screenshot:", chrome.runtime.lastError);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        console.log("Screenshot captured successfully");
        sendResponse({ screenshot: dataUrl });
      }
    });
    // Keep the message channel open for async response
    return true;
  }
});
