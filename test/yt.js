const { download } = require('../src/main/ytdlp');
const [,, bin, out, fmt, url] = process.argv;
let last='';
const j = download(url, { binDir: bin, outDir: out, format: fmt, onProgress: (p)=>{ const s=p.stage+Math.round(p.percent/25); if(s!==last){last=s;console.log('PROG',p.stage,p.percent)} } });
if (process.env.CANCEL_AFTER) setTimeout(()=>{console.log('KILL'); j.kill();}, +process.env.CANCEL_AFTER);
j.promise.then(r=>{ console.log(JSON.stringify({status:r.status,message:r.message,files:r.files},null,1)); if(r.status==='failed') console.log(r.log.slice(-15).join('\n')); });
