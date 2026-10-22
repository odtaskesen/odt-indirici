# ODT İndirici

Instagram (gönderi, karosel, reels, story), YouTube (video, Shorts) ve TikTok gibi birçok siteden link yapıştırıp video/fotoğraf indirmeye yarayan Mac programı. Terminal, eklenti veya kurulum bilgisi gerekmez.

> Sadece **M çipli Mac'ler** (Apple Silicon) için. Windows ve Intel Mac sürümü şu an yok.

## Kurulum (4 adım)

1. **İndir:** [Son sürüm sayfasını](https://github.com/odtaskesen/odt-indirici/releases/latest) aç, `ODT-Indirici-…-arm64.dmg` dosyasını indir.
   Chrome "bu dosya tehlikeli olabilir" derse **Sakla**'ya bas (program imzasız olduğu için çıkar).
2. **Kur:** İndirilen `.dmg` dosyasına çift tıkla, açılan pencerede programı **Uygulamalar** klasörüne sürükle.
3. **İlk açılış:** Programı Uygulamalar'dan aç. macOS "doğrulanamadı" derse **Tamam/Bitti**'ye bas, sonra
   **Sistem Ayarları → Gizlilik ve Güvenlik** bölümünü aç, aşağıda **"Yine de Aç"** butonuna bas ve tekrar aç.
4. **Kullan:** İlk açılışta program gerekli araçları (yaklaşık 140 MB) kendisi indirir; bu birkaç dakika sürebilir.

## Kullanım

- Linkleri kutuya yapıştır (her satıra bir link) ve **İndir**'e bas. Linkler sırayla iner.
- Dosyalar doğrudan **İndirilenler** klasörüne iner. Klasörü "Değiştir" ile seçebilirsin.
- **Instagram:** ilk Instagram linkinde program, kendi içinde bir giriş penceresi açar. Kendi hesabınla bir kez giriş yap (yeni cihaz doğrulama kodu isteyebilir). Şifreni program görmez ve saklamaz. Çıkış için Ayarlar → "Instagram'dan çıkış yap".
- **YouTube kalitesi:** "Uyumlu MP4" (varsayılan; H.264+AAC, 1080p'ye kadar, her programda açılır) veya "En iyi kalite" (MKV/WebM olabilir).
- Instagram story: story'yi açıp tek bir story'nin linkini ver (`…/stories/kullanıcı/sayı/`). Story'ler 24 saat sonra silindiği için linkin o süre içinde indirilmesi gerekir.
- Desteklenmeyenler: Instagram highlight/profil, bir kullanıcının tüm story'leri, YouTube playlist ve kanal.

## Güncelleme

Yeni sürüm çıkınca program açılışta üstte **"Yeni sürüm hazır → İndir"** bandı gösterir. İndir, `.dmg`'yi aç, programı Uygulamalar'a sürükleyip **Değiştir** de. Program imzasız olduğu için **her yeni sürümde** yukarıdaki 3. adımdaki "Yine de Aç" onayı bir kez daha gerekir. Ayarlarınız ve Instagram girişiniz korunur.

İndirme araçları (gallery-dl, yt-dlp) programdan bağımsız olarak günde bir kez kendiliğinden güncellenir; Instagram/YouTube bir şeyi değiştirirse çoğu zaman programı güncellemek gerekmez.

## Notlar

- İndirilen içerikler kişisel kullanım içindir; içerik sahiplerinin haklarına saygı göster.
- Instagram, art arda çok fazla istekte hesabı kısıtlayabilir; program bu yüzden Instagram indirmeleri arasında kısa bekler.

## Geliştirme

```bash
npm install
npm start          # geliştirme modunda çalıştır
npm test           # birim testleri
npx electron-builder --mac --arm64 --publish never   # yerel .dmg
```

Yeni sürüm yayınlamak: `npm version patch && git push --follow-tags` — GitHub Actions `.dmg`'yi derleyip Release'e koyar.

Lisans: MIT. Instagram indirmeleri [gallery-dl](https://github.com/mikf/gallery-dl), diğerleri [yt-dlp](https://github.com/yt-dlp/yt-dlp) ile yapılır.
