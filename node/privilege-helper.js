// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// privilege-helper.js — kök yetkili yardımcının sabit işlem listesi (RFC-0007 §6.4, RFC-0026)
//
// Yardımcı her isteği kendisi doğrular; denetçiye güvenmez (denetçi internete çıkan süreçtir). Liste dışı işlem yoktur.
// Güvendiği durum (kök anahtar durumu, en yüksek kurulu sürüm, geri çekilmiş ve bozuk sürümler, deneme kaydı, görülen
// onaylar) yalnız kökün dizinindedir: /var/lib/havenfold/yetki/ (root, 0700; RFC-0026 a). Denetçi bunları 'durum-oku'
// ile kopya olarak alır, yazamaz. Yardımcının kendi kodu /usr/lib/havenfold/yetki/'den çalışır; guncel bağı onu hiçbir
// zaman değiştirmez (b). Yollar 'kok' önekine göredir: kurulu düğümde '/', testlerde kullanıcı alanındaki geçici dizin.
// Bu makinede yardımcı kök olarak çalıştırılmaz; sistem çağrıları (systemctl, sysfs) ve defter kanca olarak verilir.
//
// Paket biçimi: çekirdeğin kanonik ZIP'i (@havenfold/export zip.js; ad denetimi, örtüşmesiz girdiler). bin/ altındaki
// dosyalar ve kökteki çalışma zamanları (node, bare) 0755, diğerleri 0644 açılır. Sürüm dizini önce '<sürüm>.yeni'
// olarak açılır, sonra adı değiştirilir.
const fs = require('fs')
const path = require('path')
const b4a = require('b4a')
const c = require('compact-encoding')
const { zip: { zipOku } } = require('@havenfold/export')
const S = require('./release')

function fail (code) { throw new Error(code) }
const hex = (b) => b4a.toString(b, 'hex')

const ISLEMLER = ['paket-ac', 'surum-gec', 'surum-geri', 'kamera-ag', 'kamera-ag-sil', 'pil-esigi', 'yeniden-baslat', 'efi-bilet-yaz',
  'efi-bilet-sil', 'usb-yaz', 'smart-oku', 'luks-kurtarma', 'uc-akis-ag', 'uc-akis-ag-sil', 'uygulama-kur', 'uygulama-sil', 'afet-ag',
  'kok-dondur', 'durum-oku', 'saglik-bildir', 'deneme-denetle'] // son dördü RFC-0026 a, d
// uc-akis-ag ve uc-akis-ag-sil bu sürümde yok: görüntü görevinin ağ ad alanını görev kullanıcısının rootless Podman'ı
// pod olarak kurar (podman.js akisPodKur; inceleme 23 madde 1; kollar/D-durum.md İstek 168)
const BU_SURUMDE = ['paket-ac', 'surum-gec', 'surum-geri', 'pil-esigi', 'yeniden-baslat', 'kok-dondur', 'durum-oku', 'saglik-bildir', 'deneme-denetle', 'luks-kurtarma']
const SURUM_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
// Çağıranın kullanıcısı işlem başına: sağlığı çekirdekler kendileri bildirir; deneme denetimini yalnız kökün
// zamanlayıcısı ve açılış birimi çalıştırır (RFC-0026 d). Diğer işlemler denetçi ve kök. SO_PEERCRED yok (RFC-0033 §9 l):
// soket kipinde kullanıcı dosya izninden gelir; soket dizinine yalnız denetçi girdiği için soketten gelen istek
// 'havenfold-denetci' olarak denetlenir (privilege-socket.js). Komut satırı kipi kök birimleridir ('root'). Bu yüzden
// çekirdeklerin 'saglik-bildir'i bugün soketten gelemez; kural yerinde kalır (yol ayrı karar, sınırlar madde 9).
const DENETCI = ['havenfold-denetci', 'root']
const IZIN = { 'saglik-bildir': ['havenfold-denetci', 'havenfold-kutu', 'havenfold-isci'], 'deneme-denetle': ['root'] }
const BILINEN = new Set([...DENETCI, ...IZIN['saglik-bildir']])
const ROL = { 'havenfold-denetci': 'denetci', 'havenfold-kutu': 'kutu', 'havenfold-isci': 'isci' }
const CALISTIRILABILIR = new Set(['node', 'bare']) // birimlerin ExecStart'ındaki çalışma zamanları
const SAGLIK_MS = 10 * 60_000 // RFC-0007 §12.6 madde 5
const ACILIS_SINIRI = 3 // pencere içinde üç açılış ve sağlık yok → geri (RFC-0026 d)
const BILDIRIM_MAX = 1 << 20
const ZINCIR_MAX = 1 << 20
const PAKET_MAX = 1 << 30
const KURTARMA_BOY = 32 // RFC-0007 §8.5: 32 baytlık rastgele kurtarma anahtarı (installer/target/hf-luks-yenile yazar)

