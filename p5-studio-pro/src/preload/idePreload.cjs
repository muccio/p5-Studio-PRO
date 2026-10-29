const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script for the main IDE UI
 * Exposes a secure, typed IPC bridge to the renderer
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // --- System External Browser ---
  system: {
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', url)
  },

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
    getP5Version: () => ipcRenderer.invoke('project:getP5Version'),
    setP5Version: (version) => ipcRenderer.invoke('project:setP5Version', version),
    getP5Libraries: () => ipcRenderer.invoke('project:getP5Libraries'),
    toggleP5Library: (libId, enabled) => ipcRenderer.invoke('project:toggleP5Library', { libId, enabled }),
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

  // --- Live Stage Output Window ---
  live: {
    open: (options) => ipcRenderer.invoke('live:open', options),
    close: () => ipcRenderer.invoke('live:close'),
    toggle: (options) => ipcRenderer.invoke('live:toggle', options),
    getStatus: () => ipcRenderer.invoke('live:getStatus'),
    getDisplays: () => ipcRenderer.invoke('live:getDisplays'),
    moveToDisplay: (displayId, fullscreen) => ipcRenderer.invoke('live:moveToDisplay', { displayId, fullscreen }),
    toggleFullscreen: () => ipcRenderer.invoke('live:toggleFullscreen'),
    exitFullscreen: () => ipcRenderer.invoke('live:exitFullscreen'),
    toggleAlwaysOnTop: () => ipcRenderer.invoke('live:toggleAlwaysOnTop'),
    pushStage: () => ipcRenderer.invoke('live:pushStage'),
    reload: () => ipcRenderer.invoke('live:reload'),
    notifyShaderHotReload: () => ipcRenderer.invoke('live:notifyShaderHotReload'),
    onStatusChanged: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('live:statusChanged', listener);
      return () => ipcRenderer.removeListener('live:statusChanged', listener);
    },
    onDisplaysChanged: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('displays:changed', listener);
      return () => ipcRenderer.removeListener('displays:changed', listener);
    }
  },

  // --- Separate / Popout Preview Window ---
  preview: {
    open: () => ipcRenderer.invoke('preview:open'),
    close: () => ipcRenderer.invoke('preview:close'),
    toggle: () => ipcRenderer.invoke('preview:toggle'),
    toggleFullscreen: () => ipcRenderer.invoke('preview:toggleFullscreen'),
    exitFullscreen: () => ipcRenderer.invoke('preview:exitFullscreen'),
    getStatus: () => ipcRenderer.invoke('preview:getStatus'),
    reload: () => ipcRenderer.invoke('preview:reload'),
    notifyShaderHotReload: () => ipcRenderer.invoke('preview:notifyShaderHotReload'),
    onStatusChanged: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('preview:statusChanged', listener);
      return () => ipcRenderer.removeListener('preview:statusChanged', listener);
    },
    onShaderDiagnostics: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('shader:diagnostics', listener);
      return () => ipcRenderer.removeListener('shader:diagnostics', listener);
    },
    onShaderSuccess: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('shader:success', listener);
      return () => ipcRenderer.removeListener('shader:success', listener);
    }
  },

  // --- Deterministic Video Export ---
  export: {
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options),
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
