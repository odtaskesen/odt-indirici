const path = require('path');
const tools = require('../src/main/tools');
const bin = process.argv[2];
let last = 0;
tools.ensureTools(bin, (s) => {
  if (s.received && Date.now() - last > 2000) { last = Date.now(); console.log(s.text, Math.round(s.received/1e6)+'/'+Math.round(s.total/1e6)+' MB'); }
}).then(async (r) => { console.log(JSON.stringify(r, null, 1)); }).catch((e) => { console.error('HATA', e); process.exit(1); });
