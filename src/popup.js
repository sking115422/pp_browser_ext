document.addEventListener("DOMContentLoaded", () => {
    const toggleButton = document.getElementById("toggleButton");

    // Load saved state
    chrome.storage.local.get("toggleState", (data) => {
        const isOn = data.toggleState ?? false; // Default to OFF
        updateButton(isOn);
    });

    // Click event to toggle state
    toggleButton.addEventListener("click", () => {
        chrome.storage.local.get("toggleState", (data) => {
            const newState = !data.toggleState;
            chrome.storage.local.set({ toggleState: newState }, () => {
                updateButton(newState);
            });
        });
    });

    function updateButton(isOn) {
        toggleButton.textContent = isOn ? "ON" : "OFF";
        toggleButton.className = isOn ? "on" : "off";
    }
});
