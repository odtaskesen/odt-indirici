const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const tools = require('./tools');
const instagram = require('./instagram');
const gallerydl = require('./gallerydl');
const { Queue } = require('./queue');
const updater = require('./updater');

let win = null;
let queue = null;
let settings = { outDir: '', format: 'mp4', igUser: null };
let updateInfo = null; // { version, url } yeni sürüm varsa
let toolsState = { ready: false, text: 'Araçlar kontrol ediliyor…', received: 0, total: 0, error: null };

const userData = () => app.getPath('userData');
const binDir = () => path.join(userData(), 'bin');
const settingsFile = () => path.join(userData(), 'settings.json');
const stateFile = () => path.join(userData(), 'tools-state.json');
const gdlConfigFile = () => path.join(userData(), 'gallery-dl.json');

function loadSettings() {
  const defaults = { outDir: app.getPath('downloads'), format: 'mp4', igUser: null };
  try {
    settings = { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = defaults;
  }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {}
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

function setToolsState(patch) {
  toolsState = { ...toolsState, ...patch };
  send('tools:status', toolsState);
}

async function igStatus() {
  const loggedIn = await instagram.isLoggedIn();
  if (loggedIn && !settings.igUser) {
    settings.igUser = await instagram.getUsername();
    if (settings.igUser) saveSettings();
  }
  if (!loggedIn && settings.igUser) { settings.igUser = null; saveSettings(); }
  return { loggedIn, username: loggedIn ? settings.igUser : null };
}
async function pushIgStatus() { send('ig:status', await igStatus()); }

async function prepareTools() {
  try {
    await gallerydl.writeConfig(gdlConfigFile());
    const r = await tools.ensureTools(binDir(), (s) => setToolsState({ ready: false, error: null, text: s.text, received: s.received || 0, total: s.total || 0 }));
    if (r.installed.includes('gallery-dl')) await tools.recordGdlTag(stateFile());
    setToolsState({ ready: true, text: '', error: null });
    scheduleToolUpdates();
  } catch (e) {
    setToolsState({ ready: false, error: 'Araçlar indirilemedi: ' + String(e.message || e).slice(0, 200) + ' — İnternet bağlantını kontrol edip “Tekrar dene”ye bas.', text: '' });
  }
}

let updateTimer = null;
function scheduleToolUpdates() {
  const run = () => tools.updateTools(binDir(), stateFile(), { canRun: () => !queue.busy }).catch(() => {});
  run();
  if (!updateTimer) updateTimer = setInterval(run, 6 * 3600 * 1000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 780,
    height: 780,
    minWidth: 560,
    minHeight: 560,
    title: 'ODT İndirici',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

function registerIpc() {
  ipcMain.handle('state:get', async () => {
    const ig = await igStatus(); // önce bekle, araç durumunu en son oku (eski anlık görüntü olmasın)
    return {
      version: app.getVersion(),
      settings: { outDir: settings.outDir, format: settings.format },
      tools: toolsState,
      ig,
      jobs: queue.snapshot(),
      update: updateInfo,
    };
  });
  ipcMain.handle('queue:add', (_e, text) => {
    if (!toolsState.ready) return 0;
    return queue.add(String(text || ''));
  });
  ipcMain.handle('queue:cancel', () => queue.cancelAll());
  ipcMain.handle('queue:retry', (_e, id) => queue.retry(Number(id)));
  ipcMain.handle('queue:clear', () => { queue.clearFinished(); return queue.snapshot(); });
  ipcMain.handle('ig:login', async () => {
    const ok = await instagram.promptLogin(win);
    if (ok) settings.igUser = null;
    await pushIgStatus();
    return ok;
  });
  ipcMain.handle('ig:logout', async () => {
    await instagram.logout();
    settings.igUser = null;
    saveSettings();
    await pushIgStatus();
  });
  ipcMain.handle('settings:choose-folder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.outDir });
    if (!r.canceled && r.filePaths[0]) {
      settings.outDir = r.filePaths[0];
      saveSettings();
    }
    return settings.outDir;
  });
  ipcMain.handle('settings:set-format', (_e, format) => {
    settings.format = format === 'best' ? 'best' : 'mp4';
    saveSettings();
    return settings.format;
  });
  ipcMain.handle('folder:open', async () => {
    fs.mkdirSync(settings.outDir, { recursive: true });
    return shell.openPath(settings.outDir);
  });
  ipcMain.handle('file:reveal', (_e, p) => {
    if (typeof p === 'string' && p) shell.showItemInFolder(path.resolve(settings.outDir, p));
  });
  ipcMain.handle('tools:versions', async () => ({ app: app.getVersion(), ...(await tools.getVersions(binDir())) }));
  ipcMain.handle('tools:retry', () => prepareTools());
  ipcMain.handle('update:check', async () => {
    const info = await updater.check(app.getVersion());
    if (info) { updateInfo = info; send('update:available', info); }
    return info;
  });
  ipcMain.handle('update:open', () => { if (updateInfo) shell.openExternal(updateInfo.url); });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(() => {
    loadSettings();
    instagram.setup();
    queue = new Queue({
      binDir: binDir(),
      getOutDir: () => settings.outDir,
      getFormat: () => settings.format,
      configFile: gdlConfigFile(),
      instagram: {
        isLoggedIn: instagram.isLoggedIn,
        promptLogin: async () => {
          const ok = await instagram.promptLogin(win);
          await pushIgStatus();
          return ok;
        },
        resolveShare: instagram.resolveShare,
        makeCookieFile: instagram.makeCookieFile,
      },
      onUpdate: (job) => send('job:update', job),
    });
    registerIpc();
    createWindow();
    updater.start(app.getVersion(), (info) => { updateInfo = info; send('update:available', info); });
    win.webContents.once('did-finish-load', () => prepareTools());
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => app.quit());
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    if (queue && queue.busy) {
      // Alt süreçlerin kapanmasını (en fazla ~3,5 sn) bekle, sonra çık
      e.preventDefault();
      queue.cancelAll();
      const t0 = Date.now();
      const wait = () => {
        if (!queue.busy || Date.now() - t0 > 3500) { instagram.cleanupAllSync(); app.exit(0); }
        else setTimeout(wait, 100);
      };
      wait();
    } else {
      instagram.cleanupAllSync();
    }
  });
}
