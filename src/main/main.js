const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, screen, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const { parsePdf, resolveSubject } = require('../parser');

const IS_MAC = process.platform === 'darwin';
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const ICON = path.join(ASSETS, 'icon.png');
const PRELOAD = path.join(__dirname, 'preload.js');
const RENDERER = path.join(__dirname, '..', 'renderer');

let store;
let setupWin = null;
let widgetWin = null;
let tray = null;
let quitting = false;

// Lets tests run against a throwaway data folder.
if (process.env.DDW_USER_DATA) app.setPath('userData', process.env.DDW_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching the app again (e.g. from the Start menu) opens the setup window.
  app.on('second-instance', () => openSetup());
  // macOS: opening the app again from Finder/Launchpad/Dock.
  app.on('activate', () => store && openSetup());
  app.whenReady().then(start);
}

function start() {
  if (process.platform === 'win32') app.setAppUserModelId('com.duedatewidget.app');
  // macOS needs an app menu for Cmd+C/V/Z to work in text fields.
  Menu.setApplicationMenu(IS_MAC ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  store = new Store(app.getPath('userData'));
  createTray();
  registerIpc();
  if (store.get().settings.setupComplete) applyLoginItem(store.get().settings.launchAtLogin);

  if (store.get().settings.setupComplete) createWidget();
  else openSetup();

  powerMonitor.on('resume', () => widgetWin && widgetWin.webContents.send('widget:refresh'));
  scheduleMidnightRefresh();
}

function scheduleMidnightRefresh() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => {
    if (widgetWin) widgetWin.webContents.send('widget:refresh');
    scheduleMidnightRefresh();
  }, next - now);
}

// On macOS the app lives in the menu bar; the Dock icon only shows with the setup window.
function updateDock() {
  if (!IS_MAC || !app.dock) return;
  if (setupWin) app.dock.show();
  else app.dock.hide();
}

function openSetup() {
  if (setupWin) {
    if (setupWin.isMinimized()) setupWin.restore();
    setupWin.focus();
    return;
  }
  setupWin = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: 'Due Date Widget',
    icon: ICON,
    backgroundColor: '#f6f7fb',
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  setupWin.loadFile(path.join(RENDERER, 'setup', 'index.html'));
  updateDock();
  setupWin.on('closed', () => {
    setupWin = null;
    updateDock();
    // Closing setup before it was ever finished leaves nothing to show.
    if (!store.get().settings.setupComplete && !quitting) app.quit();
  });
}

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 360;
  const height = Math.min(560, workArea.height - 48);
  return { width, height, x: workArea.x + workArea.width - width - 24, y: workArea.y + 24 };
}

function boundsOnScreen(b) {
  if (!b) return false;
  return screen.getAllDisplays().some(({ workArea: w }) =>
    b.x < w.x + w.width - 40 && b.x + b.width > w.x + 40 && b.y >= w.y - 10 && b.y < w.y + w.height - 40);
}

function createWidget() {
  if (widgetWin) {
    widgetWin.showInactive();
    return;
  }
  const saved = store.get().settings.widgetBounds;
  const bounds = boundsOnScreen(saved) ? saved : defaultBounds();
  widgetWin = new BrowserWindow({
    ...bounds,
    minWidth: 280,
    minHeight: 220,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: !IS_MAC,
    show: false,
    title: 'Due Date Widget',
    icon: ICON,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  if (IS_MAC) widgetWin.setVisibleOnAllWorkspaces(true);
  widgetWin.loadFile(path.join(RENDERER, 'widget', 'index.html'));
  widgetWin.once('ready-to-show', () => widgetWin.showInactive());

  let saveTimer;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => widgetWin && store.setSettings({ widgetBounds: widgetWin.getBounds() }), 400);
  };
  widgetWin.on('move', saveBounds);
  widgetWin.on('resize', saveBounds);
  widgetWin.on('closed', () => {
    widgetWin = null;
    updateTrayMenu();
  });
  updateTrayMenu();
}

function toggleWidget() {
  if (!store.get().settings.setupComplete) return openSetup();
  if (widgetWin && widgetWin.isVisible()) widgetWin.hide();
  else createWidget();
  updateTrayMenu();
}

function applyLoginItem(enabled) {
  // Only the installed app registers itself; a dev run would point at electron.exe.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!enabled });
}

function openAppearance() {
  if (!store.get().settings.setupComplete) return openSetup();
  createWidget();
  const send = () => widgetWin.webContents.send('widget:appearance');
  if (widgetWin.webContents.isLoading()) widgetWin.webContents.once('did-finish-load', send);
  else send();
  updateTrayMenu();
}

function createTray() {
  // macOS template images adapt to light and dark menu bars.
  const image = IS_MAC
    ? nativeImage.createFromPath(path.join(ASSETS, 'trayTemplate.png'))
    : nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  if (IS_MAC) image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('Due Date Widget');
  tray.on('click', toggleWidget);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray || !store) return;
  const { launchAtLogin } = store.get().settings;
  const visible = !!(widgetWin && widgetWin.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Hide widget' : 'Show widget', click: toggleWidget },
    { label: 'Appearance…', click: openAppearance },
    { label: 'Edit subjects…', click: openSetup },
    { type: 'separator' },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: launchAtLogin,
      click: (mi) => {
        store.setSettings({ launchAtLogin: mi.checked });
        applyLoginItem(mi.checked);
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function broadcast() {
  for (const win of [widgetWin, setupWin]) {
    if (win) win.webContents.send('data:changed', store.get());
  }
}

function registerIpc() {
  ipcMain.handle('data:get', () => store.get());

  ipcMain.handle('pdf:pick', async (e) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Choose subject outlines',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('pdf:parse', async (_e, paths) => {
    const results = [];
    for (const p of paths) {
      try {
        const subject = await parsePdf(fs.readFileSync(p));
        results.push({ ok: true, file: path.basename(p), subject });
      } catch (err) {
        results.push({ ok: false, file: path.basename(p), error: String(err && err.message || err) });
      }
    }
    return results;
  });

  ipcMain.handle('subject:resolve', (_e, subject) => resolveSubject(subject));

  ipcMain.handle('setup:save', (_e, { subjects, items, launchAtLogin }) => {
    store.saveSetup(subjects, items);
    store.setSettings({ launchAtLogin });
    applyLoginItem(launchAtLogin);
    createWidget();
    broadcast();
    updateTrayMenu();
    if (setupWin) setupWin.close();
    return true;
  });

  ipcMain.handle('item:done', (_e, id, done) => {
    store.setDone(id, done);
    broadcast();
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    store.setSettings(patch);
    broadcast();
  });

  ipcMain.handle('setup:open', () => openSetup());
  ipcMain.handle('widget:hide', () => {
    if (widgetWin) widgetWin.hide();
    updateTrayMenu();
  });
}

// Keep running in the tray when every window is closed.
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; });
