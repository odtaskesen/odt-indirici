// YouTube + diğer siteler (yt-dlp). electron'a bağımlı değildir.
const path = require('path');
const { runProcess, redact } = require('./runner');
const { toolPaths } = require('./tools');

const FORMATS = {
  // Uyumlu MP4: H.264 + AAC, 1080p'ye kadar. (yt-dlp "-t mp4" ön ayarındaki sıralama + res:1080)
  mp4: ['-S', 'vcodec:h264,res:1080,acodec:aac', '--merge-output-format', 'mp4', '--remux-video', 'mp4'],
  // En iyi kalite: çıktı MKV/WebM olabilir
  best: ['-f', 'bv*+ba/b'],
};

// stderr'deki ilk anlamlı hata satırını kısa Türkçe mesaja çevirir
function friendlyError(lines) {
  const text = lines.join('\n');
  const rules = [
    [/Private video|private/i, 'Bu video özel; erişilemiyor.'],
    [/Sign in to confirm|confirm you.re not a bot/i, 'YouTube şu an bu bilgisayardan doğrulama istiyor. Biraz sonra tekrar dene.'],
    [/geo.?restrict|not available in your country|in your country/i, 'Bu içerik bulunduğun ülkede kullanılamıyor.'],
    [/unavailable|has been removed|no longer available|not available/i, 'Video bulunamadı veya kaldırılmış.'],
    [/Unsupported URL/i, 'Bu link desteklenmiyor.'],
    [/is not a valid URL|Invalid URL/i, 'Geçersiz link.'],
    [/HTTP Error 429|Too Many Requests/i, 'Çok fazla istek yapıldı (hız sınırı). Biraz bekleyip tekrar dene.'],
    [/HTTP Error 403|Forbidden/i, 'Site erişimi reddetti (403). Tekrar dene.'],
    [/HTTP Error 404/i, 'İçerik bulunamadı (404).'],
    [/age[- ]restricted|confirm your age|age verification/i, 'Bu içerik yaş doğrulaması istiyor; indirilemedi.'],
    [/Unable to download|getaddrinfo|Temporary failure|Network is unreachable|timed out|Connection reset|Connection refused|URLError/i, 'İnternet bağlantısı sorunu. Bağlantını kontrol edip tekrar dene.'],
    [/ffmpeg|ffprobe/i, 'Birleştirme aracı (ffmpeg) hata verdi.'],
    [/No space left|Errno 28/i, 'Diskte yer kalmadı.'],
    [/Permission denied|Errno 13/i, 'Kayıt klasörüne yazılamıyor.'],
  ];
  for (const [re, msg] of rules) if (re.test(text)) return msg;
  const first = lines.find((l) => /^ERROR/i.test(l));
  return first ? 'İndirilemedi: ' + redact(first).replace(/^ERROR:\s*/i, '').slice(0, 160) : 'İndirme başarısız oldu.';
}

// opts: { binDir, outDir, format: 'mp4'|'best', onProgress({stage, percent}), onLog(line) }
// Dönen: { promise, kill } ; promise -> { status, message, files, log }
function download(url, opts) {
  const { binDir, outDir, format = 'mp4', onProgress = () => {}, onLog = () => {} } = opts;
  const t = toolPaths(binDir);
  const args = [
    '--no-playlist',
    '--newline',
    '--no-quiet',
    '--no-simulate',
    '--ffmpeg-location', binDir,
    '--js-runtimes', `deno:${t.deno}`,
    '--progress-template', 'download:ODTPROG %(progress._percent_str)s',
    '--print', 'after_move:ODTFILE %(filepath)s',
    ...(FORMATS[format] || FORMATS.mp4),
    '-o', path.join(outDir, '%(title).150B [%(id)s].%(ext)s'),
    '--', url,
  ];

  const files = [];
  const errLines = [];
  const log = [];
  const push = (l) => { const r = redact(l); log.push(r); if (log.length > 400) log.shift(); onLog(r); };

  const proc = runProcess(t.ytdlp, args, {
    onStdout: (line) => {
      if (line.startsWith('ODTFILE ')) { files.push(line.slice(8)); return; }
      const m = line.match(/^ODTPROG\s+([\d.]+)%/);
      if (m) { onProgress({ stage: 'indiriliyor', percent: parseFloat(m[1]) }); return; }
      if (/^\[(Merger|VideoRemuxer|ffmpeg|FixupM4a|FixupM3u8)/.test(line)) onProgress({ stage: 'birleştiriliyor', percent: 100 });
      push(line);
    },
    onStderr: (line) => { push(line); if (/^ERROR/i.test(line) || /error/i.test(line)) errLines.push(line); },
  });

  const promise = proc.promise.then((r) => {
    if (r.killed) return { status: 'cancelled', message: 'İptal edildi', files, log };
    if (r.spawnError) return { status: 'failed', message: 'yt-dlp başlatılamadı.', files, log };
    if (r.code === 0 && files.length) return { status: 'done', message: '', files, log };
    if (r.code === 0) return { status: 'done', message: 'Dosya zaten vardı.', files, log };
    return { status: 'failed', message: friendlyError(errLines.length ? errLines : log), files, log };
  });
  return { promise, kill: proc.kill };
}

module.exports = { download, friendlyError };