class YetkiYardimcisi {
  // systemctl(args) · pilYaz({ start, stop }) → { limit } · simdi() · os, arch: bu düğümün paket satırı ·
  // defter() → Ledger (düğümün defter kopyası; düşürme onayını doğrulamak için) · nodeId: bu düğümün kimliği (hex) ·
  // roller() → sağlık bildirmesi gereken çekirdekler (varsayılan: kimliği olanlar)
  constructor ({ kok = '/', systemctl = () => {}, pilYaz = () => ({ limit: 'yok' }), os = 'linux', arch = 'amd64', simdi = Date.now, defter = null, nodeId = null, roller = null }) {
    this.kok = kok
    this.kanca = { systemctl, pilYaz, defter, roller: roller || (() => ['kutu', 'isci'].filter((r) => fs.existsSync(this.y('var/lib/havenfold', r, 'kimlik')))) }
    this.os = os
    this.arch = arch
    this.simdi = simdi
    this.nodeId = nodeId
  }

  y (...p) { return path.join(this.kok, ...p) }
  get surumler () { return this.y('opt/havenfold/surumler') }
  get yetkiDizini () { return this.y('var/lib/havenfold/yetki') }
  get onbellek () { return this.y('var/lib/havenfold/denetci/onbellek') }

  // Giriş noktası: { islem, girdi } ve karşı ucun kullanıcısı. Dönüş: işlemin çıktısı
  async isle (kullanici, islem, girdi) {
    if (!BILINEN.has(kullanici)) fail('UNAUTHORIZED')
    if (!ISLEMLER.includes(islem)) fail('NOT_LISTED')
    if (!BU_SURUMDE.includes(islem)) fail('NOT_IN_THIS_VERSION')
    if (!(IZIN[islem] || DENETCI).includes(kullanici)) fail('UNAUTHORIZED')
    if (!girdi || typeof girdi !== 'object') fail('INVALID_INPUT')
    if (islem === 'paket-ac') return this.paketAc(girdi)
    if (islem === 'surum-gec') return this.surumGec(girdi)
    if (islem === 'surum-geri') return this.surumGeri()
    if (islem === 'pil-esigi') return this.pilEsigi(girdi)
    if (islem === 'yeniden-baslat') return this.yenidenBaslat(girdi)
    if (islem === 'kok-dondur') return this.kokDondur(girdi)
    if (islem === 'durum-oku') return this.durumOku()
    if (islem === 'saglik-bildir') return this.saglikBildir(ROL[kullanici], girdi)
    if (islem === 'deneme-denetle') return this.denemeDenetle(girdi)
    if (islem === 'luks-kurtarma') return this.luksKurtarma(girdi)
  }

  // --- Kökün durumu (RFC-0026 a) ---------------------------------------------------------------------------------

  // Dizin kökün olmalı ve başkasına kapalı (0700); değilse durum yazılmaz
  _dizinDenetle () {
    let st
    try { st = fs.lstatSync(this.yetkiDizini) } catch { fail('ROOT_STATE_NOT_WRITABLE') }
    const kokMu = typeof process.getuid === 'function' && process.getuid() === 0
    if (!st.isDirectory() || (st.mode & 0o077) !== 0 || (kokMu && st.uid !== 0)) fail('ROOT_STATE_NOT_WRITABLE')
  }

