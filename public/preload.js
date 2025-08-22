const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Expose any APIs here if needed in the future
});

let shortcutListeners = [];

contextBridge.exposeInMainWorld('electron', {
  setSize: (width, height) => {
    ipcRenderer.send('resize-window', { width, height });
  },
  moveWindow: (direction, step) => {
    ipcRenderer.send('move-window', { direction, step });
  },
  saveScreenshot: (dataUrl) => {
    ipcRenderer.send('save-screenshot', dataUrl);
  },
  captureScreen: async () => {
    return await ipcRenderer.invoke('capture-screen');
  },
  toggleVisibility: (shouldShow) => {
    ipcRenderer.send('toggle-visibility', shouldShow);
  },
  onShortcut: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('shortcut', handler);
    shortcutListeners.push({ callback, handler });
  },
  removeShortcutListener: (callback) => {
    const entry = shortcutListeners.find(l => l.callback === callback);
    if (entry) {
      ipcRenderer.removeListener('shortcut', entry.handler);
      shortcutListeners = shortcutListeners.filter(l => l !== entry);
    }
  },
  openExternal: (url) => {
    ipcRenderer.send('open-external', url);
  },
  ipcRenderer: {
    on: (channel, func) => {
      console.log('Preload: Listening for', channel); // Debug log
      ipcRenderer.on(channel, func);
    },
  },
});

contextBridge.exposeInMainWorld('logToMain', (message) => {
  ipcRenderer.send('renderer-log', message);
});