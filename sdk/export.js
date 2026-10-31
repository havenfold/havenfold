// SPDX-License-Identifier: Apache-2.0
// export.js — arşivle dışa aktarma ve içe alma kanal yüzeyi (RFC-0014 §10 eki, RFC-0027 §2; D25)
//
// RFC-0024'ten beri SDK worklet'te çalışır; kap (sodium-native) da orada. Tek seferlik ve açık onaylıdır (ilke 6):
// onay ve biyometri ürünün akışındadır. Kişiler görünen adla, iç kimlikler ve iç başvurular dışarı çıkmaz
// (kap.arsiv.kayitDisa); yapay zeka alanları kayıt düzeyinde işaretlenir. Gizli alanlar yalnız istenirse yazılır.
// Kasa koleksiyonu kilitliyse VAULT_LOCKED (RecordApi'nin kasa kancası). Geri yükleme ürünün işidir.
// Dışa aktarma akışla yazılır (D41): yaz(baytlar) verilirse şifreli parçalar platformun dosyasına gider ve bellekte bütün
// kap, ZIP ya da icerik.json tutulmaz; kayıtlar ve dosyalar iki geçişte (ölçüm, yazım) okunur.
const b4a = require('b4a')
const { arsiv: { kayitDisa, disaAktarAkis, iceAlAsync, UZANTILAR } } = require('@havenfold/export')

const hex = (b) => (typeof b === 'string' ? b : b4a.toString(b, 'hex'))
function fail (code) { throw new Error(code) }

const EXPORT_COMMAND = { EXPORT: 390, IMPORT: 391 } // RFC-0027 §2 (390–399 kap)
const MIN_PASSWORD_LENGTH = 12

class ExportApi {
  // kayit: RecordApi; gizliAlanlar(type) → gizli alan adları (ürünün şeması; verilmezse gizliler dışarıda bırakılamaz,
  // NO_EXPORT_SECRET_HOOK: hiçbir alanı sessizce açık saymasın, inceleme 13); kdf: { opslimit, memlimit } (testte düşük)
  constructor ({ kayit, urun = 'yuva-defteri', bicim = 'yuva-defter-arsiv', bicimSurum = 1, gizliAlanlar = null, kdf = {}, now = Date.now }) {
    this.kayit = kayit
    this.urun = urun
    this.bicim = bicim
    this.bicimSurum = bicimSurum
    this.gizliAlanlar = gizliAlanlar
    this.kdf = kdf
    this.now = now
  }

  _ad (tur, id) {
    const L = this.kayit._L
    if (tur === 'uye') { const p = L.canonical(id); return (p && L.members.get(p)?.name) || L.members.get(id)?.name || null }
    if (tur === 'device') return L.devices.get(id)?.name || null
    if (tur === 'grant') return L.grants.get(id)?.name || null
    if (tur === 'varlik') return L.beings.get(id)?.name || null
    if (tur === 'yer') return L.places.get(id)?.name || null
    return null
  }