  _yaz (ad, icerik) {
    this._dizinDenetle()
    const p = path.join(this.yetkiDizini, ad)
    fs.writeFileSync(p + '.yeni', icerik, { mode: 0o600 })
    fs.renameSync(p + '.yeni', p)
  }

  _kokDurumu () {
    let b
    try { b = fs.readFileSync(path.join(this.yetkiDizini, 'kok.durum')) } catch { fail('NO_ROOT_STATE') }
    return c.decode(S.kokDurumuEnc, b)
  }

  // enYuksek, revoked, bozuk: versionCode; paketler: sürüm → { versionCode, ozet } (doğrulanıp açılanlar); onayli:
  // sürüm → onayın bitişi (düşürme onayı paket-ac'ta doğrulandı); gorulen: onay özeti → bitiş; deneme ve sonGecis (d)
  _durum () {
    let d = {}
    try { d = JSON.parse(fs.readFileSync(path.join(this.yetkiDizini, 'yetki.durum'), 'utf8')) } catch (err) { if (err.code !== 'ENOENT') fail('ROOT_STATE_CORRUPT') }
    return { enYuksek: 0, revoked: [], bozuk: [], paketler: {}, onayli: {}, gorulen: {}, deneme: null, sonGecis: null, ...d }
  }

  _durumYaz (d) { this._yaz('yetki.durum', JSON.stringify(d)) }

  // Denetçinin kopyası: yalnız okunur bilgi
  durumOku () {
    const k = this._kokDurumu()
    const d = this._durum()
    return {
      kok: { keyEpoch: k.keyEpoch, rootPub: hex(k.rootPub), nextRootHash: hex(k.nextRootHash) },
      enYuksek: d.enYuksek, revoked: [...d.revoked], bozuk: [...d.bozuk], deneme: d.deneme ? { ...d.deneme } : null, sonGecis: d.sonGecis ? { ...d.sonGecis } : null
    }
  }

  // ROOT_ROTATION'ı yardımcı kendisi doğrular ve uygular: zincir önbellekteki kok-zinciri.bin (u32be uzunluk önekli)
  kokDondur ({ zincir }) {
    const bytes = this._onbellekten(zincir, ZINCIR_MAX)
    const kayitlar = []
    for (let i = 0; i < bytes.byteLength;) {
      if (i + 4 > bytes.byteLength) fail('FORMAT_ERROR')
      const n = bytes.readUInt32BE(i)
      if (n < 65 || i + 4 + n > bytes.byteLength) fail('FORMAT_ERROR')
      kayitlar.push(bytes.subarray(i + 4, i + 4 + n))
      i += 4 + n
    }
    const eski = this._kokDurumu()
    const yeni = S.zinciriUygula(eski, kayitlar)
    if (yeni.keyEpoch !== eski.keyEpoch) this._yaz('kok.durum', c.encode(S.kokDurumuEnc, yeni))
    return { keyEpoch: yeni.keyEpoch }
  }

  // --- Güvenli okuma (inceleme 11 bulgu 12) ----------------------------------------------------------------------

