// Geliştirme aracı: uygulamanın IG oturumuyla gallery-dl'ı verilen argümanlarla çalıştırır (çerez yazdırmaz).
const { app } = require('electron');
const path = require('path');
app.setName('ODT İndirici');
app.setPath('userData', path.join(app.getPath('appData'), 'ODT İndirici'));
const instagram = require('../src/main/instagram');
const { runProcess, redact } = require('../src/main/runner');
const { toolPaths } = require('../src/main/tools');
app.whenReady().then(async () => {
  instagram.setup();
  const ck = await instagram.makeCookieFile();
  const args = ['--config-ignore', '-c', path.join(app.getPath('userData'), 'gallery-dl.json'), '-C', ck.file, ...process.argv.slice(2).filter(a => a !== '--')];
  const p = runProcess(toolPaths(path.join(app.getPath('userData'), 'bin')).gallerydl, args, {
    onStdout: (l) => console.log(redact(l)), onStderr: (l) => console.log('ERR ' + redact(l)),
  });
  await p.promise; await ck.cleanup(); app.exit(0);
});
