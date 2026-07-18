chrome.action.onClicked.addListener((tab) => {
  const targetUrl = chrome.runtime.getURL('arcade.html');
  chrome.tabs.query({}, (tabs) => {
    const existingTab = tabs.find(t => t.url === targetUrl);
    if (existingTab) {
      chrome.tabs.update(existingTab.id, { active: true });
      chrome.windows.update(existingTab.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: targetUrl });
    }
  });
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId === 0 && details.error === 'net::ERR_INTERNET_DISCONNECTED') {
    const targetUrl = chrome.runtime.getURL('arcade.html');
    chrome.tabs.query({}, (tabs) => {
      const existingTab = tabs.find(t => t.url === targetUrl);
      if (existingTab) {
        chrome.tabs.update(existingTab.id, { active: true });
        chrome.windows.update(existingTab.windowId, { focused: true });
      } else {
        chrome.tabs.update(details.tabId, { url: targetUrl });
      }
    });
  }
});