  // Önbellekteki düzenli dosya: yolda bağ yok (realpath), son bileşen O_NOFOLLOW, FIFO ve aygıt yok, boyut sınırlı.
  // Bir kez okunur; aynı baytlar doğrulanır ve kullanılır.
  _onbellekten (p, max, asim = 'SIZE_OVERRUN') {
    if (typeof p !== 'string') fail('INVALID_PATH')
    const tam = path.resolve(this.y(p))
    if (!tam.startsWith(this.onbellek + path.sep)) fail('INVALID_PATH')
    let gercek, onb
    try {
      if (!fs.lstatSync(this.onbellek).isDirectory()) fail('INVALID_PATH') // önbellek dizininin kendisi bağ olamaz
      onb = fs.realpathSync(this.onbellek)
      gercek = fs.realpathSync(tam)
    } catch { fail('INVALID_PATH') }
    if (gercek !== path.join(onb, path.relative(this.onbellek, tam))) fail('INVALID_PATH')
    let fd
    try { fd = fs.openSync(tam, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK) } catch { fail('INVALID_PATH') }
    try {
      // Açılan dosyanın gerçek yolu (Linux /proc/self/fd): realpath ile open arasında bir ara dizin bağla değiştirilse de
      // önbellek dışındaki dosya kullanılmaz (açılış öncesi inceleme; O_NOFOLLOW yalnız son bileşeni korur)
      let acilan = null
      try { acilan = fs.readlinkSync('/proc/self/fd/' + fd) } catch {}
      if (acilan !== null && !acilan.startsWith(onb + path.sep)) fail('INVALID_PATH')
      const st = fs.fstatSync(fd)
      if (!st.isFile()) fail('INVALID_PATH')
      if (st.size > max) fail(asim)
      const b = b4a.alloc(st.size)
      let n = 0
      while (n < st.size) {
        const r = fs.readSync(fd, b, n, st.size - n, n)
        if (r === 0) fail('INVALID_PATH')
        n += r
      }
      return b
    } finally { fs.closeSync(fd) }
  }

  // --- Sürüm tekdüzeliği (RFC-0026 c) ----------------------------------------------------------------------------

  // Geri çekilmiş ve bozuk sürüm hiçbir yoldan kurulmaz. enYuksek'ten düşük sürüm yalnız o sürümün bildirim özetine
  // bağlı geçerli bir ebeveyn UPDATE_APPROVE'uyla; onayı yardımcı kendi defter kopyasıyla doğrular.
  _kurulabilir (d, vc, surum, onay, hedefBildirim) {
    if (d.revoked.includes(vc)) fail('VERSION_REVOKED')
    if (d.bozuk.includes(vc)) fail('VERSION_CORRUPT')
    if (vc >= d.enYuksek) return
    if (d.onayli[surum] > this.simdi()) return
    const L = onay && this.kanca.defter ? this.kanca.defter() : null
    if (!L || !this.nodeId) fail('APPROVAL_REQUIRED')
    const gorulen = new Map(Object.entries(d.gorulen))
    const m = S.onayDenetle(L, b4a.from(onay), { me: this.nodeId, simdi: this.simdi(), gorulen, kok: this._kokDurumu(), hedef: hedefBildirim })
    if (m.op !== 'dusur' || m.toVersionCode !== vc || m.product !== 'havenfold-node') fail('MANIFEST_ERROR')
    d.gorulen = Object.fromEntries(gorulen)
    d.onayli[surum] = m.expiresAt
    this._durumYaz(d)
  }

  _dogrulandi (dizin) { try { return fs.readFileSync(path.join(dizin, '.dogrulandi'), 'utf8') } catch { return null } }

