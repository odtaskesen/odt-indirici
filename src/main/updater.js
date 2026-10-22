// Mac: otomatik kurulum yok; GitHub'da yeni sürüm varsa arayüzde "Yeni sürüm var → İndir" bandı çıkar.
const REPO = 'odtaskesen/odt-indirici';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const SIX_HOURS = 6 * 3600 * 1000;

function parse(v) {
  const m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function isNewer(latest, current) {
  const a = parse(latest), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// Dönen: { version, url } (yeni sürüm varsa) ya da null. Ağ/API hatasında sessizce null.
async function check(currentVersion) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(API, { headers: { 'User-Agent': 'odt-indirici', Accept: 'application/vnd.github+json' }, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const rel = await res.json();
    if (!isNewer(rel.tag_name, currentVersion)) return null;
    const dmg = (rel.assets || []).find((a) => /-arm64\.dmg$/.test(a.name));
    const url = dmg ? dmg.browser_download_url : rel.html_url;
    // Sadece kendi reposunun GitHub adreslerini aç
    if (!String(url).startsWith(`https://github.com/${REPO}/`)) return null;
    return { version: String(rel.tag_name).replace(/^v/, ''), url };
  } catch {
    return null;
  }
}

// Açılışta ve 6 saatte bir kontrol eder. onFound(info) yeni sürümde çağrılır.
function start(currentVersion, onFound) {
  const run = async () => { const info = await check(currentVersion); if (info) onFound(info); };
  run();
  return setInterval(run, SIX_HOURS);
}

module.exports = { check, start, isNewer };
