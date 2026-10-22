// Geliştirme aracı: uygulamanın IG oturumu ve ayarlarıyla kuyruğu çalıştırır. Kullanım: electron test/queue-main.js <link>...
const { app } = require('electron');
const path = require('path');
app.setName('ODT İndirici');
app.setPath('userData', path.join(app.getPath('appData'), 'ODT İndirici'));
const instagram = require('../src/main/instagram');
const gallerydl = require('../src/main/gallerydl');
const { Queue } = require('../src/main/queue');
app.whenReady().then(async () => {
  instagram.setup();
  const ud = app.getPath('userData');
  await gallerydl.writeConfig(path.join(ud, 'gallery-dl.json'));
  const q = new Queue({
    binDir: path.join(ud, 'bin'), getOutDir: () => app.getPath('downloads'), getFormat: () => 'mp4', configFile: path.join(ud, 'gallery-dl.json'),
    instagram: { isLoggedIn: instagram.isLoggedIn, promptLogin: async () => false, resolveShare: instagram.resolveShare, makeCookieFile: instagram.makeCookieFile },
    onUpdate: () => {},
  });
  q.add(process.argv.slice(2).filter((a) => /^https?:/.test(a)).join('\n'));
  const t = setInterval(() => {
    if (!q.busy) {
      clearInterval(t);
      for (const j of q.snapshot()) console.log(j.url, '=>', j.status, '|', j.text, j.status === 'done' ? '' : '\n' + j.log.join('\n'), '\n  ', j.files.map((f) => path.basename(f)).join(', '));
      instagram.cleanupAllSync(); app.exit(0);
    }
  }, 500);
});
