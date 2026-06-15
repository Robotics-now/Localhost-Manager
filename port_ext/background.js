// background.js

// Runs when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  console.log("Localhost Manager Pro installed.");
});

// Listen for messages from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPorts") {
    sendResponse({ status: "Background worker is active" });
  }
  return true;
});