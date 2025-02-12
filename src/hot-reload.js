const filesToWatch = ["background.js", "content.js", "popup.js"];

filesToWatch.forEach((file) => {
  fetch(chrome.runtime.getURL(file))
    .then(response => response.text())
    .then(currentScript => {
      setInterval(() => {
        fetch(chrome.runtime.getURL(file))
          .then(response => response.text())
          .then(newScript => {
            if (newScript !== currentScript) {
              console.log(`[HMR] Reloading ${file}`);
              chrome.runtime.reload();
            }
          });
      }, 1000); // Check for updates every second
    });
});
