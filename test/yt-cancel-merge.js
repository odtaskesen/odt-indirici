const { download } = require('../src/main/ytdlp');
const { execSync } = require('child_process');
const [,, bin, out, url] = process.argv;
let killed=false;
const j = download(url, { binDir: bin, outDir: out, format: 'mp4', onProgress: (p)=>{
  if (p.stage==='birleştiriliyor' && !killed){ killed=true; setTimeout(()=>{ console.log('çalışan:\n'+execSync("pgrep -fl 'yt-dlp|ffmpeg' || true").toString()); j.kill(); console.log('KILL (birleştirme sırasında)'); },300); }
}});
j.promise.then(r=>console.log(r.status, r.message));
