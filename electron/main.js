const { app, BrowserWindow, dialog } = require('electron');
const { startServer } = require('./server');
const path = require('path');

let mainWindow = null;
let serverInfo = null;

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
