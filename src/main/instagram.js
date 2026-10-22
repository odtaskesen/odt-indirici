// Instagram oturumu: giriş penceresi, geçici cookies.txt, /share/ çözümü.
// Şifre hiçbir zaman görülmez; sadece Electron'un kendi oturum deposundaki çerezler kullanılır.
const { BrowserWindow, session } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PARTITION = 'persist:instagram';
const LOGIN_URL = 'https://www.instagram.com/accounts/login/';
const activeDirs = new Set(); // uygulama kapanırken silinecek geçici klasörler

function ses() { return session.fromPartition(PARTITION); }

// Electron'un varsayılanından "Electron/x" ve uygulama adı çıkarılmış, düz Chrome UA'sı
function chromeUserAgent() {
  const major = String(process.versions.chrome || '130').split('.')[0];
  const platform = process.platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : 'Macintosh; Intel Mac OS X 10_15_7';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function setup() {
  ses().setUserAgent(chromeUserAgent());
}

async function getCookies() {
  return ses().cookies.get({ domain: 'instagram.com' });
}

async function isLoggedIn() {
  const cs = await ses().cookies.get({ name: 'sessionid' });
  return cs.some((c) => c.domain.endsWith('instagram.com') && c.value);
}

// Giriş penceresi; sessionid oluşunca kapanır. true: giriş yapıldı
let loginPromise = null;
function promptLogin(parent) {
  if (loginPromise) return loginPromise;
  loginPromise = new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 760,
      parent: parent || undefined,
      modal: false,
      title: 'Instagram’a giriş yap',
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    let finished = false;
    const finish = (ok) => {
      if (finished) return;
      finished = true;
      ses().cookies.removeListener('changed', onChanged);
      clearInterval(poll);
      if (!win.isDestroyed()) win.destroy();
      loginPromise = null;
      resolve(ok);
    };
    const check = async () => {
      if (await isLoggedIn()) {
        // diğer çerezlerin (ds_user_id, csrftoken) yazılması için kısa bekle
        setTimeout(() => finish(true), 1500);
      }
    };
    const onChanged = (_e, cookie, _cause, removed) => {
      if (!removed && cookie.name === 'sessionid' && cookie.domain.endsWith('instagram.com')) check();
    };
    ses().cookies.on('changed', onChanged);
    const poll = setInterval(check, 2000);

    // Açılır pencereler aynı pencerede açılır (sadece instagram), diğerleri reddedilir
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/([a-z0-9-]+\.)*(instagram|facebook)\.com\//i.test(url)) win.loadURL(url);
      return { action: 'deny' };
    });
    win.on('closed', () => finish(false));
    win.loadURL(LOGIN_URL, { userAgent: chromeUserAgent() });
  });
  return loginPromise;
}

// Netscape cookies.txt: izin 600, kendi geçici klasöründe. cleanup() siler.
// #HttpOnly_ öneki KULLANILMAZ (bazı okuyucular '#'yi yorum sayıp sessionid'i atlar).
async function makeCookieFile() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'odt-ig-'));
  activeDirs.add(dir);
  await fsp.chmod(dir, 0o700).catch(() => {});
  const file = path.join(dir, 'cookies.txt');
  const cookies = await getCookies();
  const clean = (s) => String(s).replace(/[\t\r\n]/g, '');
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    const domain = c.domain.startsWith('.') ? c.domain : '.' + c.domain.replace(/^www\./, '');
    const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    lines.push([
      clean(domain), 'TRUE', clean(c.path || '/'), c.secure ? 'TRUE' : 'FALSE', expiry, clean(c.name), clean(c.value),
    ].join('\t'));
  }
  await fsp.writeFile(file, lines.join('\n') + '\n', { mode: 0o600 });
  await fsp.chmod(file, 0o600).catch(() => {});
  return {
    file,
    cleanup: async () => { activeDirs.delete(dir); await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); },
  };
}

// instagram.com/share/... -> gerçek /p/ veya /reel/ adresi (IG oturumuyla)
async function resolveShare(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await ses().fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': chromeUserAgent() } });
    clearTimeout(timer);
    let final = res.url || '';
    // Giriş sayfasına düştüyse gerçek adres next= içinde olabilir
    try {
      const u = new URL(final);
      if (/\/accounts\/login/.test(u.pathname) && u.searchParams.get('next')) {
        final = new URL(u.searchParams.get('next'), 'https://www.instagram.com').toString();
      }
    } catch {}
    return /instagram\.com\/(?:[^/]+\/)?(p|reel|reels|tv)\/[\w-]+/i.test(final) ? final : null;
  } catch {
    return null;
  }
}

// En iyi çaba: kullanıcı adını bul (en fazla 5 sn). Bulunamazsa null.
async function getUsername() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await ses().fetch('https://www.instagram.com/api/v1/accounts/current_user/?edit=true', {
      signal: ctrl.signal,
      headers: { 'User-Agent': chromeUserAgent(), 'X-IG-App-ID': '936619743392459' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      if (j && j.user && j.user.username) return j.user.username;
    } catch {}
    // Instagram bu adresi bazen HTML döndürüyor; giriş yapan kullanıcının adı içinde geçiyor
    const m = text.match(/"username":"([A-Za-z0-9._]{1,30})"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function cleanupAllSync() {
  for (const d of activeDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  activeDirs.clear();
}

async function logout() {
  const s = ses();
  await s.clearStorageData();
  await s.clearCache().catch(() => {});
  const cs = await s.cookies.get({});
  await Promise.all(cs.map((c) => s.cookies.remove(`https://${c.domain.replace(/^\./, '')}${c.path}`, c.name).catch(() => {})));
}

module.exports = { setup, isLoggedIn, promptLogin, makeCookieFile, resolveShare, getUsername, logout, cleanupAllSync };
