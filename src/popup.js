// popup.js
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


  // Message Forwarder: Background.js -> Sandbox.js
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    const sandboxIframe = document.getElementById("sandboxIframe");

    switch (message.type) {

      case "test_bg_2_sb":
        console.log("[Popup] ", message.data);
        sandboxIframe.contentWindow.postMessage({ type: "test_bg_2_sb", data: message.data }, "*");
        break;
      
      case "screenshot":
        console.log("[Popup] Screenshot received. Sending to Sandbox.js");
        sandboxIframe.contentWindow.postMessage({ type: "screenshot", data: message.data }, "*");
        break;

      default:
        console.warn("Unknown message type:", message.type);
    }


    
});

  // Message Forwarder: Background <- Sandbox.js
  window.addEventListener("message", (event) => {

    if (!event.isTrusted) return;

    switch (event.data.type) {

      case "test_sb_2_bg":
        console.log("[Popup] ", event.data.data)
        chrome.runtime.sendMessage({ type: 'test_sb_2_bg', data: event.data.data});
        break;

      case "updateResults":
        if (event.data.type === '') {
          if (screenshotEl) screenshotEl.src = event.data.screenshot;
          if (classificationEl) classificationEl.textContent = event.data.classification;
          if (inferenceTimeEl) inferenceTimeEl.textContent = event.data.inferenceTime + " ms";
          console.log("[Popup] UI updated with new results.");
        }
        break;

      default:
        console.warn("Unknown message type:", event.data.type);


    }
  });
});
