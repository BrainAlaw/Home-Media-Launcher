'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Read-only bridge for the exit overlay window: main pushes { name, progress } while the Guide button is held.
contextBridge.exposeInMainWorld('exitOverlay', {
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('exit-overlay:state', listener);
    return () => ipcRenderer.removeListener('exit-overlay:state', listener);
  }
});
