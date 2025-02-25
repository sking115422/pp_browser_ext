// src/popup.js
document.addEventListener("DOMContentLoaded", () => {
  console.log("[Popup] Popup loaded.");
  const screenshotEl = document.getElementById("screenshot");
  const ocrTextEl = document.getElementById("ocrText");
  const classificationEl = document.getElementById("classification");
  const inferenceTimeEl = document.getElementById("inferenceTime");
  const totalTimeEl = document.getElementById("totalTime");
  const toggleButton = document.getElementById("toggleButton");
  const sandboxFrame = document.getElementById("sandbox-frame");

  // Update the toggle button based on stored state.
  chrome.storage.local.get("toggleState", (data) => {
    updateToggleButton(data.toggleState ?? false);
  });
  
  toggleButton.addEventListener("click", () => {
    chrome.storage.local.get("toggleState", (data) => {
      const newState = !data.toggleState;
      chrome.storage.local.set({ toggleState: newState }, () => {
        updateToggleButton(newState);
        console.log("[Popup] Toggle state updated:", newState);
      });
    });
  });

  function updateToggleButton(isOn) {
    toggleButton.textContent = isOn ? "ON" : "OFF";
    toggleButton.className = isOn ? "on" : "off";
    console.log("[Popup] Toggle button updated:", isOn);
  }

  // Listen for messages from the background.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Popup] Message received from background:", message);
    if (message.type === 'screenshotCaptured') {
      // Forward screenshot data to the sandbox.
      if (sandboxFrame && sandboxFrame.contentWindow) {
        sandboxFrame.contentWindow.postMessage(message, "*");
      }
    }
    if (message.type === 'totalTime') {
      if (totalTimeEl) totalTimeEl.textContent = message.data + " ms";
      console.log("[Popup] UI updated with total time.");
    }
  });

  // Listen for messages from the sandbox.
  window.addEventListener("message", (event) => {
    console.log("[Popup] Message received from sandbox:", event.data);
    const data = event.data;
    if (data.type === 'updateResults') {
      if (screenshotEl) screenshotEl.src = data.screenshot;
      if (ocrTextEl) ocrTextEl.textContent = data.ocrText;
      if (classificationEl) classificationEl.textContent = data.classification;
      if (inferenceTimeEl) inferenceTimeEl.textContent = data.inferenceTime + " ms";
    }
    if (data.type === 'sandboxLoaded') {
      console.log("[Popup] Sandbox is active:", data.message);
      // Optionally forward this status to the background.
      chrome.runtime.sendMessage(data);
    }
    if (data.type === 'inferenceFinished') {
      if (totalTimeEl) totalTimeEl.textContent = data.data + " ms";
      // Forward inferenceFinished message to the background.
      chrome.runtime.sendMessage(data);
    }
  });
});

