// src/popup.js
document.addEventListener("DOMContentLoaded", () => {
  console.log("[Popup] Popup loaded.");
  const screenshotEl = document.getElementById("screenshot");
  const ocrTextEl = document.getElementById("ocrText");
  const classificationEl = document.getElementById("classification");
  const inferenceTimeEl = document.getElementById("inferenceTime");
  const totalTimeEl = document.getElementById("totalTime");
  const toggleButton = document.getElementById("toggleButton");

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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Popup] Message received:", message);
    if (message.type === 'updateResults') {
      if (screenshotEl) screenshotEl.src = message.screenshot;
      if (ocrTextEl) ocrTextEl.textContent = message.ocrText;
      if (classificationEl) classificationEl.textContent = message.classification;
      if (inferenceTimeEl) inferenceTimeEl.textContent = message.inferenceTime + " ms";
    }
    if (message.type === 'totalTime') {
      if (totalTimeEl) totalTimeEl.textContent = message.data + " ms";
      console.log("[Popup] UI updated with new results.");      
    }
  });
});
