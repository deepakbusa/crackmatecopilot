const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Helper to get the real app directory (works in dev and production)
function getEnvPath() {
  // In production, process.resourcesPath points to the root of the unpacked app
  // In dev, __dirname is fine
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, '.env.production');
  } else {
    return path.join(__dirname, '..', '.env.production');
  }
}

const envPath = getEnvPath();
require('dotenv').config({ path: envPath });
const { BrowserWindow, screen, ipcMain, desktopCapturer, globalShortcut, shell, dialog } = require('electron');
const os = require('os');
const express = require('express');
const axios = require('axios');
const appServer = express();
const isDev = !app.isPackaged; // Dynamically set dev/prod mode
const { autoUpdater } = require('electron-updater');

let mainWindow; // Make mainWindow accessible
let wasFullScreen = false; // Track fullscreen state across toggles

// Remove custom protocol registration and open-url handler

appServer.get('/auth-callback', async (req, res) => {
  const code = req.query.code;

  if (!code) {
    res.send('<h2>Login failed: No code received.</h2>');
    return;
  }

  // Exchange code for access token
  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', null, {
      params: {
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: "http://localhost:3005/auth-callback",
        grant_type: "authorization_code"
      }
    });
    const { access_token } = tokenRes.data;

    if (mainWindow && access_token) {
      mainWindow.webContents.send('google-auth-token', access_token);
      res.send('<h2>Login successful! You can now return to the CrackMate app.</h2>');
    } else {
      res.send('<h2>Login failed: No access token received.</h2>');
    }
  } catch (err) {
    res.send('<h2>Login failed: Error exchanging code for token.</h2>');
  }
});

appServer.listen(3005, () => {
  console.log('Auth callback server running on http://localhost:3005');
});

