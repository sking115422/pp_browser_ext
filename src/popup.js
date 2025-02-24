document.addEventListener('DOMContentLoaded', () => {
  console.log("Popup loaded");

  // Request a screenshot from the background script
  chrome.runtime.sendMessage({ action: 'capture' }, (response) => {
    console.log("Received response from background:", response);
    if (chrome.runtime.lastError || response.error) {
      const errorMessage = chrome.runtime.lastError?.message || response.error;
      console.error('Error capturing screenshot:', errorMessage);
      document.getElementById('ocr-result').innerText = 'Error: ' + errorMessage;
      return;
    }

    const screenshotDataUrl = response.screenshot;
    console.log("Screenshot data URL obtained");

    // Display the screenshot
    const screenshotContainer = document.getElementById('screenshot-container');
    const imgElement = document.createElement('img');
    imgElement.src = screenshotDataUrl;
    imgElement.style.width = '100%';
    screenshotContainer.appendChild(imgElement);

    // Get the sandbox iframe
    const iframe = document.getElementById('sandbox-frame');
    // If the sandbox is already loaded, send the message immediately.
    if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
      console.log("Sandbox iframe already loaded, sending screenshot for OCR");
      iframe.contentWindow.postMessage({ type: 'ocr', imageDataUrl: screenshotDataUrl }, '*');
    } else {
      // Otherwise, wait for the load event.
      console.log("Waiting for sandbox iframe to load");
      iframe.addEventListener("load", () => {
        console.log("Sandbox iframe loaded, sending screenshot for OCR");
        iframe.contentWindow.postMessage({ type: 'ocr', imageDataUrl: screenshotDataUrl }, '*');
      });
    }
  });
});

// Listen for messages from the sandbox
window.addEventListener('message', (event) => {
  console.log("Received message from sandbox:", event.data);
  if (event.data && event.data.type === 'ocr-result') {
    document.getElementById('ocr-result').innerText = event.data.text;
  }
  if (event.data && event.data.type === 'ocr-error') {
    document.getElementById('ocr-result').innerText = 'Error: ' + event.data.error;
  }
});
