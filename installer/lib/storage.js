// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// lib/storage.js — otomatik kurulum dosyasına ağ adı ve depolama bölümü yazma (RFC-0007 §8.3)
//
// Subiquity early-commands bittikten sonra /autoinstall.yaml'ı yeniden okur. hf-on-kontrol ağ adını, hf-depolama-yaz
// storage bölümünü (TPM varsa geçici LUKS parolasıyla) bu dosyaya yazar; parola USB'ye hiç yazılmaz, yalnız kurulum
// ortamının belleğindedir. Dosya üst düzeyde `autoinstall:` anahtarıyla ya da onsuz gelebilir; ikisi de desteklenir.
// Dizgeler JSON biçiminde yazılır (YAML çift tırnaklı dizgenin alt kümesi): kaçış hatası olmaz.

function fail (code) { throw new Error(code) }

const dizge = (s) => JSON.stringify(String(s))

function girinti (yaml) {
  return /^autoinstall:\s*$/m.test(yaml) ? '  ' : ''
}

// İskeletteki "havenfold-XXXX" yer tutucusu (§8.3) rastgele adla değişir
function hostAdiYaz (yaml, ad) {
  if (!/^havenfold-[0-9a-f]{4}$/.test(ad)) fail('INVALID_HOSTNAME')
  if (!yaml.includes('havenfold-XXXX')) fail('NO_PLACEHOLDER')
  return yaml.split('havenfold-XXXX').join(ad)
}

// curtin seri eşleşmesi glob'dur ve udev'in ID_SERIAL'ı ile karşılaştırılır (model öneki taşır); lsblk'nin kısa
// serisi "*<seri>*" ile eşleşir. Glob özel karakterleri tek karakter joker olur. Seri yoksa yol ile eşleşir.
function eslesme ({ seri, yol }) {
  const s = String(seri || '').trim()
  if (s) return { serial: '*' + s.replace(/[*?[\]\s]/g, '?') + '*' }
  if (!/^\/dev\/[a-z0-9]+$/.test(String(yol || ''))) fail('INVALID_DISK')
  return { path: yol }
}

// Subiquity'nin kurulum ortamına yazdığı /autoinstall.yaml'ın biçimi sürümden sürüme değişebilir. Desteklenenler:
//   blok YAML, üst düzeyde `autoinstall:` ile ya da onsuz; sonda belge sonu işareti (`...`) olabilir
//   JSON ya da üst düzeyi akış (flow) eşlemesi olan YAML: { ... } — bölüm son `}`'den önce JSON nesnesi olarak eklenir
//   (JSON YAML'ın alt kümesidir). Üst düzeyde "autoinstall" anahtarı taşıyan JSON ayrıştırılıp içine eklenir.
// Sanal makine denemesinde (installer/test/vm) 24.04.5'in dosyası blok YAML'a eklenen bölümü reddetti: ekleme
// belgenin bitişinden sonra kalıyordu.
function depolamaNesnesi ({ seri, yol, parola, takas }) {
  const layout = { name: 'lvm', match: eslesme({ seri, yol }) }
  if (parola !== null) layout.password = parola
  return { layout, swap: { size: takas } }
}

// { seri, yol, parola (base32, TPM varsa), takas: bayt } → storage bölümü eklenmiş dosya
function depolamaEkle (yaml, { seri, yol, parola = null, takas = 4 * 1024 ** 3 }) {
  if (parola !== null && !/^[A-Z2-7]{52}$/.test(parola)) fail('INVALID_PASSWORD') // 32 bayt, base32, dolgusuz
  const nesne = depolamaNesnesi({ seri, yol, parola, takas })
  // Sondaki belge sonu işareti ve boşluk atılır; baştaki yorumlar ve `---` yalnız biçim tanımada atlanır
  const govde = yaml.replace(/^\uFEFF/, '').replace(/(\n\.\.\.[ \t]*)?\s*$/, '')
  const icerik = govde.replace(/^(\s*#[^\n]*\n|\s*---[ \t]*\n)*/, '').trim()
  if (icerik.startsWith('{')) {
    let j = null
    try { j = JSON.parse(icerik) } catch {}
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      const hedef = j.autoinstall && typeof j.autoinstall === 'object' ? j.autoinstall : j
      if (hedef.storage !== undefined) fail('STORAGE_EXISTS')
      hedef.storage = nesne
      return JSON.stringify(j, null, 2) + '\n'
    }
    if (/["']?autoinstall["']?\s*:/.test(icerik)) fail('FORMAT_UNSUPPORTED')
    if (/(^|[{,\s])["']?storage["']?\s*:/.test(icerik)) fail('STORAGE_EXISTS')
    if (!icerik.endsWith('}')) fail('FORMAT_UNSUPPORTED')
    return icerik.slice(0, -1).replace(/\s*$/, '') + ', "storage": ' + JSON.stringify(nesne) + '}\n'
  }
  if (/^\s*storage:/m.test(govde)) fail('STORAGE_EXISTS')
  const g = girinti(govde)
  const [anahtar, deger] = Object.entries(nesne.layout.match)[0]
  const satirlar = [
    `${g}storage:`,
    `${g}  layout:`,
    `${g}    name: lvm`,
    `${g}    match: { ${anahtar}: ${dizge(deger)} }`
  ]
  if (parola !== null) satirlar.push(`${g}    password: ${dizge(parola)}`)
  satirlar.push(`${g}  swap: { size: ${takas} }`)
  return govde + '\n' + satirlar.join('\n') + '\n'
}

module.exports = { hostAdiYaz, depolamaEkle, eslesme, dizge }
