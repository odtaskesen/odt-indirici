// Link temizleme ve yönlendirme. Saf fonksiyonlar, electron'a bağımlı değil.

const TRACKING_PARAMS = /^(igsh|igshid|ig_rid|ig_mid|utm_[a-z]+|fbclid|gclid|si|feature|mibextid)$/i;

function splitInput(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// Boşlukları ve takip parametrelerini temizler. Geçersizse null döner.
function cleanUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (/\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (/^[\w-]+(\.[\w-]+)+(\/|$|\?)/.test(s)) s = 'https://' + s;
    else return null;
  }
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname.includes('.')) return null;
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
  }
  u.hash = '';
  return u.toString();
}

const isHost = (h, base) => h === base || h.endsWith('.' + base);

// Dönen: { kind, url, message }
//  kind: 'invalid' | 'instagram' | 'instagram-share' | 'unsupported' | 'other'
function classify(raw) {
  const url = cleanUrl(raw);
  if (!url) return { kind: 'invalid', url: String(raw), message: 'Geçersiz link.' };
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (isHost(host, 'instagram.com') || host === 'instagr.am') {
    if (parts[0] === 'share') {
      // /share/p/<kod>, /share/reel/<kod>, /share/<kod>
      return { kind: 'instagram-share', url, message: '' };
    }
    // /p/<kod>, /reel/<kod>, /reels/<kod>, /tv/<kod> (önünde kullanıcı adı olabilir)
    const i = parts.findIndex((p, idx) => idx <= 1 && /^(p|reel|reels|tv)$/i.test(p) && parts[idx + 1]);
    if (i !== -1) {
      const type = parts[i].toLowerCase();
      const code = parts[i + 1];
      if (/^[A-Za-z0-9_-]+$/.test(code)) {
        const canon = type === 'reels' ? 'reel' : type;
        return { kind: 'instagram', url: `https://www.instagram.com/${canon}/${code}/`, message: '' };
      }
    }
    // /stories/<kullanıcı>/<story id>: tek bir story (highlight ve kullanıcının tüm story'leri hariç)
    if (parts[0] === 'stories' && parts[1] && parts[1] !== 'highlights' && /^\d+$/.test(parts[2] || '')) {
      return { kind: 'instagram', url: `https://www.instagram.com/stories/${parts[1]}/${parts[2]}/`, message: '' };
    }
    if (parts[0] === 'stories' || parts[0] === 's') {
      return { kind: 'unsupported', url, message: 'Bu story linki desteklenmiyor. Story’yi açıp tek bir story’nin linkini (…/stories/kullanıcı/sayı/) kopyala. Highlight bu sürümde desteklenmiyor.' };
    }
    return { kind: 'unsupported', url, message: 'Instagram profil linkleri bu sürümde desteklenmiyor. Tek bir gönderi, karosel veya reels linki ver.' };
  }

  if (isHost(host, 'youtube.com') || host === 'youtu.be' || isHost(host, 'youtube-nocookie.com')) {
    if (parts[0] === 'playlist') {
      return { kind: 'unsupported', url, message: 'Playlist bu sürümde desteklenmiyor. Tek bir video linki ver.' };
    }
    if (/^@/.test(parts[0] || '') || /^(channel|c|user)$/i.test(parts[0] || '')) {
      return { kind: 'unsupported', url, message: 'Kanal bu sürümde desteklenmiyor. Tek bir video linki ver.' };
    }
  }

  return { kind: 'other', url, message: '' };
}

module.exports = { splitInput, cleanUrl, classify };
