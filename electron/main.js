const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { startServer } = require('./server');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let serverInfo = null;
let lastRecordingFolder = null;

// ── IPC Handlers for continuous recording ──

ipcMain.handle('select-recording-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choisir le dossier d\'enregistrement',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  lastRecordingFolder = result.filePaths[0];
  return lastRecordingFolder;
});

ipcMain.handle('save-recording-chunk', async (_event, { folder, slotName, chunkIndex, data, fileName: customFileName }) => {
  const fileName = customFileName || `${slotName}_${chunkIndex}.webm`;
  const filePath = path.join(folder, fileName);
  const buffer = Buffer.from(data);
  await fs.promises.writeFile(filePath, buffer);
  const stat = await fs.promises.stat(filePath);
  return { path: filePath, size: stat.size };
});

ipcMain.handle('get-recording-folder', () => {
  return lastRecordingFolder;
});

ipcMain.handle('read-recording-file', async (_event, filePath) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return { data: buffer, size: buffer.length };
  } catch (err) {
    console.error('[read-recording-file] Error:', err.message);
    return null;
  }
});

async function createWindow() {
  // Start the embedded server first
  try {
    serverInfo = await startServer();
  } catch (err) {
    dialog.showErrorBox('Erreur SABER VAR', `Impossible de démarrer le serveur:\n${err.message}`);
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'SABER VAR',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Ignore self-signed cert errors for our own server
  mainWindow.webContents.session.setCertificateVerifyProc((_request, callback) => {
    callback(0); // 0 = trust
  });

  mainWindow.loadURL(`https://localhost:${serverInfo.port}/setup`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Log the URLs in the console for debugging
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║  SABER VAR — Système VAR actif                    ║');
  console.log('║                                                   ║');
  console.log('║  URLs pour les téléphones :                       ║');
  for (const url of serverInfo.urls) {
    console.log(`║  → ${url.padEnd(45)}║`);
  }
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverInfo?.server) {
    serverInfo.server.close();
  }
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
