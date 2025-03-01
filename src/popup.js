// src/popup.js

// Open a long-lived popupPort to the background script

document.addEventListener('DOMContentLoaded', () => {
  // Connecting for port messaging
  const popupPort = chrome.runtime.connect({ name: 'popup' });

  console.log('[Popup] - ' + Date.now() + ' - Popup loaded.');
  const screenshotEl = document.getElementById('screenshot');
  const ocrTextEl = document.getElementById('ocrText');
  const classificationEl = document.getElementById('classification');
  const onnxInferenceTimeEl = document.getElementById('onnxInferenceTime');
  const totalTimeEl = document.getElementById('totalTime');
  const toggleButton = document.getElementById('toggleButton');
  const sandboxIframe = document.getElementById('sandboxIframe');
  const ocrTimeEl = document.getElementById('ocrTime');
  const ssProcessingTimeEl = document.getElementById('ssProcessingTime');
  const tokenTimeEl = document.getElementById('tokenTime');

  // Update the toggle button based on stored state.
  chrome.storage.local.get('toggleState', (data) => {
    updateToggleButton(data.toggleState ?? false);
  });

  toggleButton.addEventListener('click', () => {
    chrome.storage.local.get('toggleState', (data) => {
      const newState = !data.toggleState;
      chrome.storage.local.set({ toggleState: newState }, () => {
        updateToggleButton(newState);
        console.log(
          '[Popup] - ' + Date.now() + ' - Toggle state updated:',
          newState,
        );
      });
    });
  });

  function updateToggleButton(isOn) {
    toggleButton.textContent = isOn ? 'ON' : 'OFF';
    toggleButton.className = isOn ? 'on' : 'off';
    console.log('[Popup] - ' + Date.now() + ' - Toggle button updated:', isOn);
  }

  // // Listen for messages from background.js
  // popupPort.onMessage.addListener((message) => {
  //     console.log("Received from background:", message);
  // });

  // setInterval(() => {
  //   console.log("Sending message to background...");
  //   popupPort.postMessage({ greeting: "Hello from popup!" });
  // }, 3000);
});
