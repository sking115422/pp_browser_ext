// src/popup.js

document.addEventListener('DOMContentLoaded', () => {
  // Connecting for port messaging (if needed for other communication)
  const popupPort = chrome.runtime.connect({ name: 'popup' });

  console.log('[Popup] - ' + Date.now() + ' - Popup loaded.');
  const screenshotEl = document.getElementById('screenshot');
  const phashEl = document.getElementById('phash');
  const hammingDistanceEl = document.getElementById('hammingDistance');
  const ocrTextEl = document.getElementById('ocrText');
  const classificationEl = document.getElementById('classification');
  const methodEl = document.getElementById('method');
  const onnxInferenceTimeEl = document.getElementById('onnxInferenceTime');
  const totalTimeEl = document.getElementById('totalTime');
  const mainToggle = document.getElementById('mainToggle');
  const ocrTimeEl = document.getElementById('ocrTime');
  const ssLoggingToggle = document.getElementById('ssLoggingToggle');
  const performanceLoggingToggle = document.getElementById(
    'performanceLoggingToggle',
  );

  ////// Main Toggle

  // Initialize the main toggle state
  chrome.storage.local.get('mainToggleState', (data) => {
    updateToggleButton(data.mainToggleState ?? false);
  });

  // Event listener for main toggle button
  mainToggle.addEventListener('click', () => {
    chrome.storage.local.get('mainToggleState', (data) => {
      const newState = !data.mainToggleState;
      chrome.storage.local.set({ mainToggleState: newState }, () => {
        updateToggleButton(newState);
        console.log(
          '[Popup] - ' + Date.now() + ' - Toggle state updated:',
          newState,
        );
      });
    });
  });

  // Update function for main toggle
  function updateToggleButton(isOn) {
    mainToggle.textContent = isOn ? 'ON' : 'OFF';
    mainToggle.className = isOn ? 'on' : 'off';
    console.log('[Popup] - ' + Date.now() + ' - Toggle button updated:', isOn);
  }

  ////// SS Logging Toggle

  // Initialize the SS Logging state
  chrome.storage.local.get('ssToggleState', (data) => {
    updateSsLoggingToggle(data.ssToggleState ?? false);
  });

  // Event listener for SS Logging toggle button
  ssLoggingToggle.addEventListener('click', () => {
    chrome.storage.local.get('ssToggleState', (data) => {
      const newState = !data.ssToggleState;
      chrome.storage.local.set({ ssToggleState: newState }, () => {
        updateSsLoggingToggle(newState);
        console.log(
          '[Popup] - ' + Date.now() + ' - SS Logging state updated:',
          newState,
        );
      });
    });
  });

  // Update function for SS Logging toggle
  function updateSsLoggingToggle(isOn) {
    ssLoggingToggle.textContent = isOn ? 'ON' : 'OFF';
    ssLoggingToggle.className = isOn ? 'on' : 'off';
    console.log(
      '[Popup] - ' + Date.now() + ' - SS Logging button updated:',
      isOn,
    );
  }

  ////// Performance Logging

  // Initialize the Performance Logging state
  chrome.storage.local.get('performanceToggleState', (data) => {
    updatePerformanceLoggingToggle(data.performanceToggleState ?? true);
  });

  // Event listener for Performance Logging toggle button
  performanceLoggingToggle.addEventListener('click', () => {
    chrome.storage.local.get('performanceToggleState', (data) => {
      const newState = !data.performanceToggleState;
      chrome.storage.local.set({ performanceToggleState: newState }, () => {
        updatePerformanceLoggingToggle(newState);
        console.log(
          '[Popup] - ' + Date.now() + ' - Performance Logging state updated:',
          newState,
        );
      });
    });
  });

  // Update function for performance Logging toggle
  function updatePerformanceLoggingToggle(isOn) {
    performanceLoggingToggle.textContent = isOn ? 'ON' : 'OFF';
    performanceLoggingToggle.className = isOn ? 'on' : 'off';
    console.log(
      '[Popup] - ' + Date.now() + ' - SS Logging button updated:',
      isOn,
    );
  }

  function formatTime(value) {
    return value !== null && value !== undefined && value !== 'NA'
      ? `${parseInt(value, 10)} ms`
      : 'NA';
  }

  function formatNonTime(value) {
    return value !== null && value !== undefined && value !== 'NA'
      ? value
      : 'NA';
  }

  // On load, read the local data and update the popup UI.
  chrome.storage.local.get(null, (localData) => {
    if (localData) {
      if (localData.resizedDataUrl) {
        screenshotEl.src = formatNonTime(localData.resizedDataUrl);
      }
      if (localData.phash) {
        phashEl.textContent = formatNonTime(localData.phash);
      }
      if (localData.hammingDistance) {
        hammingDistanceEl.textContent = formatNonTime(
          localData.hammingDistance,
        );
      }
      if (localData.ocrText) {
        ocrTextEl.textContent = formatNonTime(localData.ocrText);
      }
      if (localData.classification) {
        classificationEl.textContent = formatNonTime(localData.classification);
      }
      if (localData.method) {
        methodEl.textContent = formatNonTime(localData.method);
      }
      if (localData.ocrTime) {
        ocrTimeEl.textContent = formatTime(localData.ocrTime);
      }
      if (localData.infTime) {
        onnxInferenceTimeEl.textContent = formatTime(localData.infTime);
      }
      if (localData.totalTime) {
        totalTimeEl.textContent = formatTime(localData.totalTime);
      }
    }
  });

  // Listen for changes in local storage to update the UI in real-time.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.resizedDataUrl) {
        screenshotEl.src = formatNonTime(changes.resizedDataUrl.newValue);
      }
      if (changes.phash) {
        phashEl.textContent = formatNonTime(changes.phash.newValue);
      }
      if (changes.hammingDistance) {
        hammingDistanceEl.textContent = formatNonTime(
          changes.hammingDistance.newValue,
        );
      }
      if (changes.ocrText) {
        ocrTextEl.textContent = formatNonTime(changes.ocrText.newValue);
      }
      if (changes.classification) {
        classificationEl.textContent = formatNonTime(
          changes.classification.newValue,
        );
      }
      if (changes.method) {
        methodEl.textContent = formatNonTime(changes.method.newValue);
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
