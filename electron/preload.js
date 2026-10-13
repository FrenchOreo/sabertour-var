const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectRecordingFolder: () => ipcRenderer.invoke('select-recording-folder'),
  saveRecordingChunk: (args) => ipcRenderer.invoke('save-recording-chunk', args),
  getRecordingFolder: () => ipcRenderer.invoke('get-recording-folder'),
  readRecordingFile: (filePath) => ipcRenderer.invoke('read-recording-file', filePath),
  getSystemMetrics: () => ipcRenderer.invoke('diag-metrics'),
  appendDiagnostics: (entries) => ipcRenderer.invoke('diag-log', entries),
  exportDiagnostics: () => ipcRenderer.invoke('diag-export'),
  openDiagnosticsFolder: () => ipcRenderer.invoke('diag-open-folder'),
});
