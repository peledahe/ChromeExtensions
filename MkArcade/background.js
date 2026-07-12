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
