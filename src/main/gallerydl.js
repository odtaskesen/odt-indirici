// Instagram indirmeleri (gallery-dl). electron'a bağımlı değildir.
const fsp = require('fs/promises');
const path = require('path');
const { runProcess, redact } = require('./runner');
const { toolPaths } = require('./tools');

const SLEEP_RANGE = [3, 8];

// gallery-dl yapılandırması: her gönderi kendi klasörüne, karosel sırası dosya adında
function configObject() {
  return {
    extractor: {
      instagram: {
        'sleep-request': SLEEP_RANGE,
        directory: [], // alt klasör yok: dosyalar doğrudan seçili klasöre iner
        filename: '{username}_{post_shortcode}_{num:>02}.{extension}',
        // "merged": hazır birleşik h264+aac MP4 (düzenleme programlarında açılır). true/dash VP9 verir.
        videos: 'merged',
      },
    },
  };
}

async function writeConfig(file) {
  await fsp.writeFile(file, JSON.stringify(configObject(), null, 2));
}

// stderr'de oturum/giriş sorunu belirten mesajlar
const LOGIN_RE = /login|log in|logged in|authoriz|unauthor|authentication|checkpoint|challenge_required|\b40[13]\b|redirect(ed)? to|consent_required|not logged/i;

function friendlyError(lines) {
  const text = lines.join('\n');
  if (/\b(400|404)\b|not found|does not exist|no results|unavailable|deleted/i.test(text)) return 'Gönderi bulunamadı (silinmiş veya özel olabilir).';
  if (/429|too many|rate.?limit|wait/i.test(text)) return 'Instagram hız sınırı uyguladı. Biraz bekleyip tekrar dene.';
  if (/getaddrinfo|Temporary failure|Network is unreachable|timed out|Connection (reset|refused|aborted)|ConnectionError|NameResolution/i.test(text)) return 'İnternet bağlantısı sorunu. Bağlantını kontrol edip tekrar dene.';
  if (/No space left|Errno 28/i.test(text)) return 'Diskte yer kalmadı.';
  if (/Permission denied|Errno 13/i.test(text)) return 'Kayıt klasörüne yazılamıyor.';
  const first = lines.find((l) => /error|exception/i.test(l));
  return first ? 'İndirilemedi: ' + redact(first).replace(/^\[[^\]]+\]\[[^\]]+\]\s*/, '').slice(0, 160) : 'İndirme başarısız oldu.';
}

// opts: { binDir, outDir, cookiesFile, configFile, onProgress({done,total}), onLog(line) }
// Dönen: { promise, kill } ; promise ->
//   { status: 'done'|'partial'|'failed'|'login'|'cancelled', message, done, total, files, log }
function download(url, opts) {
  const { binDir, outDir, cookiesFile, configFile, onProgress = () => {}, onLog = () => {} } = opts;
  const t = toolPaths(binDir);
  const args = [
    '--config-ignore',
    '-c', configFile,
    '-C', cookiesFile,
    '-d', outDir,
    // Her inen / zaten var olan / başarısız dosya için tek satır: ODT<olay> \t num \t count \t yol
    '--Print', 'after:ODTOK\t{num}\t{count}\t{subcategory}\t{_path}',
    '--Print', 'skip:ODTOK\t{num}\t{count}\t{subcategory}\t{_path}',
    '--Print', 'error:ODTERR\t{num}\t{count}',
    '--', url,
  ];

  const files = [];
  const seen = new Set();
  let errors = 0;
  let total = 0;
  const errLines = [];
  const log = [];
  const push = (l) => { const r = redact(l); log.push(r); if (log.length > 400) log.shift(); onLog(r); };

  const parseCount = (s) => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const proc = runProcess(t.gallerydl, args, {
    onStdout: (line) => {
      if (line.startsWith('ODTOK\t')) {
        const [, num, count, sub, p] = line.split('\t');
        // Reels'te gallery-dl count'u 2 bildiriyor ama tek video var (gerçek çıktıdan doğrulandı)
        const c = sub === 'reel' ? 1 : parseCount(count);
        if (c > total) total = c;
        if (p && !seen.has(p)) { seen.add(p); files.push(p); }
        push(line.replace(/\t/g, ' | '));
        onProgress({ done: files.length, total: total || files.length });
        return;
      }
      if (line.startsWith('ODTERR\t')) {
        errors += 1;
        const c = parseCount(line.split('\t')[2]);
        if (c > total) total = c;
        push(line.replace(/\t/g, ' | '));
        return;
      }
      push(line);
    },
    onStderr: (line) => { push(line); errLines.push(line); },
  });

  const promise = proc.promise.then((r) => {
    const base = { done: files.length, total: total || files.length, files, log };
    if (r.killed) return { ...base, status: 'cancelled', message: 'İptal edildi' };
    if (r.spawnError) return { ...base, status: 'failed', message: 'gallery-dl başlatılamadı.' };

    const loginProblem = LOGIN_RE.test(errLines.join('\n'));
    const complete = r.code === 0 && errors === 0 && files.length > 0 && (!total || files.length >= total);
    if (complete) return { ...base, status: 'done', message: '' };
    if (files.length > 0) {
      const tot = total || files.length + errors;
      return { ...base, total: tot, status: 'partial', message: `Kısmen tamamlandı (${files.length}/${tot} dosya).` };
    }
    if (loginProblem) return { ...base, status: 'login', message: 'Instagram girişi gerekiyor (oturum süresi dolmuş olabilir).' };
    if (r.code === 0) return { ...base, status: 'failed', message: 'Gönderide indirilecek dosya bulunamadı.' };
    return { ...base, status: 'failed', message: friendlyError(errLines.length ? errLines : log) };
  });

  return { promise, kill: proc.kill };
}

module.exports = { download, writeConfig, configObject, friendlyError, SLEEP_RANGE };
