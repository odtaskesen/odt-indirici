// Kullanım: node test/cdp.js '<js ifadesi>'  (çalışan uygulamanın sayfasında değerlendirilir)
const expr = process.argv[2];
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const page = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id === 1) {
      const r = d.result;
      if (r.exceptionDetails) console.log('HATA', r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      else console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 1));
      process.exit(0);
    }
  };
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true } }));
})();
