const assert = require('assert');
const { cleanUrl, classify, splitInput } = require('../src/main/urls');

const c = (u) => classify(u);
assert.deepStrictEqual(splitInput('  a \n\n b\r\nc '), ['a', 'b', 'c']);

// takip parametreleri
assert.strictEqual(c('https://www.instagram.com/p/ABC123/?igsh=xyz&utm_source=ig_web').url, 'https://www.instagram.com/p/ABC123/');
assert.strictEqual(c('  https://www.youtube.com/watch?v=abc&si=zzz&feature=share ').url, 'https://www.youtube.com/watch?v=abc');
assert.strictEqual(cleanUrl('www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc');

// instagram
assert.strictEqual(c('https://www.instagram.com/reel/XyZ_-9/').kind, 'instagram');
assert.strictEqual(c('https://www.instagram.com/reels/XyZ_-9/').url, 'https://www.instagram.com/reel/XyZ_-9/');
assert.strictEqual(c('https://www.instagram.com/kullanici/p/ABC123/').url, 'https://www.instagram.com/p/ABC123/');
assert.strictEqual(c('https://www.instagram.com/tv/ABC123').url, 'https://www.instagram.com/tv/ABC123/');
assert.strictEqual(c('https://www.instagram.com/share/p/ABC123/').kind, 'instagram-share');
assert.strictEqual(c('https://www.instagram.com/share/reel/ABC123/').kind, 'instagram-share');
assert.strictEqual(c('https://www.instagram.com/someuser/').kind, 'unsupported');
assert.strictEqual(c('https://www.instagram.com/stories/someuser/123/').kind, 'unsupported');
assert.ok(/story/.test(c('https://www.instagram.com/stories/someuser/123/').message));

// youtube
assert.strictEqual(c('https://www.youtube.com/playlist?list=PL123').kind, 'unsupported');
assert.strictEqual(c('https://www.youtube.com/watch?v=abc&list=PL123').kind, 'other');
assert.strictEqual(c('https://youtu.be/abc?si=1').url, 'https://youtu.be/abc');
assert.strictEqual(c('https://www.youtube.com/@kanal/videos').kind, 'unsupported');

// geçersiz
assert.strictEqual(c('merhaba dünya').kind, 'invalid');
assert.strictEqual(c('ftp://x.com/a').kind, 'invalid');
assert.strictEqual(c('http://localhost').kind, 'invalid');
assert.strictEqual(c('https://www.tiktok.com/@a/video/1?utm_source=x').kind, 'other');
console.log('urls.test.js: hepsi geçti');

const { isNewer } = require('../src/main/updater');
assert.ok(isNewer('v0.1.1', '0.1.0'));
assert.ok(isNewer('0.2.0', '0.1.9'));
assert.ok(!isNewer('v0.1.0', '0.1.0'));
assert.ok(!isNewer('v0.0.9', '0.1.0'));
assert.ok(isNewer('1.0.0', '0.9.9'));
console.log('updater.isNewer: hepsi geçti');