  // { surum, dosya, ozet, bildirim, onay? }: dosya ve bildirim denetçinin önbelleğindeki yollar. Yardımcı bildirimi
  // kendi kök durumuyla doğrular, paketin listede olduğunu ve özetin tuttuğunu kendisi hesaplar. Aynı bildirimle
  // açılmış sürüm yeniden istenirse (yeniden başlamış denetçi) dizin olduğu gibi döner.
  paketAc ({ surum, dosya, ozet, bildirim, onay = null }) {
    if (typeof surum !== 'string' || !SURUM_RE.test(surum)) fail('INVALID_INPUT')
    const bBytes = this._onbellekten(bildirim, BILDIRIM_MAX)
    const { m, ozet: mOzet } = S.bildirimCoz(bBytes, this._kokDurumu())
    if (m.version !== surum || m.product !== 'havenfold-node') fail('MANIFEST_ERROR')
    const satir = m.packages.find((p) => p.os === this.os && p.arch === this.arch)
    if (!satir || hex(satir.digest) !== ozet) fail('MANIFEST_ERROR')
    const d = this._durum()
    const yeniCekilen = m.revoked.filter((v) => !d.revoked.includes(v))
    if (yeniCekilen.length) { d.revoked.push(...yeniCekilen); this._durumYaz(d) }
    this._kurulabilir(d, m.versionCode, surum, onay, bBytes)
    const hedef = path.join(this.surumler, surum)
    const dizin = path.relative(this.kok, hedef)
    if (fs.existsSync(hedef)) {
      if (this._dogrulandi(hedef) !== hex(mOzet)) fail('VERSION_EXISTS')
      d.paketler[surum] = { versionCode: m.versionCode, ozet: hex(mOzet) }
      this._durumYaz(d)
      return { dizin, zaten: true }
    }
    const bytes = this._onbellekten(dosya, Math.min(PAKET_MAX, satir.size), 'DIGEST_MISMATCH') // listedeki boyuttan büyük okunmaz
    S.dosyaDenetle(satir, { ozet: S.paketOzeti(bytes), boyut: bytes.byteLength })
    const gecici = hedef + '.yeni'
    fs.rmSync(gecici, { recursive: true, force: true })
    fs.mkdirSync(gecici, { recursive: true, mode: 0o755 })
    try {
      for (const g of zipOku(bytes)) {
        const p = path.join(gecici, g.ad)
        if (!p.startsWith(gecici + path.sep)) fail('INVALID_PACKAGE')
        fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o755 })
        fs.writeFileSync(p, g.bytes, { flag: 'wx', mode: g.ad.startsWith('bin/') || CALISTIRILABILIR.has(g.ad) ? 0o755 : 0o644 })
      }
      fs.writeFileSync(path.join(gecici, '.dogrulandi'), hex(mOzet), { mode: 0o644 })
      fs.writeFileSync(path.join(gecici, '.bildirim'), bBytes, { mode: 0o644 }) // surum-gec'te düşürme onayı için
      fs.renameSync(gecici, hedef)
    } catch (err) {
      fs.rmSync(gecici, { recursive: true, force: true })
      throw err
    }
    d.paketler[surum] = { versionCode: m.versionCode, ozet: hex(mOzet) }
    this._durumYaz(d)
    return { dizin }
  }

  _bag (ad) { return this.y('opt/havenfold', ad) }
  _hedef (ad) { try { return path.basename(fs.readlinkSync(this._bag(ad))) } catch { return null } }

  // Atomik bağ değişimi: yeni bağ geçici adla kurulur ve rename ile yerine konur
  _bagKur (ad, surum) {
    const gecici = this._bag('.' + ad + '.yeni')
    fs.rmSync(gecici, { force: true })
    fs.symlinkSync(path.join('surumler', surum), gecici)
    fs.renameSync(gecici, this._bag(ad))
  }

  // acilis: açılış birimi (havenfold-acilis, oneshot, Before=havenfold-denetci) içinden; restart'ı beklemek denetçinin
  // başlama işiyle karşılıklı beklemedir (iş, açılış biriminin bitmesini bekler). Orada kuyruğa bırakılır (Codex 12. tur)
  _yenidenBaslat ({ acilis = false } = {}) {
    this.kanca.systemctl([...(acilis ? ['--no-block'] : []), 'restart', 'havenfold-denetci.service', 'havenfold-kutu.service', 'havenfold-isci.service'])
  }

  // { surum, onay? }: yardımcının açıp doğruladığı sürüm. Geçişten önce deneme kaydı kalıcı yazılır (RFC-0026 d):
  // denetçi yeniden başlasa da sağlık penceresi ve geri dönüş yardımcıdadır. guncel → onceki, yeni → guncel.
  surumGec ({ surum, onay = null }) {
    if (typeof surum !== 'string' || !SURUM_RE.test(surum)) fail('INVALID_INPUT')
    const dizin = path.join(this.surumler, surum)
    const d = this._durum()
    const p = d.paketler[surum]
    if (!p || this._dogrulandi(dizin) !== p.ozet) fail('UNVERIFIED')
    if (d.deneme) fail('TRIAL_RUNNING')
    const simdiki = this._hedef('guncel')
    if (simdiki === surum) fail('ALREADY_CURRENT')
    this._kurulabilir(d, p.versionCode, surum, onay, fs.readFileSync(path.join(dizin, '.bildirim')))
    d.deneme = { onceki: simdiki, yeni: surum, yeniKod: p.versionCode, bitis: this.simdi() + SAGLIK_MS, acilis: 0, saglik: [] }
    delete d.onayli[surum]
    this._durumYaz(d)
    if (simdiki) this._bagKur('onceki', simdiki)
    this._bagKur('guncel', surum)
    const silinen = this._eskileriSil(d)
    this._yenidenBaslat()
    return { guncel: surum, onceki: simdiki, silinen }
  }

  // Yalnız açık bir sağlık penceresinde, son geçişin bir önceki sürümüne (RFC-0026 c); denenen sürüm bozuk sayılır
  surumGeri () {
    const d = this._durum()
    if (!d.deneme || this.simdi() > d.deneme.bitis) fail('NO_TRIAL')
    return this._geriDon(d, 'denetci')
  }

  _geriDon (d, neden, { acilis = false } = {}) {
    const dn = d.deneme
    // Önceki sürüm yoksa (ilk kurulumun denemesi) dönülecek yer yok: "geri alındı" denmez, sürüm bozuk işaretlenir ve
    // guncel kalır; durum 'geri-alinamadi' (açılış öncesi inceleme)
    if (!dn.onceki) {
      if (!d.bozuk.includes(dn.yeniKod)) d.bozuk.push(dn.yeniKod)
      d.deneme = null
      d.sonGecis = { onceki: null, yeni: dn.yeni, yeniKod: dn.yeniKod, durum: 'geri-alinamadi', neden }
      this._durumYaz(d)
      return { durum: 'geri-alinamadi', guncel: dn.yeni, bozuk: dn.yeni }
    }
    this._bagKur('guncel', dn.onceki)
    fs.rmSync(this._bag('onceki'), { force: true })
    if (!d.bozuk.includes(dn.yeniKod)) d.bozuk.push(dn.yeniKod)
    d.deneme = null
    d.sonGecis = { onceki: dn.onceki, yeni: dn.yeni, yeniKod: dn.yeniKod, durum: 'geri-alindi', neden }
    this._durumYaz(d)
    this._eskileriSil(d)
    this._yenidenBaslat({ acilis: acilis === true })
    return { durum: 'geri-alindi', guncel: dn.onceki, bozuk: dn.yeni }
  }

  // Sağlık bildirimi (RFC-0026 d): denetçi ve düğümdeki her çekirdek, kendi kimliğiyle ve çalıştığı sürümle. Hepsi
  // pencere içinde bildirince geçiş tamamlanır ve enYuksek yükselir; denetçinin tek başına beyanı yetmez.
  saglikBildir (rol, { surum }) {
    const d = this._durum()
    const dn = d.deneme
    if (!dn) return { durum: d.sonGecis ? d.sonGecis.durum : 'yok' }
    if (surum !== dn.yeni) fail('VERSION_MISMATCH')
    if (this.simdi() > dn.bitis) return { durum: 'bekle' } // süre doldu: deneme denetimi geri alacak
    if (!dn.saglik.includes(rol)) dn.saglik.push(rol)
    if (['denetci', ...this.kanca.roller()].every((r) => dn.saglik.includes(r))) {
      d.enYuksek = Math.max(d.enYuksek, dn.yeniKod)
      d.sonGecis = { onceki: dn.onceki, yeni: dn.yeni, yeniKod: dn.yeniKod, durum: 'gecti', neden: '' }
      d.deneme = null
    }
    this._durumYaz(d)
    return { durum: d.deneme ? 'bekle' : 'gecti' }
  }

  // Kökün zamanlayıcısı (her dakika) ve açılış birimi ({ acilis: true }) çalıştırır: pencere doldu ya da düğüm üç kez
  // açılıp sağlıklı olmadıysa geri döner. Yeni sürümün kodu bu kararda yer almaz.
  denemeDenetle ({ acilis = false }) {
    const d = this._durum()
    const dn = d.deneme
    if (!dn) return { durum: 'yok' }
    if (acilis === true) { dn.acilis++; this._durumYaz(d) }
    if (this.simdi() > dn.bitis) return this._geriDon(d, 'sure', { acilis })
    if (dn.acilis >= ACILIS_SINIRI) return this._geriDon(d, 'acilis', { acilis })
    return { durum: 'bekle', bitis: dn.bitis, acilis: dn.acilis }
  }

  // --- Disk şifrelemesinin kurtarma anahtarı (RFC-0007 §6.4, §8.5) ----------------------------------------------

  // { istek: 'oku' | 'sil' }. Anahtar ilk açılışta /var/lib/havenfold/yetki/luks-kurtarma'ya (kök, 0600) yazılır;
  // törenden sonra çekirdek denetçi üzerinden okur (RECOVERY_KEY, IPC 22), töreni yapan ebeveynin telefonuna
  // NODE_RECOVERY ile gönderir; telefonun 'alindi' onayı gelince siler. Dosya yalnız kökün dizininde, bağ değil,
  // düzenli dosya ve tam 32 bayt olmalı. Silmede önce sıfırla üzerine yazılır (sanitize değildir; disk LUKS'ludur).
  // Dönüş: oku → { var: true, anahtar: onaltılık } ya da { var: false }; sil → { silindi: bool }
  luksKurtarma ({ istek }) {
    if (istek !== 'oku' && istek !== 'sil') fail('INVALID_INPUT')
    this._dizinDenetle()
    const p = path.join(this.yetkiDizini, 'luks-kurtarma')
    let fd
    try { fd = fs.openSync(p, (istek === 'sil' ? fs.constants.O_RDWR : fs.constants.O_RDONLY) | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK) } catch (err) {
      if (err.code === 'ENOENT') return istek === 'oku' ? { var: false } : { silindi: false }
      fail('RECOVERY_CORRUPT')
    }
    try {
      const st = fs.fstatSync(fd)
      if (!st.isFile() || st.size !== KURTARMA_BOY) fail('RECOVERY_CORRUPT')
      if (istek === 'sil') {
        fs.writeSync(fd, b4a.alloc(KURTARMA_BOY), 0, KURTARMA_BOY, 0)
        fs.fsyncSync(fd)
      } else {
        const b = b4a.alloc(KURTARMA_BOY)
        if (fs.readSync(fd, b, 0, KURTARMA_BOY, 0) !== KURTARMA_BOY) fail('RECOVERY_CORRUPT')
        return { var: true, anahtar: hex(b) }
      }
    } finally { fs.closeSync(fd) }
    fs.unlinkSync(p)
    return { silindi: true }
  }

  // 40 ≤ start < stop ≤ 100
  pilEsigi ({ start, stop }) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stop) || !(start >= 40 && start < stop && stop <= 100)) fail('INVALID_INPUT')
    return this.kanca.pilYaz({ start, stop })
  }

  yenidenBaslat ({ neden }) {
    if (!['guncelleme', 'isletim-sistemi', 'emeklilik'].includes(neden)) fail('INVALID_INPUT')
    this.kanca.systemctl(['reboot'])
    return { neden }
  }

  // En çok iki sürüm dizini tutulur (guncel, onceki); daha eskisi silinir (§12.6 madde 6). Silinen sürümün paket
  // kaydı da düşer; yeniden kurulması yeniden açılmasını ister.
  _eskileriSil (d) {
    const tut = new Set([this._hedef('guncel'), this._hedef('onceki')].filter(Boolean))
    const silinen = []
    for (const x of fs.existsSync(this.surumler) ? fs.readdirSync(this.surumler) : []) {
      if (tut.has(x)) continue
      fs.rmSync(path.join(this.surumler, x), { recursive: true, force: true })
      silinen.push(x)
      delete d.paketler[x]
    }
    if (silinen.length) this._durumYaz(d)
    return silinen.sort()
  }
}

module.exports = { YetkiYardimcisi, ISLEMLER, BU_SURUMDE, SAGLIK_MS, ACILIS_SINIRI }
