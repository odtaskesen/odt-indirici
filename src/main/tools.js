// Araçları (gallery-dl, yt-dlp, ffmpeg, ffprobe, deno) ilk açılışta binDir'e indirir,
// SHA-256 ile doğrular ve günlük günceller. Bu modül electron'a bağımlı değildir.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const yauzl = require('yauzl');

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';
const UA = 'odt-indirici';

const GH = 'https://github.com';
const URLS = {
  gallerydl: IS_WIN
    ? `${GH}/gdl-org/builds/releases/latest/download/gallery-dl_windows.exe`
    : `${GH}/gdl-org/builds/releases/latest/download/gallery-dl_macos`,
  ytdlp: IS_WIN
    ? `${GH}/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe`
    : `${GH}/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos`,
  ytdlpSums: `${GH}/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS`,
  ytdlpAsset: IS_WIN ? 'yt-dlp.exe' : 'yt-dlp_macos',
  ffmpegWin: `${GH}/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip`,
  ffmpegWinSums: `${GH}/yt-dlp/FFmpeg-Builds/releases/download/latest/checksums.sha256`,
  ffmpegMac: `${GH}/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-darwin-arm64.gz`,
  ffprobeMac: `${GH}/eugeneware/ffmpeg-static/releases/latest/download/ffprobe-darwin-arm64.gz`,
  deno: IS_WIN
    ? `${GH}/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip`
    : `${GH}/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip`,
  gdlLatestApi: 'https://api.github.com/repos/gdl-org/builds/releases/latest',
};

function binPath(binDir, name) {
  return path.join(binDir, name + EXE);
}

const TOOL_NAMES = ['gallery-dl', 'yt-dlp', 'ffmpeg', 'ffprobe', 'deno'];

function toolPaths(binDir) {
  return {
    gallerydl: binPath(binDir, 'gallery-dl'),
    ytdlp: binPath(binDir, 'yt-dlp'),
    ffmpeg: binPath(binDir, 'ffmpeg'),
    ffprobe: binPath(binDir, 'ffprobe'),
    deno: binPath(binDir, 'deno'),
  };
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

// --- indirme yardımcıları ---------------------------------------------------

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

// url -> dest (.part üzerinden). Dönen: sha256 (hex).
async function downloadFile(url, dest, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const part = dest + '.part';
  const hash = crypto.createHash('sha256');
  let received = 0;
  const src = Readable.fromWeb(res.body);
  src.on('data', (chunk) => {
    hash.update(chunk);
    received += chunk.length;
    if (onProgress) onProgress(received, total);
  });
  try {
    await pipeline(src, fs.createWriteStream(part));
  } catch (e) {
    await fsp.rm(part, { force: true });
    throw e;
  }
  await fsp.rename(part, dest);
  return hash.digest('hex');
}

function findHash(text, nameHint) {
  // Önce hint içeren satır, yoksa metindeki ilk 64'lük hex
  const lines = text.split(/\r?\n/);
  const re = /\b[0-9a-fA-F]{64}\b/;
  if (nameHint) {
    for (const line of lines) {
      const toks = line.trim().split(/\s+/);
      const last = (toks[toks.length - 1] || '').replace(/^\*/, '');
      if (re.test(line) && last === nameHint) return line.match(re)[0].toLowerCase();
    }
    return null;
  }
  const m = text.match(re);
  return m ? m[0].toLowerCase() : null;
}

function gunzipFile(src, dest) {
  return pipeline(fs.createReadStream(src), zlib.createGunzip(), fs.createWriteStream(dest));
}

// zip içinden belirli dosyaları (taban adıyla) hedef dizine çıkarır
function extractFromZip(zipPath, wantedBasenames, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      const found = new Set();
      zip.on('error', reject);
      zip.on('end', () => {
        const missing = wantedBasenames.filter((n) => !found.has(n));
        if (missing.length) reject(new Error('Zip içinde bulunamadı: ' + missing.join(', ')));
        else resolve();
      });
      zip.on('entry', (entry) => {
        const base = path.posix.basename(entry.fileName);
        if (/\/$/.test(entry.fileName) || !wantedBasenames.includes(base)) return zip.readEntry();
        zip.openReadStream(entry, (e, rs) => {
          if (e) return reject(e);
          const out = path.join(destDir, base);
          pipeline(rs, fs.createWriteStream(out)).then(() => {
            found.add(base);
            zip.readEntry();
          }, reject);
        });
      });
      zip.readEntry();
    });
  });
}

