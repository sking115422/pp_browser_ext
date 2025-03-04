// src/popup.js

document.addEventListener('DOMContentLoaded', () => {
  // Connecting for port messaging (if needed for other communication)
  const popupPort = chrome.runtime.connect({ name: 'popup' });

  console.log('[Popup] - ' + Date.now() + ' - Popup loaded.');
  const screenshotEl = document.getElementById('screenshot');
  const ocrTextEl = document.getElementById('ocrText');
  const classificationEl = document.getElementById('classification');
  const onnxInferenceTimeEl = document.getElementById('onnxInferenceTime');
  const totalTimeEl = document.getElementById('totalTime');
  const toggleButton = document.getElementById('toggleButton');
  const ocrTimeEl = document.getElementById('ocrTime');

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

  function formatTime(value) {
    return value ? `${parseInt(value, 10)} ms` : 'N/A';
  }

  // On load, read the session data and update the popup UI.
  chrome.storage.session.get(null, (sessionData) => {
    if (sessionData) {
      if (sessionData.resizedDataUrl) {
        screenshotEl.src = sessionData.resizedDataUrl;
      }
      if (sessionData.ocrText) {
        ocrTextEl.textContent = sessionData.ocrText;
      }
      if (sessionData.classification) {
        classificationEl.textContent = sessionData.classification;
      }
      if (sessionData.ocrTime) {
        ocrTimeEl.textContent = formatTime(sessionData.ocrTime);
      }
      if (sessionData.infTime) {
        onnxInferenceTimeEl.textContent = formatTime(sessionData.infTime);
      }
      if (sessionData.totalTime) {
        totalTimeEl.textContent = formatTime(sessionData.totalTime);
      }
    }
  });

  // Listen for changes in session storage to update the UI in real-time.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session') {
      if (changes.resizedDataUrl) {
        screenshotEl.src = changes.resizedDataUrl.newValue;
      }
      if (changes.ocrText) {
        ocrTextEl.textContent = changes.ocrText.newValue;
      }
      if (changes.classification) {
        classificationEl.textContent = changes.classification.newValue;
      }
      if (changes.ocrTime) {
        ocrTimeEl.textContent = formatTime(changes.ocrTime.newValue);
      }
      if (changes.infTime) {
        onnxInferenceTimeEl.textContent = formatTime(changes.infTime.newValue);
      }
      if (changes.totalTime) {
        totalTimeEl.textContent = formatTime(changes.totalTime.newValue);
      }
    }
  });
});
