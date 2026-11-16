const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('chatbotAPI', {
  getStatus: () => ipcRenderer.invoke('chatbot:getStatus'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('chatbot:toggleAlwaysOnTop'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('chatbot:setAlwaysOnTop', !!flag),
  close: () => ipcRenderer.invoke('chatbot:close'),
  getActiveCode: () => ipcRenderer.invoke('chatbot:getActiveCode'),
  applyCode: (code, mode = 'replace') => ipcRenderer.invoke('chatbot:applyCode', { code, mode }),
  readClipboard: () => clipboard.readText(),
  writeClipboard: (text) => clipboard.writeText(String(text || '')),
  onStatusChanged: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('chatbot:statusChanged', listener);
    return () => ipcRenderer.removeListener('chatbot:statusChanged', listener);
  },
  onActiveFileChanged: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('chatbot:activeFileChanged', listener);
    return () => ipcRenderer.removeListener('chatbot:activeFileChanged', listener);
  }
});
