// src/content.js

function showDangerModal() {
  console.log('[Content] showDangerModal called');

  // Prevent multiple modals from being created
  if (document.getElementById('dangerModalOverlay')) {
    console.log(
      '[Content] Danger modal already exists. Exiting showDangerModal.',
    );
    return;
  }

  console.log('[Content] Creating modal overlay');

  // Create the overlay covering the entire page
  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'dangerModalOverlay';
  modalOverlay.style.position = 'fixed';
  modalOverlay.style.top = '0';
  modalOverlay.style.left = '0';
  modalOverlay.style.width = '100%';
  modalOverlay.style.height = '100%';
  modalOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
  modalOverlay.style.zIndex = '9999';
  modalOverlay.style.display = 'flex';
  modalOverlay.style.justifyContent = 'center';
  modalOverlay.style.alignItems = 'center';

  // Create the modal container
  const modalContainer = document.createElement('div');
  modalContainer.id = 'dangerModalContainer';
  modalContainer.style.position = 'relative'; // For positioning the close button
  modalContainer.style.backgroundColor = '#fff';
  modalContainer.style.padding = '20px';
  modalContainer.style.borderRadius = '5px';
  modalContainer.style.textAlign = 'center';
  modalContainer.style.width = '300px';

  // Create the X button in the top right as a close option
  const closeButton = document.createElement('button');
  closeButton.textContent = 'X';
  closeButton.style.position = 'absolute';
  closeButton.style.top = '5px';
  closeButton.style.right = '5px';
  closeButton.style.border = 'none';
  closeButton.style.background = 'transparent';
  closeButton.style.fontSize = '16px';
  closeButton.style.cursor = 'pointer';
  closeButton.addEventListener('click', () => {
    console.log('[Content] Close button clicked, removing modal overlay');
    chrome.runtime.sendMessage({ type: 'resumeScans' });
    modalOverlay.remove();
  });
  modalContainer.appendChild(closeButton);

  // Create the warning message
  const message = document.createElement('p');
  message.textContent =
    'Warning: This page may be dangerous. Please consider leaving.';
  modalContainer.appendChild(message);
  console.log('[Content] Warning message added');

  // Create a container for the action buttons
  const buttonsContainer = document.createElement('div');
  buttonsContainer.style.display = 'flex';
  buttonsContainer.style.flexDirection = 'column';
  buttonsContainer.style.gap = '10px';
  buttonsContainer.style.marginTop = '15px';

  // "Ignore Warning" button – closes the modal
  const ignoreButton = document.createElement('button');
  ignoreButton.textContent = 'Ignore Warning';
  ignoreButton.addEventListener('click', () => {
    console.log(
      '[Content] Ignore Warning button clicked, removing modal overlay',
    );
    chrome.runtime.sendMessage({ type: 'resumeScans' });
    modalOverlay.remove();
  });

  // "Return to Safety" button – navigates to Google
  const returnButton = document.createElement('button');
  returnButton.textContent = 'Return to Safety';
  returnButton.addEventListener('click', () => {
    console.log(
      '[Content] Return to Safety button clicked, navigating to https://google.com',
    );
    chrome.runtime.sendMessage({ type: 'resumeScans' });
    window.location.href = 'https://google.com';
  });

  // "Not Malicious" button – manually overrides malicious page classification
  const notMalButton = document.createElement('button');
  notMalButton.textContent = 'Not Malicious';
  notMalButton.addEventListener('click', () => {
    console.log(
      '[Content] Not malicious button clicked, changing classification to benign',
    );
    chrome.storage.local.get(['classification'], (result) => {
      let ts = result.classification.split('_')[1];
      chrome.storage.local.set({ classification: `benign_${ts}` });
    });
    chrome.runtime.sendMessage({ type: 'resumeScans' });
    modalOverlay.remove();
  });

  buttonsContainer.appendChild(ignoreButton);
  buttonsContainer.appendChild(returnButton);
  buttonsContainer.appendChild(notMalButton);

  // Insert buttons container into modal container
  modalContainer.appendChild(buttonsContainer);

  // **New Code: Retrieve and display the screenshot**
  // Create an image element to hold the screenshot.
  const screenshotImg = document.createElement('img');
  screenshotImg.style.width = '224px'; // Resize the image to a width of 224 pixels
  screenshotImg.style.display = 'block';
  screenshotImg.style.margin = '10px auto'; // Center the image horizontally

  // Retrieve the screenshot data URL from storage and, if valid, set it as the source.
  chrome.storage.local.get('dataUrl', (result) => {
    console.log(
      '[Content] dataUrl retrieved from local storage: ',
      result.dataUrl,
    );
    if (result.dataUrl && result.dataUrl !== 'NA') {
      screenshotImg.src = result.dataUrl;
      // Insert the screenshot image into the modal container above the buttons.
      modalContainer.insertBefore(screenshotImg, buttonsContainer);
    } else {
      console.warn(
        '[Content] No valid screenshot data found in local storage.',
      );
    }
  });

  modalOverlay.appendChild(modalContainer);

  // Append the modal overlay to the document body
  document.body.appendChild(modalOverlay);
  console.log('[Content] Modal overlay appended to document.body');
}

// If the DOM is already loaded, run immediately; otherwise, wait for it.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', showDangerModal);
} else {
  showDangerModal();
}