function runCapture(bin, args, { timeout = 20000, env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    let child;
    try {
      child = spawn(bin, args, { shell: false, windowsHide: true, env: { ...process.env, ...env } });
    } catch (e) {
      return resolve({ code: -1, out: String(e.message) });
    }
    const finish = (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, out }); } };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(-2); }, timeout);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => { out += String(e.message); finish(-1); });
    child.on('close', (code) => finish(code));
  });
}

// --- tek tek araç kurulumu --------------------------------------------------

async function finalizeBinary(p) {
  if (!IS_WIN) await fsp.chmod(p, 0o755);
}

function expectHash(actual, expected, label) {
  if (expected && actual !== expected) {
    throw new Error(`${label}: SHA-256 uyuşmuyor (dosya silindi)`);
  }
}

async function installGalleryDl(binDir, log, progress) {
  const dest = toolPaths(binDir).gallerydl;
  const tmp = dest + '.new';
  await downloadFile(URLS.gallerydl, tmp, progress);
  await finalizeBinary(tmp);
  await fsp.rename(tmp, dest);
  // gdl-org/builds özet dosyası yayınlamıyor; HTTPS + resmi repo ile yetiniyoruz.
  log('gallery-dl kuruldu');
}

async function installYtDlp(binDir, log, progress) {
  const dest = toolPaths(binDir).ytdlp;
  const tmp = dest + '.new';
  const sums = await fetchText(URLS.ytdlpSums);
  const expected = findHash(sums, URLS.ytdlpAsset);
  if (!expected) throw new Error('yt-dlp özet dosyasında hash bulunamadı');
  const actual = await downloadFile(URLS.ytdlp, tmp, progress);
  try { expectHash(actual, expected, 'yt-dlp'); } catch (e) { await fsp.rm(tmp, { force: true }); throw e; }
  await finalizeBinary(tmp);
  await fsp.rename(tmp, dest);
  log('yt-dlp kuruldu');
}

async function installDeno(binDir, log, progress) {
  const zipUrl = URLS.deno;
  const zipPath = path.join(binDir, 'deno.zip.tmp');
  const sumText = await fetchText(zipUrl + '.sha256sum');
  const expected = findHash(sumText);
  if (!expected) throw new Error('deno özet dosyasında hash bulunamadı');
  const actual = await downloadFile(zipUrl, zipPath, progress);
  try {
    expectHash(actual, expected, 'deno');
    await extractFromZip(zipPath, ['deno' + EXE], binDir);
  } finally {
    await fsp.rm(zipPath, { force: true });
  }
  await finalizeBinary(toolPaths(binDir).deno);
  log('deno kuruldu');
}

async function installFfmpeg(binDir, log, progress) {
  const p = toolPaths(binDir);
  if (IS_WIN) {
    const zipPath = path.join(binDir, 'ffmpeg.zip.tmp');
    const sums = await fetchText(URLS.ffmpegWinSums);
    const expected = findHash(sums, 'ffmpeg-master-latest-win64-gpl.zip');
    if (!expected) throw new Error('ffmpeg özet dosyasında hash bulunamadı');
    const actual = await downloadFile(URLS.ffmpegWin, zipPath, progress);
    try {
      expectHash(actual, expected, 'ffmpeg');
      await extractFromZip(zipPath, ['ffmpeg.exe', 'ffprobe.exe'], binDir);
    } finally {
      await fsp.rm(zipPath, { force: true });
    }
  } else {
    // eugeneware/ffmpeg-static özet dosyası yayınlamıyor; HTTPS ile yetiniyoruz.
    for (const [url, dest] of [[URLS.ffmpegMac, p.ffmpeg], [URLS.ffprobeMac, p.ffprobe]]) {
      const gz = dest + '.gz.tmp';
      await downloadFile(url, gz, progress);
      try { await gunzipFile(gz, dest + '.new'); } finally { await fsp.rm(gz, { force: true }); }
      await finalizeBinary(dest + '.new');
      await fsp.rename(dest + '.new', dest);
    }
  }
  log('ffmpeg + ffprobe kuruldu');
}

const INSTALLERS = {
  'gallery-dl': installGalleryDl,
  'yt-dlp': installYtDlp,
  deno: installDeno,
  ffmpeg: installFfmpeg, // ffprobe ile birlikte
};

// --- sürümler ---------------------------------------------------------------

