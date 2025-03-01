// src/popup.js
document.addEventListener("DOMContentLoaded", () => {
  console.log("[Popup] Popup loaded.");
  const screenshotEl = document.getElementById("screenshot");
  const classificationEl = document.getElementById("classification");
  const inferenceTimeEl = document.getElementById("inferenceTime");
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
      if (classificationEl) classificationEl.textContent = message.classification;
      if (inferenceTimeEl) inferenceTimeEl.textContent = message.inferenceTime + " ms";
      console.log("[Popup] UI updated with new results.");
    }
  });
});
