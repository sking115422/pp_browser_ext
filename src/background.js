// src/background.js
console.log("[Background] Service worker loaded.");

// Message reciever
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  switch (message.type) {

    case "test_sb_2_bg":
      console.log("[Background] ", message.data);
      break;

    default:
      console.warn("Unknown message type:", message.type);
  }
  
});

// Function to capture a screenshot and send it to the popup (or sandbox via the popup)
function captureScreenshotAndSend() {
  console.log("[Background] Attempting to capture screenshot...");
  chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) {
      console.error("[Background] Error capturing screenshot:", chrome.runtime.lastError);
      return;
    }
    console.log("[Background] Screenshot captured. Sending to popup.");
    // Send the screenshot via runtime message.
    chrome.runtime.sendMessage({ type: 'screenshot', data: dataUrl });
  });
}



// Periodically capture screenshots if the extension's toggle is ON.
setInterval(() => {
  chrome.storage.local.get("toggleState", (data) => {
    if (data.toggleState) {

      console.log("[Background] Toggle is ON");

      // chrome.runtime.sendMessage({ type: 'test_bg_2_sb', data: 'This is a test message: background.js -> sandbox.js'});      

      captureScreenshotAndSend();

    } else {
      console.log("[Background] Toggle is OFF");
    }
  });
}, 10000);