async function getVersions(binDir) {
  const p = toolPaths(binDir);
  const v = {};
  const jobs = [
    ['gallery-dl', p.gallerydl, ['--version'], (o) => o.trim().split(/\s+/).pop()],
    ['yt-dlp', p.ytdlp, ['--version'], (o) => o.trim()],
    ['ffmpeg', p.ffmpeg, ['-version'], (o) => (o.match(/ffmpeg version (\S+)/) || [])[1]],
    ['ffprobe', p.ffprobe, ['-version'], (o) => (o.match(/ffprobe version (\S+)/) || [])[1]],
    ['deno', p.deno, ['--version'], (o) => (o.match(/deno (\S+)/) || [])[1]],
  ];
  await Promise.all(jobs.map(async ([name, bin, args, parse]) => {
    if (!(await exists(bin))) return (v[name] = null);
    const r = await runCapture(bin, args, { env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    v[name] = r.code === 0 ? parse(r.out) || '?' : null;
  }));
  return v;
}

// --- ana akış ---------------------------------------------------------------

// Eksik araçları kurar. onStatus({text, received, total}) arayüze ilerleme bildirir.
async function ensureTools(binDir, onStatus = () => {}) {
  await fsp.mkdir(binDir, { recursive: true });
  const p = toolPaths(binDir);
  // yarım kalmış indirmeleri temizle
  for (const f of await fsp.readdir(binDir)) {
    if (/\.(part|new|tmp)$/.test(f)) await fsp.rm(path.join(binDir, f), { force: true });
  }
  const need = [];
  if (!(await exists(p.gallerydl))) need.push('gallery-dl');
  if (!(await exists(p.ytdlp))) need.push('yt-dlp');
  if (!(await exists(p.ffmpeg)) || !(await exists(p.ffprobe))) need.push('ffmpeg');
  if (!(await exists(p.deno))) need.push('deno');
  if (!need.length) return { installed: [] };

  for (const name of need) {
    const label = name === 'ffmpeg' ? 'ffmpeg' : name;
    onStatus({ text: `İlk kurulum: ${label} indiriliyor…`, received: 0, total: 0 });
    await INSTALLERS[name](
      binDir,
      () => {},
      (received, total) => onStatus({ text: `İlk kurulum: ${label} indiriliyor…`, received, total }),
    );
  }

  // Her ikiliyi çalıştırıp doğrula (imza / bozuk dosya yakalar)
  const versions = await getVersions(binDir);
  const broken = TOOL_NAMES.filter((n) => !versions[n]);
  if (broken.length) throw new Error('Araçlar çalıştırılamadı: ' + broken.join(', '));
  return { installed: need, versions };
}

// --- günlük güncelleme ------------------------------------------------------

async function readState(stateFile) {
  try { return JSON.parse(await fsp.readFile(stateFile, 'utf8')); } catch { return {}; }
}
async function writeState(stateFile, s) {
  await fsp.writeFile(stateFile, JSON.stringify(s, null, 2));
}

// canRun(): şu an indirme çalışıyorsa false döner -> güncelleme ertelenir.
async function updateTools(binDir, stateFile, { canRun = () => true, force = false, onStatus = () => {} } = {}) {
  const state = await readState(stateFile);
  const DAY = 24 * 3600 * 1000;
  if (!force && state.lastCheck && Date.now() - state.lastCheck < DAY) return { skipped: 'recent' };
  if (!canRun()) return { skipped: 'busy' };
  const p = toolPaths(binDir);
  const result = {};

  try {
    // yt-dlp: kendi güncelleyicisi
    if (await exists(p.ytdlp)) {
      onStatus({ text: 'Araçlar güncelleniyor…' });
      const r = await runCapture(p.ytdlp, ['-U'], { timeout: 120000, env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
      result.ytdlp = r.code === 0 ? 'ok' : 'hata';
    }
    // gallery-dl: -U kullanılmaz, tag_name karşılaştırılır
    if (canRun()) {
      const txt = await fetchText(URLS.gdlLatestApi);
      const tag = JSON.parse(txt).tag_name;
      if (tag && tag !== state.gdlTag) {
        if (!canRun()) return { skipped: 'busy' };
        await installGalleryDl(binDir, () => {}, () => {});
        state.gdlTag = tag;
        result.gallerydl = 'güncellendi ' + tag;
      }
    }
    state.lastCheck = Date.now();
    await writeState(stateFile, state);
  } catch (e) {
    result.error = e.message; // ağ yok vb.: sessizce geç, yarın tekrar dene
  }
  return result;
}

// Kurulumdan sonra gallery-dl etiketini kaydet (ilk indirme güncel sürümdür)
async function recordGdlTag(stateFile) {
  try {
    const tag = JSON.parse(await fetchText(URLS.gdlLatestApi)).tag_name;
    const s = await readState(stateFile);
    if (!s.gdlTag && tag) { s.gdlTag = tag; await writeState(stateFile, s); }
  } catch {}
}

module.exports = { ensureTools, updateTools, getVersions, toolPaths, runCapture, recordGdlTag, IS_WIN };
