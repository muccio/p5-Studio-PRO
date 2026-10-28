const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script for the main IDE UI
 * Exposes a secure, typed IPC bridge to the renderer
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Window Controls ---
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },

  // --- Project Management ---
  project: {
    getInfo: () => ipcRenderer.invoke('project:getInfo'),
    openFolder: () => ipcRenderer.invoke('project:openFolder'),
    listFiles: () => ipcRenderer.invoke('project:listFiles'),
    readFile: (relativePath) => ipcRenderer.invoke('project:readFile', relativePath),
    writeFile: (relativePath, content) => ipcRenderer.invoke('project:writeFile', { relativePath, content }),
    createItem: (relativePath, type) => ipcRenderer.invoke('project:createItem', { relativePath, type }),
    deleteItem: (relativePath) => ipcRenderer.invoke('project:deleteItem', relativePath),
    renameItem: (oldPath, newPath) => ipcRenderer.invoke('project:renameItem', { oldPath, newPath }),
    loadShader: (filePath) => ipcRenderer.invoke('project:loadShader', { filePath }),
    mapCompilerErrors: (infoLog, sourceTable) => ipcRenderer.invoke('project:mapCompilerErrors', { infoLog, sourceTable }),
    onFileChanged: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('project:fileChanged', listener);
      return () => ipcRenderer.removeListener('project:fileChanged', listener);
    }
  },

  // --- OSC Bridge ---
  osc: {
    getStatus: () => ipcRenderer.invoke('osc:getStatus'),
    updateConfig: (config) => ipcRenderer.invoke('osc:updateConfig', config),
    send: (address, ...args) => ipcRenderer.invoke('osc:send', { address, args }),
    startRecordTake: (takeName) => ipcRenderer.invoke('osc:startRecordTake', { takeName }),
    stopRecordTake: () => ipcRenderer.invoke('osc:stopRecordTake'),
    onMessage: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('osc:message', listener);
      return () => ipcRenderer.removeListener('osc:message', listener);
    }
  },

  // --- Audio Take Recorder ---
  audio: {
    saveTakeWav: (takeDir, channelData, sampleRate) =>
      ipcRenderer.invoke('audio:saveTakeWav', { takeDir, channelData, sampleRate })
  },

  // --- Deterministic Video Export ---
  export: {
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
    start: (options) => ipcRenderer.invoke('export:start', options),
    cancel: () => ipcRenderer.invoke('export:cancel'),
    onProgress: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('export:progress', listener);
      return () => ipcRenderer.removeListener('export:progress', listener);
    },
    onComplete: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('export:complete', listener);
      return () => ipcRenderer.removeListener('export:complete', listener);
    },
    onError: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('export:error', listener);
      return () => ipcRenderer.removeListener('export:error', listener);
    }
  }
});