  // 390 EXPORT: { koleksiyonlar, gizliDahil, parola, yaz? } → { dosyaAdi, bytes | boy, ogeSayisi, eksikDosya }.
  // yaz(baytlar) verilirse kap parça parça ona gider ve dönüşte bytes yerine boy vardır (telefon: dosyaya yazım)
  async export ({ koleksiyonlar, gizliDahil = false, parola, yaz = null }) {
    if (typeof parola !== 'string' || [...parola].length < MIN_PASSWORD_LENGTH) fail('PASSWORD_TOO_SHORT')
    if (!Array.isArray(koleksiyonlar) || !koleksiyonlar.length) fail('COLLECTION_REQUIRED')
    if (!gizliDahil && typeof this.gizliAlanlar !== 'function') fail('NO_EXPORT_SECRET_HOOK')
    const L = this.kayit._L
    const kollar = koleksiyonlar.map(hex).map((c) => { const col = L.collections.get(c); if (!col) fail('NO_COLLECTION'); return { c, col } })
    const satir = (k) => {
      const gizli = new Set(gizliDahil ? [] : this.gizliAlanlar(k.type) || [])
      const fields = Object.fromEntries(Object.entries(k.fields).filter(([a]) => !gizli.has(a)))
      const d = kayitDisa(fields, { kisiAdi: (tur, id) => this._ad(tur, id) })
      d.yapay_zeka_alanlari = d.yapay_zeka_alanlari.filter((a) => !gizli.has(a)) // gizli alanın adı da çıkmaz
      return { kayit: { tur: k.type, olusturma: k.olusturma, degisme: k.degisme, ...d }, fields }
    }
    // Ön geçiş: kayıtlar okunabilir mi (kasa kilidi), dosyalar ve sayılar; dosya baytları burada okunmaz
    const dosyalar = []
    const adlar = new Set()
    let ogeSayisi = 0
    let eksikDosya = 0
    // Kayıtlar koleksiyon başına bir kez çözülür (iki geçiş aynı diziden serileştirir; her geçişte yeniden çözmek
    // sayfa sayısıyla büyüyen çöp bırakıyordu)
    for (const x of kollar) x.kayitlar = this.kayit.query(x.c)
    for (const { kayitlar } of kollar) {
      for (const k of kayitlar) {
        ogeSayisi++
        for (const v of Object.values(satir(k).fields)) {
          for (const ref of (Array.isArray(v) ? v : [v])) {
            if (!ref || typeof ref !== 'object' || !b4a.isBuffer(ref.blobId)) continue
            const yol = kayitDisa({ x: ref }).alanlar.x.dosya.slice(9)
            if (adlar.has(yol)) continue
            if (!this._dosyaVar(ref)) { eksikDosya++; continue }
            adlar.add(yol)
            dosyalar.push({ ad: yol, ref, bytes: () => this.kayit.open(ref, { bytes: true }).bytes })
          }
        }
      }
    }
    const olusturma = this.now()
    const bas = { bicim: this.bicim, bicimSurum: this.bicimSurum }
    // icerik.json parça parça: { bicim, bicimSurum, olusturma, koleksiyonlar: [{ ad, tur, kasa, kayitlar }] }
    function * icerikParcalari () {
      yield b4a.from(JSON.stringify(bas).slice(0, -1) + ',"olusturma":' + JSON.stringify(olusturma) + ',"koleksiyonlar":[')
      for (let i = 0; i < kollar.length; i++) {
        const { col, kayitlar } = kollar[i]
        yield b4a.from((i ? ',' : '') + JSON.stringify({ ad: col.name, tur: col.kind, kasa: col.sensitivity === 'kasa' }).slice(0, -1) + ',"kayitlar":[')
        let ilk = true
        for (const k of kayitlar) { yield b4a.from((ilk ? '' : ',') + JSON.stringify(satir(k).kayit)); ilk = false }
        yield b4a.from(']}')
      }
      yield b4a.from(']}')
    }
    const toplanan = []
    // Anahtar türetilirken (Argon2id, saniyeler) kasa kilitlenmiş ya da dosya silinmiş olabilir: ilk yaz'dan hemen önce
    // kilit ve dosya varlığı yeniden denetlenir; kilitliyse yaz hiç çağrılmadan VAULT_LOCKED (inceleme 15 B5)
    const oncesi = () => {
      for (const { c, col } of kollar) if (col.sensitivity === 'kasa') this.kayit._kasaDenetle(c)
      for (let i = dosyalar.length - 1; i >= 0; i--) if (!this._dosyaVar(dosyalar[i].ref)) { dosyalar.splice(i, 1); eksikDosya++ }
    }
    const r = await disaAktarAkis({ parola, urun: this.urun, bicim: this.bicim, bicimSurum: this.bicimSurum, icerikParcalari, dosyalar, kdf: this.kdf, oncesi, yaz: yaz || ((b) => toplanan.push(b)) })
    eksikDosya += r.eksik
    const gun = new Date(this.now() + 180 * 60_000).toISOString().slice(0, 10)
    const dosyaAdi = this.urun + '-' + gun + (UZANTILAR[this.bicim] || '.hfkap')
    return yaz ? { dosyaAdi, boy: r.boy, ogeSayisi, eksikDosya } : { dosyaAdi, bytes: b4a.concat(toplanan), ogeSayisi, eksikDosya }
  }

  _dosyaVar (ref) {
    const depo = this.kayit.depo
    const k = hex(ref.blobId)
    return !!(typeof depo.has === 'function' ? depo.has(k) : depo.get(k))
  }

  // 391 IMPORT: { bytes, parola } → { baslik, icerik, dosyalar } (telefon sınırları varsayılan, RFC-0021 h)
  async import ({ bytes, parola }) {
    if (!b4a.isBuffer(bytes)) fail('INVALID_INPUT')
    if (typeof parola !== 'string' || !parola) fail('PASSWORD_TOO_SHORT')
    const a = await iceAlAsync(bytes, parola, { telefon: true })
    if (a.icerik.bicim !== this.bicim) fail('FORMAT_MISMATCH')
    return { baslik: a.baslik, icerik: a.icerik, dosyalar: a.dosyalar }
  }
}

module.exports = { ExportApi, EXPORT_COMMAND, MIN_PASSWORD_LENGTH }
