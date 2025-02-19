// import { createWorker } from 'tesseract.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Request a screenshot from the background
  chrome.runtime.sendMessage({ action: 'capture' }, async (response) => {
    if (chrome.runtime.lastError || response.error) {
      const errorMessage = chrome.runtime.lastError?.message || response.error;
      console.error('Error capturing screenshot:', errorMessage);
      document.getElementById('result').innerText = 'Error capturing screenshot: ' + errorMessage;
      return;
    }

    const screenshotDataUrl = response.screenshot;

    console.log(screenshotDataUrl)
  });
});