function createWindow() {
  const { width, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = 600;
  const minHeight = 150;

  const win = new BrowserWindow({
    width: winWidth,
    height: minHeight,
    x: Math.floor((width - winWidth) / 2),
    y: 0,
    resizable: false,
    minHeight: minHeight,
    frame: false, // Make window visible and with frame for debugging
    transparent: true, // Disable transparency for visibility
    alwaysOnTop: true, // Disable always on top for debugging
    skipTaskbar: true, // Show in taskbar
    focusable: false,//low window to be focused
    fullscreenable: true,
    title: "CrackMate",
    icon: path.join(__dirname, 'logo.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow = win;

  win.show();
  //win.focus();

  // Set alwaysOnTop to 'screen-saver' level for maximum persistence
  // win.setAlwaysOnTop(true, 'screen-saver'); // Disabled for visibility

  // Prevent screen capture/screen recording
  win.setContentProtection(false);

  // Handle renderer resize requests
  ipcMain.on('resize-window', (event, { width, height }) => {
    win.setResizable(true);
    win.setSize(width, height);
    win.setResizable(false);
  });

  // Handle window movement requests
  ipcMain.on('move-window', (event, { direction, step }) => {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const [currentX, currentY] = win.getPosition();
    const [winWidth, winHeight] = win.getSize();

    let newX = currentX;
    let newY = currentY;

    switch (direction) {
      case 'up':
        newY -= step;
        break;
      case 'down':
        newY += step;
        break;
      case 'left':
        newX -= step;
        break;
      case 'right':
        newX += step;
        break;
      default:
        break;
    }

    newX = Math.max(0, Math.min(newX, screenWidth - winWidth));
    newY = Math.max(0, Math.min(newY, screenHeight - winHeight));

    win.setPosition(newX, newY);
  });

  // Handle screen capture requests
  ipcMain.handle('capture-screen', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      });
      if (sources.length > 0) {
        return sources[0].thumbnail.toDataURL();
      }
      throw new Error('No screen sources available.');
    } catch (error) {
      console.error('Screen capture failed:', error.message);
      throw new Error(`Failed to capture screen: ${error.message}`);
    }
  });

  // Handle visibility toggle
  ipcMain.on('toggle-visibility', (event, shouldShow) => {
    if (shouldShow) {
      win.show();
      win.focus(); // Ensure window is brought to front
    } else {
      win.hide();
    }
  });

  // Handle external URL opening
  ipcMain.on('open-external', (event, url) => {
    shell.openExternal(url);
  });

  // Handle renderer log messages
  ipcMain.on('renderer-log', (event, message) => {
    console.log('[Renderer]', message);
  });

  // Replace win.loadURL with environment check:
  if (isDev) {
  win.loadURL('http://localhost:3001');
  } else {
    win.loadFile(path.join(__dirname, '../build/index.html'));
  }

  // Register global shortcuts
  app.whenReady().then(() => {
    // Move window shortcuts
    globalShortcut.register('Control+Up', () => {
      win.webContents.send('shortcut', { action: 'moveWindow', direction: 'up' });
    });
    globalShortcut.register('Control+Down', () => {
      win.webContents.send('shortcut', { action: 'moveWindow', direction: 'down' });
    });
    globalShortcut.register('Control+Left', () => {
      win.webContents.send('shortcut', { action: 'moveWindow', direction: 'left' });
    });
    globalShortcut.register('Control+Right', () => {
      win.webContents.send('shortcut', { action: 'moveWindow', direction: 'right' });
    });
    // Screenshot
    globalShortcut.register('Control+H', () => {
      win.webContents.send('shortcut', { action: 'takeScreenshot' });
    });
    // Start over
    globalShortcut.register('Control+G', () => {
      win.webContents.send('shortcut', { action: 'startOver' });
    });
    // Toggle visibility (Ctrl+.)
    globalShortcut.register('Control+.', () => {
      // Stealth mode: Only hide/show the window, do not send any message to renderer or trigger DOM/UI events
      if (win.isVisible()) {
        wasFullScreen = win.isFullScreen(); // Save fullscreen state before hiding
        win.hide();
      } else {
        win.show();
        win.focus();
        if (wasFullScreen) {
          win.setFullScreen(true); // Restore fullscreen if it was previously enabled
        }
      }
    });
    // Quit app (Ctrl+Q)
    globalShortcut.register('Control+Q', () => {
      app.quit();
    });
    // Solve screenshots (Ctrl+Enter)
    globalShortcut.register('Control+Enter', () => {
      win.webContents.send('shortcut', { action: 'solveScreenshots' });
    });
    // Mic toggle (Ctrl+M)
    globalShortcut.register('Control+M', () => {
      win.webContents.send('shortcut', { action: 'toggleMic' });
    });
  });

  // Unregister all shortcuts on quit
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

function sendStatusToWindow(text) {
  if (mainWindow) {
    mainWindow.webContents.send('update-message', text);
  }
  console.log('[AutoUpdate]', text);
}

app.whenReady().then(() => {
  createWindow();
  autoUpdater.checkForUpdatesAndNotify();
});

// Auto-update event handlers

autoUpdater.on('checking-for-update', () => {
  sendStatusToWindow('Checking for update...');
});
autoUpdater.on('update-available', (info) => {
  sendStatusToWindow('Update available. Downloading...');
});
autoUpdater.on('update-not-available', (info) => {
  sendStatusToWindow('You are using the latest version.');
});
autoUpdater.on('error', (err) => {
  sendStatusToWindow('Error in auto-updater: ' + (err == null ? 'unknown' : err.message));
});
autoUpdater.on('download-progress', (progressObj) => {
  let log_message = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent.toFixed(1)}% (${progressObj.transferred}/${progressObj.total})`;
  sendStatusToWindow(log_message);
});
autoUpdater.on('update-downloaded', (info) => {
  sendStatusToWindow('Update downloaded. It will be installed on restart.');
  // Optionally prompt user to restart now
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: 'A new version has been downloaded. Restart now to install?',
      buttons: ['Restart', 'Later']
    }).then(result => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
