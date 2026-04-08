const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectRecordingFolder: () => ipcRenderer.invoke('select-recording-folder'),
  saveRecordingChunk: (args) => ipcRenderer.invoke('save-recording-chunk', args),
  getRecordingFolder: () => ipcRenderer.invoke('get-recording-folder'),
  readRecordingFile: (filePath) => ipcRenderer.invoke('read-recording-file', filePath),
});
