// SPDX-License-Identifier: Apache-2.0
// @havenfold/sdk — TypeScript türleri (RFC-0001 §16, RFC-0002 §14, RFC-0006 §15, RFC-0015, RFC-0017)
//
// Kimlikler hex metnidir (16 bayt → 32 karakter); bayt alanları Uint8Array. Kayıt değerleri RFC-0001 §4.2'deki
// türlerdir: kayan noktalı sayı yoktur (tamsayı ±(2^52 − 1)).

export type Hex = string
/** Ağdan gelen zarfın yolu (RFC-0007 §14): doğrudan oturum, emanet ya da Posta Kutusu */
export type Yol = 'dogrudan' | 'emanet' | 'posta'
export type Deger = null | boolean | number | string | Uint8Array | BlobRef | Deger[]
export type Alanlar = Record<string, Deger>

export interface BlobRef { blobId: Uint8Array; fileKey: Uint8Array; size: number; mime: string; name: string }

// --- Ortak (RFC-0015) ---------------------------------------------------------------------------------------------

export const COMMAND: { PRESENCE_GET: 350; MEMBER_RESOLVE: 351 }
export const RESERVED: Set<string>

export type Src =
  | { tur: 'msg'; convId: Hex; msgId: Hex }
  | { tur: 'kayit'; collectionId: Hex; recordId: Hex }
  | { tur: 'dosya'; blobId: Hex; sayfa?: number; ms?: number }
  | { tur: 'aktarma'; bicim: string }

export function parseSrc (s: string): Src | null
export function confOf (fields: Alanlar): number
/** Yazmadan önce; hata: RESERVED_FIELD, INVALID_FIELD_VALUE */
export function validateFields (fields: Alanlar, o?: { col?: unknown }): void

export class Emitter {
  on (ad: string, fn: (...a: any[]) => void): this
  off (ad: string, fn: (...a: any[]) => void): this
  emit (ad: string, ...a: any[]): void
}

export interface UyeCozumu { activeId: Hex | null; name: string; role: string | null; active: boolean; personId: Hex | null; primaryId: Hex | null }
export function resolveMember (ledger: unknown, memberId: Hex | Uint8Array, atLedgerSeq?: number | null): UyeCozumu
export function personOf (ledger: unknown, memberId: Hex | Uint8Array): { personId: Hex; primary: Hex | null; identities: Hex[]; extra: boolean } | null

export interface Presence { lastSeenMs: number | null; via: 'dogrudan' | 'emanet' | 'yok'; online: boolean }
export class Presence {
  /** caps zorunlu: HIDE_PRESENCE üyenin son HELLO.caps değerinden okunur */
  constructor (o: { ledger: unknown; me: Hex | Uint8Array; caps: unknown; now?: () => number })
  direct (memberId: Hex, at?: number): void
  sessionOpened (memberId: Hex): void
  sessionClosed (memberId: Hex): void
  hold (memberId: Hex, hlcMs: number): void
  presence (memberId: Hex): Presence
  /** Yalnız 24 saat (RFC-0019 §11.7 a); kişinin bütün kimliklerinden */
  presenceWithin (memberId: Hex, saat?: 24): boolean | null
}
export function coarseTime (lastSeenMs: number | null, now: number, o?: { utcDk?: number }): string | null

// --- Kayıt (RFC-0001 §16) ---------------------------------------------------------------------------------------

export interface CollectionInfo { collectionId: Hex; name: string; kind: 'genel' | 'kisisel' | 'bakici' | 'olaylar'; sensitivity: 'normal' | 'kasa'; taskAccess: boolean; history: boolean; owner: Hex | null; readers: string[]; writers: string[]; okur: boolean; writable: boolean }
export interface Kayit { recordId: Hex; collectionId: Hex; type: string; fields: Alanlar; authorId: Hex; olusturan: Hex; olusturma: number; degistiren: Hex; degisme: number }
export interface GecmisSatiri { op: 'put' | 'del' | 'append'; opId: Hex; authorId: Hex; at: number; alanlar: Alanlar; kaybeden: string[] }
export interface Cikarim { type: string; recordId?: Hex; fields: Alanlar }
export interface DosyaDeposu { get (blobId: Hex): Uint8Array[] | null; set (blobId: Hex, chunks: Uint8Array[]): void; delete (blobId: Hex): void }

export class MemoryBlobStore implements DosyaDeposu {
  constructor (o?: { sinir?: number })
  get (blobId: Hex): Uint8Array[] | null
  set (blobId: Hex, chunks: Uint8Array[]): void
  delete (blobId: Hex): void
}

export class RecordApi extends Emitter {
  constructor (o: { replika: unknown; depo?: DosyaDeposu; dosyaYaz?: (blobRef: BlobRef, bytes: Uint8Array) => string; dosyaOku?: (yol: string) => Uint8Array; dosyaYuklendi?: (blobRef: BlobRef, mesajlar: Uint8Array[]) => void; kasa?: { kilitli (): boolean; dokun (): void } | null })
  /** Bu telefonda attach ile eklenen dosyalar (blobId hex; RFC-0025 §1 a) */
  readonly eklenen: Set<Hex>
  /** Okunamayan koleksiyon da okur: false ile döner */
  collections (): CollectionInfo[]
  get (collectionId: Hex, recordId: Hex): Kayit | null
  query (collectionId: Hex, o?: { type?: string; where?: Alanlar; limit?: number }): Kayit[]
  history (collectionId: Hex, recordId: Hex): GecmisSatiri[]
  /** _ai ve _aiyol reddedilir (AI_APPROVAL_REQUIRED); var olan kayda tür yazılamaz (TYPE_CANNOT_CHANGE) */
  put (collectionId: Hex, recordId: Hex | null, type: string, fields: Alanlar): Hex
  del (collectionId: Hex, recordId: Hex): void
  sync (): void
  /** Onay ekranı; "Kaydet" dokunuşunda tek kullanımlık jeton, vazgeçilirse null */
  /** RFC-0013 §8.5: yapay zeka çıkarımını yazar; hata INVALID_APPROVAL_TOKEN */
  attach (file: { bytes?: Uint8Array; path?: string; mime?: string; name?: string }): { blobRef: BlobRef; mesajlar?: Uint8Array[] }
  /** { bytes: true }: dosyaYaz kancası varken de bayt (D23 33); kasa kaydındaki dosya kilitliyken VAULT_LOCKED */
  open (blobRef: BlobRef, secenek?: Uint8Array[] | { chunks?: Uint8Array[]; bytes?: boolean }): { bytes: Uint8Array } | { path: string }
  /** 249 RECORD_MOVE: _src'ye kayit: başvurusu eklenir; degisiklik'teki alanlar yapay zeka sayılmaz. Hata VAULT_SOURCE, RESERVED_FIELD */
  move (kaynakId: Hex, recordId: Hex, hedefId: Hex, degisiklik?: Alanlar | null): Hex
  /** yol: zarfın geldiği yol (zorunlu; verilmezse INVALID_CHANNEL) */
  blobHaveReceived (peerHex: Hex, bytes: Uint8Array, yol: Yol): void
  copyCount (blobId: Hex | Uint8Array): { telefon: number; kutu: number; isci: number }
  writeStatus (collectionId: Hex, recordId: Hex): 'yazildi' | 'kuyrukta' | 'yok'
  fetchRequest (blobRef: BlobRef): { type: number; bytes: Uint8Array }
  blobReceived (peer: Hex, bytes: Uint8Array, yol: Yol): 'tamam' | 'eksik'
  changed (collectionId: Hex, recordIds: Hex[]): void
  on (ad: 'change', fn: (collectionId: Hex, recordIds: Hex[]) => void): this
  off (ad: 'change', fn: (collectionId: Hex, recordIds: Hex[]) => void): this
}

// --- Olay (RFC-0006 §15) ----------------------------------------------------------------------------------------

export interface OlayTuru { tur: string; v: number; olay: boolean; yazar: 'uye' | 'cihaz' | 'ikisi'; ozne: string[]; alanlar: { ad: string; deger: string; zorunlu?: boolean; birim?: string }[]; kapsam?: string; keep?: number; ozel?: boolean; ozet?: string; onem?: number }
export interface OlayKaydi { recordId: Hex; type: string; t: number; subj: string; key: Hex | null; conf: number; fields: Alanlar; authorHex: Hex; yazar: 'uye' | 'cihaz' | 'misafir' }
export interface Vaka { vaka: Hex; subj: string; kaynak: string; onem: 0 | 1 | 2 | 3; ilk: number; son: number; gecerli: [number, number][]; ulasilan: [number, number] | null; sahipli: boolean; sahip: Hex | null; kapali: boolean; sonuc: 'gercek' | 'yanlis' | 'bilgi' | null; bastirilmis: boolean; sorumlu: Hex[]; durum: 'acik' | 'sahipli' | 'cozuldu' | 'kapali'; /** RFC-0032 §6: biçim 2 kuralının vakası hesaplanan durumla çözülür */ cozuldu?: boolean; cozen?: { neden: 'kapatan' | 'kosul'; recordId: Hex | null; type: string | null; yazar: 'uye' | 'cihaz' | 'misafir' | null; authorHex: Hex | null; t: number | null } | null }

/** RFC-0031 §5: konum (SOS'ta yuvarlanmaz). Kayıtta [latE5, lonE5, accM, at] listesi olarak durur. */
export interface SosKonum { latE5: number; lonE5: number; accM: number; at: number }
/** RFC-0031 §3: hf.sos'un isteğe bağlı alanları */
export interface SosAlanlari { yol?: 'dugme' | 'zorlama-pin' | 'afet'; konum?: SosKonum; metin?: string; pil?: number; afetMid?: Hex | Uint8Array; sessiz?: boolean; t?: number }
/** Gösterilen SOS: motor için geçersiz olsa da listede (gecerli: false, neden) */
export interface Sos { recordId: Hex; t: number | null; subj: string | null; yazar: 'uye' | 'cihaz' | 'misafir'; authorHex: Hex; yol: 'dugme' | 'zorlama-pin' | 'afet'; konum: SosKonum | null; metin: string | null; pil: number | null; afetMid: Hex | null; /** D103: alıcı başına bütün afet mid'leri (afet_mid dahil) */ afetMidler: Hex[]; sessiz: boolean; gecerli: boolean; neden: string | null }

/** RFC-0037 §12 */
export interface SosAlicisi { personId: Hex; durum: 'aldi' | 'bekliyor' | 'bilinmiyor'; at: number | null; yol: 'kayit' | 'afet' | null }

export class EventApi extends Emitter {
  /** saklama: afet bağıyla tekilleştirmenin kalıcı durumu (RFC-0031 §6) */
  /** afet: SOS alındısında afet ALINDI'sı (RFC-0037 §7) için DisasterApi ya da { receiptOf } */
  constructor (o: { kayit: RecordApi; katalog?: unknown; now?: () => number; saklama?: { get (k: string): unknown; set (k: string, v: unknown): void } | null; sosTekil?: unknown; afet?: { receiptOf (mid: Hex): { kimlik: Hex; alindi: boolean; at: number | null } | null } | null })
  /** Üyenin SOS'u; özne yazanın kendisi. Hata INVALID_SOS_PATH, INVALID_SOS_LOCATION, SOS_METIN, INVALID_SOS_BATTERY, INVALID_SOS_DISASTER_MID, INVALID_SOS_SILENT */
  /** afetMidler (RFC-0037 §7): aynı SOS'un afet mid'leri; yalnız yerel durumda, sosAlicilari'nda birleşir */
  writeSos (collectionId: Hex, o?: SosAlanlari & { afetMidler?: Hex[] }): Hex
  /** RFC-0037 §6: SOS'un alıcıları; NO_RECORD */
  sosRecipients (collectionId: Hex, sosRecordId: Hex): SosAlicisi[]
  /** Bütün SOS'lar, yeniden eskiye; geçersiz alanlı olanlar da (RFC-0031 §3) */
  listSos (collectionId: Hex): Sos[]
  /** Aynı afetMid 7 gün içinde bir kez bildirilir (afet mesajı ve kayıt; RFC-0031 §6) */
  shouldNotifySos (afetMid: Hex | Uint8Array | Hex[] | null, kimlik?: string | null): boolean
  registerType (tanim: OlayTuru): OlayTuru
  write (collectionId: Hex, tur: string, alanlar: { subj: string; t?: number; place?: string; scope?: string; conf?: number; key?: Uint8Array; obs?: string; keep?: number; src?: string[] } & Alanlar): Hex
  query (collectionId: Hex, o?: { tur?: string; ozne?: string; from?: number; to?: number; limit?: number }): OlayKaydi[]
  cards (collectionId: Hex): unknown[]
  writeCard (collectionId: Hex, recordId: Hex | null, alanlar: Alanlar): Hex
  writeRoutine (collectionId: Hex, recordId: Hex | null, alanlar: Alanlar): Hex
  /** Biçim 2 (RFC-0032): bicim, gun_saati, gun, utc_dk, kapatan_olay, kesintide_ac. Uymayan kural INVALID_RULE */
  writeRule (collectionId: Hex, recordId: Hex | null, alanlar: Alanlar): Hex
  cases (collectionId: Hex, o?: { durum?: 'acik' | 'sahipli' | 'cozuldu' | 'kapali' }): Vaka[]
  /** Motorun önerileri: yeni vakalar, bastırmalar, bu telefonun yazımları; durumu değişen vaka için 'case' olayı */
  evaluate (collectionId: Hex): { yeni: { alanlar: Alanlar; basamaklar: [number, number][]; zaman: number }[]; bastirmalar: { vaka: Hex; recordId: Hex; alanlar: Alanlar }[]; yazimlar: unknown[]; vakalar: Vaka[] }
  claim (collectionId: Hex, vaka: Hex): Hex
  close (collectionId: Hex, vaka: Hex, sonuc: 'gercek' | 'yanlis' | 'bilgi'): Hex
  routineStatus (collectionId: Hex, rutinId: Hex): { pencere: number; olgun: boolean; gun: number; m?: number; alt?: number; ust?: number; bugun: number }[]
  on (ad: 'case', fn: (v: Vaka) => void): this
}

// --- Görev (RFC-0002 §14) ---------------------------------------------------------------------------------------

export interface MachineSummary { cekirdek: number; bellekMB: number; bosDiskGB: number; acikCihaz: number; enBuyukTekIsMB: number; calisan: { nodeId: Hex; taskId: Hex; type: string; pct: number }[] }
export interface DeviceInfo { deviceId: Hex; class: string; name: string; status: string; cores: number; ramTotalMB: number; maxTaskRamMB: number; battery: { pct: number; onAC: boolean } | null; tasks: string[]; running: { taskId: Hex; type: string; pct: number }[]; consent: boolean; consentAsked: boolean }

export class TaskApi extends Emitter {
  /** profiller: çalışma profilleri (RFC-0008 §10.1; @havenfold/edge ProfilDefteri); yerleştirmede §5 özellik süzgeci */
  constructor (o: { ledger: unknown; me: unknown; yetenekler: unknown; onay?: unknown; gonder?: (peer: Hex, type: number, bytes: Uint8Array) => void; now?: () => number; rastgele?: () => Uint8Array; profiller?: unknown })
  /** NODE_PROFILE (0xE0): yalnız doğrudan oturumdan (RFC-0008 §10.1, §12) */
  receiveProfile (fromHex: Hex, bytes: Uint8Array, yol: 'dogrudan' | 'emanet' | 'posta'): unknown
  /** Kanal: 252 MACHINE */
  machine (): MachineSummary
  /** Kanal: 253 DEVICES */
  devices (): DeviceInfo[]
  /** allow: yalnız etkin işçiye (NOT_WORKER) ve görev verebilen üyeden (CANNOT_ASSIGN_TASK; 06 Ç7); geri alma her zaman. Kanal: 254 TASK_CONSENT */
  consent (deviceId: Hex, allow: boolean): void
  /** id: iş tutamacı; olaylar ve cancel onunla. Kanal: 250 TASK_REQUEST (paramsFor ve bölme kanalda yok), olay 'task' */
  run (type: string, version: string, inputs: BlobRef[], params: Uint8Array, opts: { collectionId: Hex; ramMB: number; minutes: number; deadline: number; diskMB?: number; units?: number; splittable?: boolean; telefondaYapilabilir?: boolean; paramsFor?: (parca: { no: number; from: number; to: number }) => Uint8Array }): { id: Hex; yer: 'isci'; taskIds: Hex[] } | { yer: 'telefon' | null; hata?: string }
  /** Kanal: 255 STANDING_START */
  startStanding (type: string, version: string, deviceId: Hex, params: Uint8Array, opts: { collectionId: Hex; ramMB: number; deadline: number; minutes?: number; diskMB?: number }): { id: Hex; taskId: Hex }
  standingPermit (collectionId: Hex, deviceId: Hex): unknown
  receive (from: Hex, type: number, bytes: Uint8Array, yol: Yol): void
  tick (): void
  /** Kanal: 251 TASK_CANCEL */
  cancel (id: Hex): void
  on (ad: 'progress' | 'result' | 'error', fn: (id: Hex, data: unknown) => void): this
}

// --- Defter ve kişi (RFC-0003, RFC-0017) ------------------------------------------------------------------------

export interface YazimSonucu { durum: 'uygulandi' | 'oneri' | 'dustu'; oneriId?: Hex; waitingFor?: Hex[]; event?: unknown }
/** RFC-0031 §4.1: Tüm Aile'ye açılan bırakma anahtarı (yalnız açıldıysa); açılamadıysa sosHata */
export interface SosAnahtari { sosBirakma?: { collectionId: Hex; secret: Uint8Array }; sosAnahtarOlayi?: YazimSonucu; sosHata?: string }
export interface Kimlik { memberId: Hex; appId: string | null; sameDevice: boolean; primary: boolean }
/** RFC-0025 §2: kanalın eksik komutları */
export const CHANNEL_COMMAND: {
  LEDGER_SIGN: 14; PROPOSALS: 225; PROPOSAL_REJECT: 226; TASK_CONSENT: 254
  TASK_REQUEST: 250; TASK_CANCEL: 251; MACHINE: 252; DEVICES: 253; STANDING_START: 255
  INVITE_START: 3; INVITE_CONFIRM: 4; JOIN: 5; INVITE_CANCEL: 205
  RECORD_MOVE: 249; EXPORT: 390; IMPORT: 391
  VAULT_STATUS: 365; VAULT_PAPER_SHARE: 366; VAULT_PAPER_PRINTED: 367; VAULT_PERSONAL: 368; VAULT_CHILD_BACKUP: 369
  CARE_STATUS: 370; CARE_DOSES: 371; CARE_DOSE_MARK: 372; CARE_HEALTH_SETUP: 373
  SHIELD_STATUS: 374; SHIELD_DISABLE: 375; SHIELD_GUARDIANS: 376; SHIELD_INVITE_ANSWER: 377; SHIELD_RESULT: 378; SHIELD_NOTIFICATIONS: 379; SHIELD_VISIBILITY: 380
  LOCAL_MESSAGE: 381; VAULT_PENDING_CHANGES: 382; COLLECTION_SENSITIVITY: 383; AI_PLAN_EXTRACT: 384; CAREGIVER_PREPARE: 385; CAREGIVER_PROPOSE: 386
  VAULT_SETUP_BK: 387; VAULT_SETUP_VRK: 388
  VAULT_ARCHIVE_MOVE: 389
  VAULT_RECOVERY_START: 400; VAULT_RECOVERY_SHARE: 401; VAULT_RECOVERY_FINISH: 402; VAULT_ROTATE: 403; VAULT_RECOVERY_STATUS: 404; VAULT_SHARE_APPROVE: 405
  TEAM_CREATE: 280; TEAM_ROLE: 281; TEAM_ASSIGN: 282; TEAM_TERM: 283; TEAM_NOTICE: 284; TEAM_REMOVE: 285; TEAM_EXIT_STATUS: 286; TEAM_PLACES: 287
  BRIDGE_PREPARE: 288; BRIDGE_RECEIVE: 289
  LOCAL_DRAFT: 352; PERSONAL_MODE_START: 353; PERSONAL_MODE_MOVE: 354; CARE_PROCESS: 355; CARE_MISSED: 356; CARE_CLAIM: 357; SHIELD_ENABLE: 358; SHIELD_REPORT: 359
  CAREGIVER_WRITE_GRANT: 410; GUEST_PERMISSIONS: 411; GUEST_DROP: 412; GUEST_MY_WRITES: 413
}
/** RFC-0003 §5.4 varlık (D98): ürün sunucusunun kanal komutları (430 → LedgerApi.addBeing, 431 → varlikKaldir) */
export const LEDGER_COMMAND: { BEING_ADD: 430; BEING_REMOVE: 431; CAREGIVER_LIST: 440; CAREGIVER_REMOVE: 441 }
export interface Varlik { varlikId: Hex; tur: string; ad: string; yerId: Hex | null }
/** RFC-0034 §8.2: worklet'in aile komutları (SDK yöntemi değil; çerçevede aile istemez) */
export const FAMILY_COMMAND: { FAMILIES: 420; FAMILY_ADD: 421; JOIN_PREPARE: 422; FAMILY_LEAVE: 423; FAMILY_LOCAL_REMOVE: 424; FAMILY_PERMIT_GRANT: 425 }
/** RFC-0017 §9, RFC-0034 §9: bu cihazda olayı bildiren uygulama (aile başına; yerel kanaldaki aile listelerinden) */
export function reportingApp (o: { uygulamalar: Array<{ appId: string; aileler: Array<{ familyId: string; kimlik: 'ana' | 'ek' }> }>; familyId: string; olay: 'mesaj' | 'defter' | 'vaka' | 'sos' | 'cekirdek'; kayitTuru?: string | null }): string | null
/** RFC-0034 §8.2: 420 FAMILIES öğesi (worklet; aile = yerelNo, telefondan çıkmaz) */
export interface AileOzeti {
  aile: string; ad: string; rol: string | null; benimAdim: string
  durum: 'hazir' | 'katiliyor' | 'bozuk' | 'silinecek' | 'ailesiz'; kok: boolean; duzey: string | null; hata?: string
  /** Yerel kanal aile listesi için (uygulama içi; telefondan çıkmaz) */
  familyId?: string | null; kimlik?: 'ana' | 'ek' | null
}
/** RFC-0034 §8.1: kanal çerçevesi; aile verilmezse tek örnekte o, birden çok örnekte FAMILY_AMBIGUOUS */
export interface KanalIstegi { id: number | string; komut: number; govde?: unknown; aile?: string }
/** RFC-0034 §8.1: olay çerçevesi; birden çok örnekte aileye özgü olay aile taşır (aileler, aile-hata, aile-silindi taşımaz) */
export interface KanalOlayi { olay: string; veri: unknown; aile?: string }
/** 225 PROPOSALS sonucunun öğesi; hedef: türün öznesi (üye, cihaz, koleksiyon, misafir…), wipe yalnız çıkarmada */
export interface Oneri { proposalId: Hex; type: string; hedef: Hex | null; wipe?: boolean; imzalar: Hex[]; waitingFor: Hex[]; zaman: number }
export interface MisafirImzasi { memberId: Uint8Array; sig: Uint8Array }

/** D100: eşitleme durumu (yalnız yerel). Olay 'sync-status' */
export interface EsitlemeDurumuVerisi { tasiyici: boolean; cevrimici: Hex[]; bekleyenYazim: number; sonEsitleme: number | null }
export class SyncStatus extends Emitter {
  constructor (o?: { replika?: unknown; now?: () => number; durum?: { bekleyen: Hex[]; son: number | null } | null })
  status (): EsitlemeDurumuVerisi
  changed (): boolean
  transportStatus (acik: boolean): void
  connected (memberId: Hex): void
  disconnected (memberId: Hex): void
  written (opId: Hex): void
  confirmed (opIdler: Hex[]): void
  clear (varMi: (opId: Hex) => boolean): void
  toJSON (): { bekleyen: Hex[]; son: number | null }
}

export class LedgerApi extends Emitter {
  /** uygulamaOf: kimliğin hf.uygulama kaydındaki uygulaması (RFC-0036 §3.3 madde 5); worklet kayıt katmanından verir */
  constructor (o: { ledger: unknown; me?: unknown; gorulme?: Presence; now?: () => number; appId?: string | null; capsBook?: unknown; uygulamaOf?: ((memberId: Hex) => string | null) | null })
  static createFamily (o: { Ledger: unknown; me: unknown; familyName?: string; displayName: string; policy?: unknown; ts?: number; hazirla?: boolean; duzey?: string }): { ledger: unknown; event: unknown; olaylar: unknown[] }
  /** Eşleşme öncesi (ailesiz) uygulama: boş defter; yalnız pairRequest / pairAccept anlamlı. pairAccept'in defteriyle yeni LedgerApi kurulur. */
  static withoutFamily (o: { Ledger: unknown; me: unknown; appId?: string | null; now?: () => number }): LedgerApi
  /** Defterde en az bir olay var mı (ailesiz değil mi) */
  readonly hasFamily: boolean
  static decodeLocalSummary (o: unknown): { appId: string | null; aileAdi: string; kisiSayisi: number; benimAdim: string } | null
  persons (): { memberId: Hex; name: string; role: 'ebeveyn' | 'yetiskin' | 'cocuk'; identities: Hex[]; bekleyen: boolean; bekleme: Bekleme | null }[]
  waiting (memberId: Hex): Bekleme | null
  familyInfo (): { ad: string; duzey: string; tur: 'aile' | 'ekip'; ben: { memberId: Hex; personId: Hex; role: string; name: string } | null; cihazlar: Array<{ deviceId: Hex; name: string; class: string }>; misafirler: Array<{ grantId: Hex; name: string; collections: Hex[]; expiresAt: number; active: boolean; yazma: BakiciYazmaIzni[] }> }
  /** 2.3'e çıkarken misafir varsa Tüm Aile'ye bırakma anahtarı da açılır (sosBirakma, RFC-0031 §4.1) */
  raiseLevel (level: string): YazimSonucu & SosAnahtari
  openCollection (o: { collectionId?: Hex; name: string; kind?: string; readers: string[]; writers: string[]; sensitivity?: 'normal' | 'kasa'; taskAccess?: boolean; history?: boolean }): unknown
  defaultCollections (): unknown[]
  awaitingUpdate (level?: string): { hazir: boolean; eksik: Array<{ memberId: Hex; name: string }>; bekleyen: Array<{ memberId: Hex; name: string }> } | null
  localSummary (): { v: 1; appId: string | null; aileAdi: string; kisiSayisi: number; benimAdim: string }
  /** Komut 362: appId ek kimlikte APP_ATTACH'ten, öbüründe kimliğin hf.uygulama kaydından; null = bilinmiyor (RFC-0036) */
  identities (memberId?: Hex): Kimlik[]
  /** Kişide bu uygulama var mı (RFC-0036 §3.3 madde 6); 'yok' yalnız bütün aktif kimliklerin uygulaması biliniyorsa */
  personAppStatus (personId: Hex, appId: string): 'var' | 'yok' | 'bilinmiyor'
  localApps (): Kimlik[]
  /** D99: bakıcılar (misafirlikler) */
  caregivers (): { grantId: Hex; ad: string; bitis: number; koleksiyonlar: Hex[]; aktif: boolean; verenId: Hex }[]
  /** D99: bakıcıyı kaldırır (REVOKE); iptal: misafire gidecek GUEST_REVOKED baytları */
  removeCaregiver (grantId: Hex, o?: { neden?: string }): YazimSonucu & { iptal: Uint8Array | null }
  /** RFC-0003 §5.4 aktif varlıklar (hayvan, bitki…) */
  beings (): Varlik[]
  /** 430: ebeveyn hemen yazar, yetişkinde öneri; çocuk ve misafir PARENT_REQUIRED / NO_MEMBER */
  addBeing (o: { tur: string; ad: string; yerId?: Hex | null; varlikId?: Hex | null }): YazimSonucu & { varlikId: Hex }
  /** 431: varlığı aile kaydından kaldırır (remove: true) */
  removeBeing (varlikId: Hex): YazimSonucu & { varlikId: Hex }
  addMember (o: { deviceCert: unknown; displayName: string; role: string; ceremonyTranscriptHash: Uint8Array; remote?: boolean; activatesAt?: number }): YazimSonucu
  /** D101: uzaktan ekleme tören içinde tamamlanır mı; null ya da defterin hata kodu */
  remoteMissing (role: string): string | null
  /** D101: bekleyen üyeyi etkinleştirir (ACTIVATE_MEMBER); WAITING_IN_PROGRESS, NOT_WAITING */
  activateMember (memberId: Hex): YazimSonucu
  /** D106 K3: bu telefonun kendiliğinden etkinleştireceği uzaktan üyeler (daveti bu kimlik başlatmış, bekleme bitmiş) */
  remoteToActivate (): Hex[]
  /** D106 K1: bekleyen uzaktan üyenin daveti (REVOKE, tek ebeveyn); UPDATE_PENDING (err.eksik: bitini bildirmemiş aktif telefon, kutu, cihaz ya da cihaz değişimiyle bekleyen), NO_TARGET */
  revokeMember (memberId: Hex, o?: { reason?: string }): YazimSonucu
  removeMember (memberId: Hex, o?: { reason?: string; wipe?: boolean }): YazimSonucu
  leave (): YazimSonucu
  changeRole (memberId: Hex, role: string): YazimSonucu
  addDevice (o: { deviceCert: unknown; cls: string; name: string; placeId: Hex; caps: Uint8Array; ceremonyTranscriptHash: Uint8Array }): YazimSonucu
  removeDevice (deviceId: Hex, o?: { reason?: string; wipe?: boolean; wipeReportHash?: Uint8Array }): YazimSonucu
  handOverPrimary (newPrimaryId: Hex, o?: { yeni?: unknown }): YazimSonucu
  /** 14 LEDGER_SIGN */
  sign (oneriId: Hex): YazimSonucu
  /** 225 PROPOSALS */
  listProposals (): Oneri[]
  /** 226 PROPOSAL_REJECT: yerel ret; hata NO_PROPOSAL */
  rejectProposal (oneriId: Hex): void
  /** Duyarlılık değişimi (D23 30): kasaya geçişte görev erişimi kapanır; hata NO_COLLECTION, CLOSED, NO_CHANGE */
  setSensitivity (collectionId: Hex, sensitivity: 'normal' | 'kasa'): YazimSonucu
  /** "Benim kasam": yalnız sahibinin okuduğu kişisel kasa koleksiyonu */
  myPersonalVault (o?: { name?: string }): YazimSonucu
  /** Çıkan ve ayrılan üyeler (D23 31): adı hâlâ izin listesinde geçen koleksiyonlarla */
  departed (o?: { rol?: string | null }): Array<{ memberId: Hex; name: string; role: string; cikis: number; tur: 'cikarildi' | 'ayrildi'; wipe?: boolean; koleksiyonlar: Hex[] }>
  /** Bakıcı önerisi (RFC-0019 §11.3): yalnız ebeveyn (PARENT_REQUIRED); koleksiyonlar verilmezse 'Bakıcı:<ad>' açılır */
  prepareCaregiver (o: { deviceCert: unknown; ad: string; koleksiyonlar?: Hex[] | null; expiresAt: number; ceremonyTranscriptHash: Uint8Array }): { event: unknown | null; koleksiyon: YazimSonucu | null }
  /** Misafirin telefonunda: hazırlanan GRANT olayına misafirin imzası */
  static signGuest (event: unknown, misafir: unknown): MisafirImzasi
  /** Ebeveyn telefonunda: misafirin imzası ve kendi imzasıyla GRANT */
  /** Düzey 2.3'te Tüm Aile'de dropKey yoksa açılır: sosBirakma.secret aynı telefonun replikasına (addDropSecret) */
  proposeCaregiver (event: unknown, misafirImzasi: MisafirImzasi): YazimSonucu & SosAnahtari
  /** RFC-0030 §3: bakıcının bırakma izni (olay 36, düzey 2.3). types boşsa izin kalkar. Hata LEVEL_TOO_LOW,
   *  NOT_COLLECTION_ELIGIBLE, NO_DROP_KEY, INVALID_BODY, GUEST_LIMIT, NO_TARGET, NO_PARENT_SIGNATURE */
  grantCaregiverWrite (o: { grantId: Hex; collectionId: Hex; types: string[]; subjects: string[] }): YazimSonucu
  /** RFC-0030 §5: koleksiyona yeni bırakma anahtarı; secret aynı telefonun replikasına (addDropSecret) verilir */
  openDropKey (collectionId: Hex): YazimSonucu & { birakma: { collectionId: Hex; secret: Uint8Array } }
  caregiverWriteGrants (grantId: Hex): BakiciYazmaIzni[]
  receiveProposal (fromHex: Hex, bytes: Uint8Array, yol: Yol): { oneriId: Hex; durum: string; waitingFor: Hex[] }
  waitingFor (oneriId: Hex): Hex[]
  pairRequest (appId: string): Uint8Array
  pairApprove (req: Uint8Array, o: { approved: boolean; replaces?: Hex | null }): unknown
  pairAccept (ok: Uint8Array): { ledger: unknown; event: unknown }
  changed (): void
  on (ad: 'ledger' | 'security' | 'pair', fn: (x: any) => void): this
  /** D77: bir üyenin (ya da kutunun) doğrudan oturumu açıldı/kapandı; Aile ekranı presence()'ı yeniden okur.
   *  HIDE_PRESENCE açık üyede de olay gelir, presence() yine gizli döner */
  on (ad: 'presence', fn: (x: { memberId: Hex; online: boolean }) => void): this
  devices (): { deviceId: Hex; name: string; class: 'isci' | 'uc' | 'aksesuar' }[]
  resolveMember (memberId: Hex, atLedgerSeq?: number): UyeCozumu
  person (memberId: Hex): ReturnType<typeof personOf>
  presence (memberId: Hex): Presence
  presenceWithin (memberId: Hex, saat?: 24): boolean | null
}

// --- Yapay zeka (RFC-0013 §17; komutlar 270–279) -------------------------------------------------------------

export const AI_COMMAND: { AI_STATUS: 270; AI_ASK: 271; AI_EXTRACT: 272; AI_SAVE: 273; AI_SEARCH: 274; AI_INDEX: 275; AI_MODEL: 276; AI_EXTERNAL: 277; AI_SETTINGS: 278; AI_QUOTA: 279 }
export type YzYol = 'telefon' | 'isci' | 'kural' | 'disari'
export type YzSinif = 'kasa' | 'aile' | 'genel'
export interface YzYetenek {
  platform: null | { id: 'apple-fm' | 'gemini-nano'; surum: string; tr: boolean; baglamToken: number }
  konusma: boolean
  ocr: boolean
  gomme: null | { modelHash: Hex; esik: number }
  isciler: Array<{ deviceId: Hex; aday: boolean; modeller: Array<{ modelHash: Hex; kullanilir: boolean }>; maxTaskRamMB: number; onay: boolean; ad?: string; onayAt?: number | null }>
  bulut: { acik: boolean; kalan: number }
}
export interface Cevap { metin: string; kaynaklar: string[]; yol: YzYol; model: string; sinif: YzSinif; kaynaksiz: boolean; tur?: 'kaynakli' | 'kaynaksiz' | 'sabit'; konu?: 'tibbi' | 'hukuki' | 'mali' | null; celiski?: Array<{ alan: string; kaynaklar: string[] }>; etiket?: string; uyari?: string; not?: string; disariSor?: boolean; ad?: string | null; yardimOner?: true; yardimSatiri?: string }
export interface Bekleme { tur: 'uzaktan' | 'cihaz-degisimi' | 'ana-devir'; memberId: Hex; bitis: number }
export interface KrizCevabi { kriz: true; metin: string; dugmeler: Array<{ tur: 'ara' | 'yaz'; numara?: string; uye?: Hex; etiket: string; taslak?: string; kendiligindenGonder?: false }>; gecmiseYaz: false; modelCagrildi: false }
export interface YzCikarim { sema: string; alanlar: Array<{ ad: string; deger: Deger; conf: number; aralik?: [number, number] }>; kaynak: string[]; model: string; sinif: YzSinif }
export interface AramaSonucu { id: string; collectionId: Hex; recordId: Hex; ref: string; puan: number; eslesen: string[]; metin: string }
export interface CikarSecenek { /** yalnız bu işçi; uygun değilse NO_ELIGIBLE_DEVICE */ isci?: Hex | null; /** işçiye gitmez */ yalnizTelefon?: boolean; /** kaydedilecek koleksiyon: kaynak yoksa görev koleksiyonu; kasa ise sınıf kasa */ hedef?: Hex | null }
export interface PlanKarti { tur: 'etkinlik' | 'yapilacak'; sema: string; cikarim: YzCikarim; zatenEklendi: { collectionId: Hex; recordId: Hex } | null }
export interface YzAyar { gecmis: 'kapali' | 7 | 30 | 365; sorularIsciye: boolean; bulut: boolean; takma: string | null }
export class AiApi extends Emitter {
  constructor (o: { kayit: RecordApi; me: unknown; semalar?: Map<string, unknown>; onayEkrani?: ((g: { collectionId: Hex; sema: unknown; hedef: string; alanlar: unknown[]; sinif: YzSinif }) => Promise<{ son: Alanlar } | null>) | null; yetenek?: () => YzYetenek | Promise<YzYetenek>; model?: ((x: unknown) => Promise<unknown>) | null; gecit?: ((metin: string) => Promise<{ metin: string; model: string }>) | null; kota?: (() => Promise<unknown>) | null; krizSiniflandir?: ((metin: string) => Promise<boolean>) | null; /** D52: toplu kanca (onEkler [sorgu, parça]) anlamsal aramayı ve kriz anlam katmanını açar; eski tekli biçim yalnız kriz katmanını */ gom?: { gom: (metinler: string[], o: { tur: 'sorgu' | 'parca' }) => Array<Float32Array | number[]> | Promise<Array<Float32Array | number[]>>; onEkler: [string, string]; modelHash: Hex; esik?: number | null } | { gom: (metin: string) => Float32Array | number[] | Promise<Float32Array | number[]>; onEk?: string; modelHash?: string } | null; gommeSaklama?: { oku (ad: string): Uint8Array | null; yaz (ad: string, b: Uint8Array): void; sil (ad: string): void } | null; gommeAnahtar?: Uint8Array | null; gommeSiniri?: number; isciModeli?: { modelHash: Hex; ramMB: number } | null; ilkKart?: unknown; onay?: unknown; kasaAcik?: () => boolean; now?: () => number; bolge?: string })
  ledgerAdvanced (): Array<{ cid: Hex; seq: number }>
  status (): Promise<YzYetenek & { krizAnlam: boolean; ilkKart: boolean }>
  isCrisis (metin: string): Promise<boolean>
  crisisLevel (metin: string): Promise<'tam' | 'sinir' | null>
  help (guvenilenler?: Array<{ uye: Hex; ad: string }> | null): KrizCevabi
  firstCardText (): string
  firstCardAcknowledged (): Promise<void>
  ask (girdi: { metin: string; baglam?: { ref: string; metin?: string } | null; guvenilenler?: Array<{ uye: Hex; ad: string }> | null }): Promise<Cevap | KrizCevabi | { ilkKart: true; metin: string } | { hata: string; metin: string; sinif: YzSinif; yardimOner?: true; yardimSatiri?: string }>
  /** 272 AI_EXTRACT; sema null → belgeTuru (yoksa NO_SCHEMA) */
  remove (sema: string | null, girdi: { metin: string }, kaynak?: string[], secenek?: CikarSecenek): Promise<YzCikarim>
  /** Şemaların 'anahtarlar'ından metinde en çok geçenin adı; yoksa null */
  documentType (metin: string): string | null
  /** Sohbetten Plana (RFC-0013 §7.7): kart yalnız bu telefonda; süzgece takılmayan mesaj null; saatte en çok 20 model çağrısı */
  extractPlan (mesaj: { ref: string; metin: string; at: number; yazar?: Hex | null }, o: { semalar: { etkinlik: string; yapilacak: string } }): Promise<PlanKarti | null>
  // Platformun onay ekranını açar; "Kaydet" dönerse tek kullanımlık jeton (hedef koleksiyona, sınıfa ve alanlara bağlı)
  requestApproval (collectionId: Hex, sema: string, cikarim: YzCikarim): Promise<string | null>
  save (collectionId: Hex, cikarim: YzCikarim, onayJetonu: string): Promise<Hex>
  /** 273 AI_SAVE (RFC-0025 §2): onay ekranını kendisi açar; ek alanlar (yapay zeka sayılmaz) aynı işlemde; kapatılırsa null. Hata INVALID_EXTRA_FIELD */
  save (collectionId: Hex, cikarim: YzCikarim, o?: { ek?: Alanlar; sema?: string }): Promise<Hex | null>
  /** Anahtar kelime + (gömme kancası varsa) anlamsal, karşılıklı sıra birleşimi; anlamsal listedeki parça carpim taşır */
  search (metin: string, o?: { koleksiyonlar?: Hex[]; limit?: number }): Promise<Array<AramaSonucu & { carpim?: number }>>
  /** Bekleyen parçaları gömer ve dizin dosyalarını yazar (D52) */
  processEmbedding (): Promise<number>
  directory (islem: 'kur' | 'sil' | 'durum', collectionId?: Hex | null, o?: { turAlanlari?: (type: string) => Array<{ ad: string; etiket?: string }> | null }): { koleksiyonlar: Hex[]; parca: number; gomulu?: number }
  model (islem: 'liste' | 'indir' | 'sil', modelId?: string): Promise<never>
  prepareExternal (metin: string): Promise<{ gidecek: string; jeton: string } | { engel: string[] }>
  askExternal (gidecek: string, jeton: string): Promise<Cevap>
  settings (degisen?: Partial<YzAyar>): Promise<YzAyar>
  quota (): Promise<{ ay: string | null; kalan: number; gunlukKalan: number; paket: boolean }>
}

// --- Kasa (RFC-0004, RFC-0027 §1; D23 29) ------------------------------------------------------------------------

export const VAULT_COMMAND: { LOCK: 19; UNLOCK: 224; VAULT_STATUS: 365; VAULT_PAPER_SHARE: 366; VAULT_PAPER_PRINTED: 367; VAULT_PERSONAL: 368; VAULT_CHILD_BACKUP: 369; VAULT_SETUP_BK: 387; VAULT_SETUP_VRK: 388; VAULT_ARCHIVE_MOVE: 389; VAULT_RECOVERY_START: 400; VAULT_RECOVERY_SHARE: 401; VAULT_RECOVERY_FINISH: 402; VAULT_ROTATE: 403; VAULT_RECOVERY_STATUS: 404; VAULT_SHARE_APPROVE: 405 }
export const LOCK_MS: number
export interface KasaSahibi { tur: 'kisi' | 'kagit' | 'cihaz'; id: Hex; ad: string; /** D31: alındı geldi mi (kâğıtta null) */ teslim?: boolean | null }
export interface KasaDagitimi { t: number; D: number; n: number; kurulur: boolean; neden: string | null; sahipler: KasaSahibi[] }
export interface KagitPay { sira: number; metin: string; qr: string; satirlar: string[]; baslik: string }
export interface KasaKurulumu { secretId: Hex; version: number; dagitim: KasaDagitimi; paylar: Array<{ sahip: KasaSahibi; bytes: Uint8Array; teslim: { to: Hex; type: 0xf1; bytes: Uint8Array } }>; kagitlar: KagitPay[] }
export interface KasaOzeti { version: number; t: number; n: number; sahipler: KasaSahibi[]; at: number; eksikKagit: number[]; dondurmeGerekli: boolean; /** RFC-0027 §9 e: eşzamanlı döndürmede bu telefonun dağıtımı geri çekildi */ kaybetti: boolean; /** §9 f: görülen en büyük sürüm */ bilinen: number }
/** RFC-0027 §9 b: bu telefonun yazdığı son kasa zarfı kaydı ('hf.kasa.zarf') */
export interface KasaZarfOzeti { version: number; envSeq: number; sonDonem: number; donem: number; /** §9 g: kutudaki opak kopya bu zarf mı (kutu yoksa null) */ kutu: boolean | null }
/** §9 g: kutudan alınan zarfın sonucu */
export interface KutuZarfiSonucu { zarf: number; donem: number; sonDonem: number; envSeq: number; anahtar: number; /** zarfın son döneminden sonra anahtarı eksik dönem (eski kopya) */ eksikDonem: number | null }
export const ENVELOPE_TYPE: 'hf.kasa.zarf'
/** Arsive giden (gizli) kasa saklama anahtarı mı (gönderilecek pay baytları, saklı KRA) */
export function isSecret (k: string): boolean
export function paperLines (metin: string): { qr: string; satirlar: string[] }
export class MemoryStorage { get (k: string): unknown; set (k: string, v: unknown): void }
export class VaultApi extends Emitter {
  /** kayit: VaultApi'nin zarf kaydını yazdığı ve kurtarılan dönem anahtarlarını eklediği RecordApi (sonradan da atanabilir) */
  constructor (o: { ledger: unknown; me: unknown; now?: () => number; kilitMs?: number; anahtarDogrula?: ((archiveKeyHex: string) => boolean) | null; saklama?: { get (k: string): unknown; set (k: string, v: unknown): void; delete? (k: string): void; anahtarlar? (): string[] }; uygunCihaz?: (id: Hex) => boolean; kayit?: RecordApi | null; /** RFC-0008 §10.1: cihaz payı adaylığına profil kuralı (linux-konteyner ve TPM mührü) */ kasaProfil?: { profiller: unknown; saglik: (id: Hex) => unknown } | null })
  kayit: RecordApi | null
  /** 19 LOCK: kurtarılan sır, toplanan paylar ve gönderilmemiş onaylı paylar bellekten silinir */
  lock (): void
  /** 224 UNLOCK; hata INVALID_KEY, WRONG_LOCK_KEY */
  unlock (archiveKeyHex: string): void
  locked (): boolean
  /** Kasa koleksiyonundaki her işlemde (RecordApi): kilitliyse VAULT_LOCKED */
  touch (): void
  bkDistribution (o?: { sahip?: Hex | null; kisiler?: Hex[] | null; kagit?: number | null; yalnizKagit?: boolean }): KasaDagitimi
  vrkDistribution (collectionId: Hex, o?: { kagit?: number }): KasaDagitimi
  childBackup (cocukId: Hex, o?: { yalnizKagit?: boolean }): KasaDagitimi
  /** sir (32 bayt) kurulumdan sonra sıfırlanır; kâğıt metni yalnız burada döner */
  /** 387; kanal gövdesinde sır bayt olarak ({ sir: { $b } }) gelir, çözülen tampon kurulumdan sonra sıfırlanır. Başkasının
   *  YA'sı kurulmaz: sahip bu kimlik değilse UNAUTHORIZED (RFC-0004 §3, D36) */
  setupBackupKey (sir: Uint8Array, o?: { sahip?: Hex | null; kisiler?: Hex[] | null; kagit?: number | null; yalnizKagit?: boolean }): Promise<KasaKurulumu>
  /** 388: collectionId null ise 'Kasa' koleksiyonu kurulur (öneri beklerse yalnız { koleksiyon }); sir verilmezse KRA burada üretilir */
  setupRecoveryKey (collectionId: Hex | null, sir?: Uint8Array | null, o?: { kagit?: number }): Promise<(KasaKurulumu & { collectionId: Hex; koleksiyon?: YazimSonucu }) | { koleksiyon: YazimSonucu }>
  /** 389 (D40): arşivi yeni Arşiv anahtarına taşır (eski gizli anahtar kanıt); atomik. Yanlış eski anahtar WRONG_LOCK_KEY */
  moveArchive (eskiArchiveKeyHex: Hex, yeniArchivePubHex: Hex): { oge: number }
  /** 366: kâğıt pay üretir (yeni sürüm); metin yalnız bu sonuçta */
  paperShare (o: { tur?: 'ya' | 'kra'; collectionId?: Hex | null; sir: Uint8Array; kagit?: number; sahip?: Hex | null; kisiler?: Hex[] | null; yalnizKagit?: boolean }): Promise<KasaKurulumu>
  /** 367; anahtar: 'ya:<memberId>' ya da 'kra:<collectionId>' */
  paperPrinted (anahtar: string, sira: number): void
  /** D31 (RFC-0027 §1b): alındısı gelmemiş KASA_SHARE_PUT'lar; platform doğrudan oturumda ya da emanetle gönderir */
  outgoing (): Array<{ to: Hex; type: 0xf1; bytes: Uint8Array; anahtar: string }>
  /** Gelen KASA_SHARE_PUT (giriş noktası): dönen alındıyı (0xF2) gönderene yollar. 'degisti': aynı sürümde commit'i küçük
   *  dağıtım (RFC-0027 §9 e). Hata WRONG_HOLDER, UNAUTHORIZED, DUPLICATE_HOLDER, ROTATION_LOST, ON_HOLD (göndericinin 72
   *  saati sürüyor), MAILBOX_FORBIDDEN */
  receiveShare (fromHex: Hex, bytes: Uint8Array, yol: Yol): { to: Hex; type: 0xf2; bytes: Uint8Array; durum: 'yeni' | 'tekrar' | 'degisti' }
  /** Gelen KASA_SHARE_ACK (giriş noktası) */
  receiveAck (fromHex: Hex, bytes: Uint8Array, yol: Yol): 'teslim' | 'bilinmiyor'
  readonly tutucu: unknown
  // --- Kurtarma ve döndürme (RFC-0004 §5–§6; D67) ---
  /** 400: sürüm sorusu ailenin etkin kimliklerine, sonra o sürümün pay isteği (imzalı). Yeniden çağrılınca istekler
   *  yinelenir (72 saat beklemesinden sonra). KRA'yı yalnız kasanın okuyucusu kurtarır. Hata INVALID_TYPE, NO_COLLECTION, UNAUTHORIZED */
  startRecovery (o?: { tur?: 'ya' | 'kra'; collectionId?: Hex | null }): { tur: 'ya' | 'kra'; secretId: Hex; soruldu: number }
  /** 401: kâğıt payı okutulur. Hata NO_RECOVERY, INVALID_PAPER, PAPER_CHECKSUM, STALE_VERSION, INVALID_SHARE, DUPLICATE_HOLDER */
  recoveryShare (o: { kagit: string }): { durum: 'eklendi' | 'zaten'; paySayisi: number }
  /** 402: paylar birleşir (commit doğrulanır). YA: sirHex platforma; KRA kanala çıkmaz, verilen ve kasa koleksiyonundaki
   *  zarflar açılır, dönem anahtarları replikaya girer (anahtar: eklenen; RFC-0027 §9 b; RecordApi bağlıysa kasa açık
   *  olmalı). Bilinen daha yeni sürüm varken eski sürümle bitmez (§9 f).
   *  Ailede kutu varsa zarf kutudan KRA'dan türetilen etiketle istenir (kutu: 'istendi'; sonuç kurtarmaDurumu
   *  kutuZarfi ve 'vault' olayı kutu_zarfi; §9 g). Kutu yoksa ve hiçbir zarf açılamazsa NO_ENVELOPE.
   *  Hata NO_RECOVERY, INSUFFICIENT_SHARE, SHARE_CORRUPT, DUPLICATE_HOLDER, ENVELOPE_OPEN_FAILED, STALE_VERSION, VAULT_LOCKED, NO_ENVELOPE */
  finishRecovery (o?: { zarflar?: Hex[] }): Promise<{ tur: 'ya' | 'kra'; version: number; secretId: Hex; sirHex?: Hex; collectionId?: Hex; zarf?: number; donem?: number; anahtar?: number; kutu?: 'istendi' | 'alindi' | 'yok' }>
  /** 403: yeni sır, sürüm görülen en büyük sürümden bir fazla, paylar bugünkü sahiplere. Eski sır bilinmeli: YA bu
   *  telefonda kurulmuş ya da kurtarılmış, KRA kurtarılmış, saklı ya da kasa açık (inceleme 19 B1, B5). KRA'da yeni KRA
   *  saklanır, zarf kaydı yeniden yazılır; verilen zarflar yeni KRA ile yeniden şifrelenir (eski KRA kurtarmadan
   *  bellekte olmalı). Hata VERSION_UNKNOWN, NO_OLD_KEY, VAULT_LOCKED, UNAUTHORIZED */
  rotateVault (o?: { tur?: 'ya' | 'kra'; collectionId?: Hex | null; zarflar?: Hex[]; kagit?: number; kisiler?: Hex[] | null; yalnizKagit?: boolean }): Promise<KasaKurulumu & { sirHex?: Hex; collectionId?: Hex; zarflar?: Hex[] }>
  /** 404 */
  recoveryStatus (): { kurtarma: { tur: 'ya' | 'kra'; secretId: Hex; collectionId: Hex | null; version: number | null; esik: number | null; paySayisi: number; hazir: boolean; tamam: boolean; eski: boolean; kutuZarfi: KutuZarfiSonucu | 'istendi' | null; bilinen: number; cevaplayan: Hex[]; istenen: Hex[] } | null; istekler: Array<{ jeton: Hex; kimden: Hex; ad: string; tur: 'ya' | 'kra'; secretId: Hex; version: number; at: number; kilitli: boolean }>; kilitli: boolean }
  /** 405: tutucu tarafı; kullanıcı biyometriyle onayladı (onay: true) ya da reddetti. Onay yalnız kasa açıkken
   *  (RFC-0027 §9 a; kilitliyse VAULT_LOCKED, istek yerinde kalır) */
  approveShare (o: { jeton: Hex; onay: boolean }): { durum: 'verildi' | 'reddedildi' | 'red'; red?: string }
  /** Gönderilecek kurtarma zarfları (0x9E, 0x9B, 0x9C); platform gönderince gonderildi(x) */
  recoveryOutgoing (): Array<{ to: Hex; type: 0x9e | 0x9b | 0x9c | 0xf5; bytes: Uint8Array }>
  sent (x: { to: Hex; type: number; bytes: Uint8Array }): void
  /** Giriş noktaları: gelen KASA_VERSION_REQ (cevap ya da null), KASA_VERSION_RES, KASA_SHARE_REQ, KASA_SHARE_RES */
  receiveVersionRequest (fromHex: Hex, bytes: Uint8Array, yol: Yol): { to: Hex; type: 0x9f; bytes: Uint8Array } | null
  receiveVersionReply (fromHex: Hex, bytes: Uint8Array, yol: Yol): 'kaydedildi' | 'yetkisiz' | 'bilinmiyor'
  receiveShareRequest (fromHex: Hex, bytes: Uint8Array, yol: Yol): { durum: 'onay'; jeton: Hex } | { durum: 'bekle'; bitis: number } | { durum: 'red'; red: string }
  receiveShareReply (fromHex: Hex, bytes: Uint8Array, yol: Yol): 'eklendi' | 'zaten' | 'tutucu_tekrar' | 'yanlis_tutucu' | 'istenmedi' | 'bilinmiyor'
  /** RFC-0027 §9 b: KRA'yı bilen telefonda kasa açıkken dönem listesi değiştiyse zarf kaydını yeniden yazar (eşitleyici
   *  her değişiklikte çağırır). Dönüş: yazılan zarfların özeti */
  renewEnvelope (): Array<KasaZarfOzeti & { collectionId: Hex }>
  /** §9 g: zarfın kutuya gidecek opak kopyaları (KASA_ENV_PUT 0xF3, alındı gelene kadar) */
  outgoingEnvelopes (): Array<{ to: Hex; type: 0xf3; bytes: Uint8Array }>
  /** Giriş noktaları (§9 g): kutudan KASA_ENV_ACK (0xF4) ve KASA_ENV_RES (0xF6) */
  receiveEnvelopeAck (fromHex: Hex, bytes: Uint8Array, yol: Yol): 'teslim' | 'bilinmiyor'
  receiveEnvelopeReply (fromHex: Hex, bytes: Uint8Array, yol: Yol): 'acildi' | 'acilmadi' | 'bilinmiyor'
  status (): { kilitli: boolean; ya: KasaOzeti | null; kasalar: Array<{ collectionId: Hex; ad: string; kurulu: KasaOzeti | null; onizleme: KasaDagitimi | null; zarf: KasaZarfOzeti | null }> }
  /** 'vault': { type: 'acildi' | 'kilitlendi' | 'kuruldu' | 'kagit_gerekli' | 'kurtarma_basladi' | 'kurtarma_surum' | 'kurtarma_pay' | 'kurtarildi' | 'donduruldu' | 'dondurme_geri_cekildi' | 'pay_istegi' | 'pay_istegi_bekliyor' | 'pay_verildi' | 'zarf_yazildi' | 'zarf_kutuda' | 'zarf_hatasi' | 'anahtar_eklendi' | 'kutu_zarfi' }.
   *  'security-alert': { type: 'rotate_pending_share', seq, eski, yeni, bitis, alicilar } (RFC-0021 a; platform alıcılara gönderir) */
  on (ad: 'lock' | 'vault' | 'security-alert', fn: (x: any) => void): this
}

// --- Tören (kurucu §6.4, RFC-0003 §2; D24) -------------------------------------------------------------------------

export const CEREMONY_COMMAND: { INVITE_START: 3; INVITE_CONFIRM: 4; JOIN: 5; INVITE_CANCEL: 205 }
export type TorenTuru = 'uye' | 'kutu' | 'cihaz' | 'misafir' | 'ek_kimlik'
export type TorenOlayi = { adim: 'qr'; qr: string; kalanSn: number } | { adim: 'sas'; resimler: Array<{ id: string; ad: string } | string>; karsiAd?: string; karsiCihaz?: string; /** RFC-0036: yeni gelenin ekranında ailenin adı; yoksa null */ aileAdi?: string | null } | { adim: 'tamam'; [k: string]: unknown } | { adim: 'kapandi'; neden: string }
/** Platformun tören oturumu (worklet): 'qr', 'sas', 'tamam', 'kapandi' olaylarını yayar */
export interface TorenOturumu { on (ad: string, fn: (x: any) => void): unknown; confirm (ayni: boolean): void; cancel (): void; ttlSec?: number }
export function qrKind (kod: string): TorenTuru
export class CeremonyApi extends Emitter {
  constructor (o: { ledger: unknown; me: unknown; tasiyici: { davet (g: { tur: 'uye' | 'misafir'; kind: number; rol: string | null; bitis?: number; uzaktan?: boolean }): Promise<TorenOturumu>; katil (kod: string): Promise<TorenOturumu> } })
  /** 3: üye ya da misafir daveti (QR bu telefonda); yalnız ana kimlik (SECONDARY_IDENTITY_CANNOT_JOIN); hata INVALID_TYPE, INVALID_ROLE, UNAUTHORIZED, CEREMONY_IN_PROGRESS */
  /** Misafirde bitis: misafirliğin sonu (ms; varsayılan 24 saat, en çok 90 gün; D99). Uzatma protokolde yok (İstek 177) */
  startInvite (tur: 'uye' | 'misafir', rol?: 'ebeveyn' | 'yetiskin' | 'cocuk' | null, o?: { bitis?: number; /** D101/D106: uzaktan katılım (10 dk kod, ADD_MEMBER remote, 24 saat bekleme; çok onayda 10 dk açık) */ uzaktan?: boolean }): Promise<{ ttlSec: number }>
  /** 5: QR'ı tarayan taraf; kutu, cihaz ve ek kimlik QR'ında aile tarafı. Hata INVALID_QR, QR_VERSION, QR_TYPE, ALREADY_IN_FAMILY */
  join (kod: string): Promise<{ tur: TorenTuru }>
  /** 4: 5 resim aynı mı; farklıysa tören kapanır. Hata NO_CEREMONY */
  confirm (ayni: boolean): void
  /** 205 */
  cancel (): void
  readonly inProgress: boolean
  on (ad: 'ceremony', fn: (x: TorenOlayi) => void): this
}

// --- Yerel kanal ve kişisel mod (RFC-0017 §6.4, §10; D24) ---------------------------------------------------------

export type TaslakHedefi = { tur: 'sohbet'; convId: Hex } | { tur: 'kisi'; personId: Hex } | { tur: 'yanit'; recordId: Hex; personId: Hex }
export const TEXT_MAX: number
export class LocalApi {
  constructor (o?: { kanal?: { var (): boolean; birak (zarf: unknown): void } | null; now?: () => number })
  /** 352: Yuva Hat'ın yazma kutusuna taslak; Yuva Hat yoksa { yol: 'yok' }. Hata INVALID_TARGET, INVALID_TEXT */
  dropDraft (hedef: TaslakHedefi, metin: string): { yol: 'yerel' | 'yok' }
  /** Kişinin başlattığı mesaj (Kalkan haberi); Yuva Hat gönderir */
  dropMessage (alicilar: Hex[], metin: string): { yol: 'yerel' | 'yok' }
}
export class MemoryPersonalModeStorage { get (k: string): unknown; set (k: string, v: unknown): void }
export class PersonalMode {
  constructor (o?: { saklama?: { get (k: string): unknown; set (k: string, v: unknown): void }; now?: () => number })
  readonly active: boolean
  /** 353 */
  start (): void
  put (recordId: string | null, type: string | null, fields: Alanlar): string
  get (recordId: string): { recordId: string; type: string; fields: Alanlar; at: number } | null
  query (o?: { type?: string | null }): Array<{ recordId: string; type: string; fields: Alanlar; at: number }>
  del (recordId: string): void
  /** Düzey 2.2 ve kişinin Kişisel koleksiyonu varsa onun kimliği */
  movable (ledger: unknown, me: unknown): Hex | null
  /** 354: bir kez; hata NO_LEVEL, ALREADY_MOVED */
  move (kayit: RecordApi, ledger: unknown, me: unknown): Array<{ tur: string; sayi: number }>
}

// --- Bakım Masası (Yuva Defteri 06 §3; RFC-0006 §11; D24) ---------------------------------------------------------

export const DOSE_TYPE: 'yuva.defter.doz-kacirildi'
/** Bakım Masası kurallarının kaynağı (RFC-0029 §6: yuva.bakim Yuva Bakım uygulamasınındır) */
export const RULE_SOURCE: 'yuva.defter'
export const CARE_TYPES: OlayTuru[]
export function scheduledOf (gun: string, saat: string): number
export interface DozKarti { collectionId: Hex; ilacRecordId: Hex; kisi: Hex | null; baslik: string; dozMetni: string; saat: string; planlanan: number; durum: 'alindi' | 'atlandi' | null; dozRecordId: Hex | null }
export interface KacirilanDoz { vakaId: Hex; collectionId: Hex; recordId: Hex; kisi: Hex | null; baslik: string; planlanan: number | null; onem: 'dikkat'; basamaklar: Array<{ basamak: 2 | 3 | 4; zaman: number | null; kime: Hex[]; kitle: 'okuyucular' | 'sorumlu' | 'siradaki'; durum: 'oldu' | 'sonra' | 'durdu' }>; sahip: Hex | null; benYazabilirim: boolean }
export class CareDeskApi extends Emitter {
  constructor (o: { kayit: RecordApi; olay: EventApi; defter?: LedgerApi | null; now?: () => number })
  status (): { kisiler: Array<{ personId: Hex; ad: string; collectionId: Hex; koleksiyonAdi: string; gorenler: Hex[]; kasaGibi: boolean }>; benimSaglikKoleksiyonum: Hex | null; kacirilanSayisi: number }
  doses (gun: string, kisi?: Hex | null): DozKarti[]
  markDose (collectionId: Hex, ilacRecordId: Hex, planlanan: number, durum: 'alindi' | 'atlandi'): Hex
  /** 355: kaçırılan doz olayları, ilaç kuralları, vakalar ve zamanı gelen basamaklar (zamanlayıcıyla çağrılır) */
  process (): number
  /** 356 */
  missed (): KacirilanDoz[]
  /** 357: hata NO_CASE, NOT_WRITER */
  imHandling (vakaId: Hex): Hex
  setupHealthCollection (okuyucular: Hex[], kasaGibi: boolean, ozetiTasi: boolean): Hex
  on (ad: 'care', fn: (x: { type: 'degisti' } | { type: 'kacirilan'; vakaId: Hex } | { type: 'doz'; collectionId: Hex; recordId: Hex; planlanan: number }) => void): this
}
/** Eski ad (D77): bir sürüm takma ad */
export const BakimApi: typeof CareDeskApi

// --- Aile Kalkanı (Yuva Defteri 04; D24) --------------------------------------------------------------------------

export class ShieldApi extends Emitter {
  constructor (o: { kayit: RecordApi; defter: LedgerApi; yerel?: LocalApi | null; now?: () => number })
  /** 358: Kalkan:<ben>; 1–2 koruyucu (ebeveyn ya da yetişkin). Hata GUARDIAN_COUNT, INVALID_GUARDIAN, SHIELD_ENABLED */
  enable (koruyucular: Hex[], haberVer?: 'her_seferinde_sor' | 'her_zaman'): Hex
  close (): void
  setGuardians (koruyucular: Hex[], haberVer: 'her_seferinde_sor' | 'her_zaman'): Hex
  answerInvite (korunan: Hex, kabul: boolean): Hex
  /** 359: kalkan_bildirimi kaydı; Yuva Hat varsa koruyuculara mesaj */
  report (sonuc: { tur: 'mesaj' | 'arama' | 'diger'; anlatim: string; isaretler?: string[]; ekranGoruntusu?: BlobRef }, goruntuyuEkle?: boolean): { recordId: Hex; yol: 'mesaj' | 'kayit' }
  writeResult (collectionId: Hex, recordId: Hex, sonuc: 'sorun_yok' | 'dolandiricilik' | 'emin_degil'): void
  notifications (): Array<{ collectionId: Hex; recordId: Hex; korunan: Hex; benim: boolean } & Alanlar>
  status (): { acik: boolean; collectionId: Hex | null; koruyucular: Hex[]; haberVer: string; kabuller: Record<Hex, boolean>; korudugum: Hex[] }
  setVisibility (acik: boolean, tumAile: Hex): Hex
  /** Değişiklikte çağrılır (RecordApi 'change' ile kendiliğinden) */
  scan (): void
  on (ad: 'shield', fn: (x: { type: 'davet'; korunan: Hex } | { type: 'bildirim'; collectionId: Hex; recordId: Hex }) => void): this
}

// --- Kap kanalı (RFC-0014 §10 eki, RFC-0027 §2; D25) --------------------------------------------------------------

export const EXPORT_COMMAND: { EXPORT: 390; IMPORT: 391 }
export const MIN_PASSWORD_LENGTH: number
export class ExportApi {
  constructor (o: { kayit: RecordApi; urun?: string; bicim?: string; bicimSurum?: number; gizliAlanlar?: (type: string) => string[]; kdf?: { opslimit?: number; memlimit?: number }; now?: () => number })
  /** 390: tek seferlik; kasa kilitliyse VAULT_LOCKED. Hata PASSWORD_TOO_SHORT, COLLECTION_REQUIRED, NO_COLLECTION */
  /** yaz verilirse kap parça parça ona gider (telefon: dosyaya; bellekte bütün kap tutulmaz) ve dönüşte bytes yerine boy (D41).
   *  yaz Promise dönerse beklenir. Ret gelirse o ana kadar yazılanlar geçersizdir: çağıran dosyayı atar (inceleme 15 B5) */
  export (o: { koleksiyonlar: Hex[]; gizliDahil?: boolean; parola: string }): Promise<{ dosyaAdi: string; bytes: Uint8Array; ogeSayisi: number; eksikDosya: number }>
  export (o: { koleksiyonlar: Hex[]; gizliDahil?: boolean; parola: string; yaz: (parca: Uint8Array) => void | Promise<void> }): Promise<{ dosyaAdi: string; boy: number; ogeSayisi: number; eksikDosya: number }>
  /** 391: telefon sınırlarıyla açar (RFC-0021 h); geri yükleme ürünün işidir. Hata FORMAT_MISMATCH */
  import (o: { bytes: Uint8Array; parola: string }): Promise<{ baslik: unknown; icerik: { bicim: string; bicimSurum: number; olusturma: number; koleksiyonlar: Array<{ ad: string; tur: string; kasa: boolean; kayitlar: Array<{ tur: string; olusturma: number; degisme: number; alanlar: Record<string, unknown>; yapay_zeka_alanlari: string[] }> }> }; dosyalar: Array<{ ad: string; bytes: Uint8Array }> }>
}

// --- Ekip (RFC-0005, RFC-0022; D45) ------------------------------------------------------------------------------------

export const TEAM_COMMAND: { TEAM_CREATE: 280; TEAM_ROLE: 281; TEAM_ASSIGN: 282; TEAM_TERM: 283; TEAM_NOTICE: 284; TEAM_REMOVE: 285; TEAM_EXIT_STATUS: 286; TEAM_PLACES: 287 }
export const MAX_TERM_MS: number
export type EkipRolu = 'sahip' | 'yonetici' | 'calisan' | 'gecici'
export type YerTuru = 'sube' | 'depo' | 'ciftlik' | 'ofis' | 'diger'
export interface Yer { placeId: Hex; ad: string; tur: YerTuru; kisiler: Array<{ memberId: Hex; name: string; role: EkipRolu }>; kutu: Hex | null; cihazlar: number; aydinlatma: boolean }
export interface Makbuz { memberId: Hex; eventHash: Hex; scope: 1 | 2; collections: number; convs: number; blobs: number; finishedAt: number; alindi: number }
export interface CikisDurumu { memberId: Hex; name: string; role: string; tur: 'cikarildi' | 'ayrildi'; cikis: number; wipe: boolean; makbuz: ({ durum: 'geldi' } & Makbuz) | { durum: 'bekleniyor' | 'gelmedi' } }
export interface Zarf { type: number; bytes: Uint8Array }
export type SilmeKancasi = (o: { kapsam: 'is' | 'tam' }) => { collections?: number; convs?: number; blobs?: number }
export class TeamApi extends Emitter {
  /** kopru verilirse ayrılışta ve iş kapsamı silinince kapatılır (RFC-0027 §7 d) */
  constructor (o: { defter: LedgerApi; kayit?: RecordApi | null; now?: () => number; saklama?: { get (k: string): unknown; set (k: string, v: unknown): void } | null; kopru?: BridgeApi | null })
  /** 280: GENESIS, KIND ekip, PROTOCOL_LEVEL 2.1 (ve duzey), POLICY (maxMembers ≤ 32), ilk yer, kurucunun ataması, varsayılan koleksiyonlar (§8.4) */
  static create (o: { Ledger: any; me: any; isletmeAdi: string; displayName: string; yer?: { ad: string; tur?: YerTuru }; maxMembers?: number; ts?: number; duzey?: string; placeId?: Hex | null }): { ledger: any; event: unknown; olaylar: unknown[]; placeId: Hex; /** Olaylar ve Paylaşımlar bırakma anahtarlarının gizlisi: kurucunun replikasına addDropSecret ile */ birakma: Array<{ collectionId: Hex; secret: Uint8Array }> }
  /** 281: SET_ROLE; geçiciye geçişte sureSonu zorunlu (TERM_REQUIRED), TERM birlikte yazılır */
  role (memberId: Hex, role: EkipRolu, o?: { sureSonu?: number | null }): YazimSonucu & { sure?: YazimSonucu }
  /** 282: ASSIGN; liste öncekinin yerine geçer. Hata OUT_OF_SCOPE, PLACE_BOX_LIMIT, PLACE_DEVICE_LIMIT, NO_TARGET */
  assign (subjectId: Hex, placeIds: Hex[]): YazimSonucu
  /** 283: TERM; en çok 90 gün sonrası (TERM_LIMIT). Hata NOT_TARGET_TEMPORARY */
  setTerm (memberId: Hex, expiresAt: number): YazimSonucu
  /** 284: NOTICE; herhangi bir sahip. Hata NOTICE_MISSING */
  privacyNotice (o: { placeId: Hex; textBlobId?: Hex | Uint8Array; signBlobId?: Hex | Uint8Array; textVersion?: string; cameraCount?: number; outbound?: string[]; remove?: boolean }): YazimSonucu
  /** 285: REMOVE_MEMBER; uygulanınca cikis (0xC8) çıkarılan cihaza gönderilir */
  remove (memberId: Hex, o?: { wipe?: boolean; reason?: string }): YazimSonucu & { cikis?: Zarf }
  exitMessage (memberId: Hex): Zarf
  /** Gelen EKIP_CIKIS_OK (0xC9; giriş noktası). Hata INVALID_RECEIPT, DUPLICATE_RECEIPT, UNAUTHORIZED */
  receiveReceipt (fromHex: Hex, bytes: Uint8Array, yol: 'dogrudan' | 'emanet' | 'posta'): Makbuz
  /** 286: çıkarılan ve ayrılanlar; makbuz geldi, bekleniyor ya da gelmedi (30 gün) */
  exitStatus (): CikisDurumu[]
  /** Ayrılan cihaz: gelen EKIP_CIKIS (0xC8; giriş noktası). Geçerliyse iş kapsamı silinir, makbuz (0xC9) döner; sahip silmez */
  receiveExit (fromHex: Hex, bytes: Uint8Array, yol: 'dogrudan' | 'emanet' | 'posta', o?: { sil?: SilmeKancasi | null; sonBaglanti?: number | null }): { durum: 'bekliyor' | 'sahip' } | { durum: 'silindi'; kapsam: 'is' | 'tam'; istenen: 'is' | 'tam'; collections: number; convs: number; blobs: number; makbuz: Zarf }
  /** Kendi isteğiyle ayrılış: iş kapsamı silinir, makbuz (eventHash sıfır), sonra LEAVE */
  leave (o?: { sil?: SilmeKancasi | null; isVerisiniSil?: boolean }): YazimSonucu & { collections: number; convs: number; blobs: number; makbuz: Zarf | null }
  /** 287: yerler; ekle yeni yer ve Yer:<ad>, Olaylar:<ad> koleksiyonları; kaldir PLACE remove. Hata NO_PLACE */
  places (o?: { ekle?: { ad: string; tur?: YerTuru; placeId?: Hex } | null; kaldir?: Hex | null }): { yerler: Yer[]; sonuc: (YazimSonucu & { placeId?: Hex; koleksiyonlar?: YazimSonucu[]; birakma?: Array<{ collectionId: Hex; secret: Uint8Array }> }) | null }
}

// --- Bakıcının sınırlı yazması (RFC-0030; D78) ------------------------------------------------------------------------

export interface BakiciYazmaIzni { collectionId: Hex; types: string[]; subjects: string[] }
export interface Biraktigim { opId: Hex; recordId: Hex; collectionId: Hex; type: string; t: number; subj: string; alanlar: Alanlar; zaman: number }
/** Misafirin telefonunda: GUEST_VIEW drops izniyle mühürlü olay bırakma ve "Senin yazdıkların" (yalnız bu telefonda) */
export class GuestWriteApi extends Emitter {
  constructor (o: { kimlik: unknown; gorunum: unknown; katalog?: unknown; saklama?: { get (k: string): unknown; set (k: string, v: unknown): void } | null; now?: () => number; hlc?: unknown })
  updateView (gorunum: unknown): void
  permissions (): BakiciYazmaIzni[]
  /** Hata NOT_PERMITTED, TYPE_NOT_ALLOWED, SUBJECT_NOT_ALLOWED, EXTRA_FORBIDDEN, DROP_TOO_LARGE. mesaj (REC_OPS) ailenin telefonlarına gönderilir */
  drop (collectionId: Hex, tur: string, alanlar: { subj: string; t?: number; conf?: number } & Alanlar): { opId: Hex; recordId: Hex; mesaj: { type: number; bytes: Uint8Array } }
  myDrops (o?: { collectionId?: Hex | null; limit?: number }): Biraktigim[]
  /** Komut 413 (RFC-0030 §8.1) */
  myWrites (o?: { collectionId?: Hex | null }): Array<{ recordId: Hex; type: string; subj: string; at: number }>
  /** Bakıcının SOS'u (RFC-0031 §4.1): Tüm Aile'ye, özne grant:<kendisi>; zorlama-pin ve sessiz yok. Hata NOT_PERMITTED, INVALID_FIELD_VALUE, SOS_* */
  sos (o?: { yol?: 'dugme' | 'afet'; konum?: SosKonum; metin?: string; pil?: number; afetMid?: Hex | Uint8Array; t?: number }): { opId: Hex; recordId: Hex; mesaj: { type: number; bytes: Uint8Array } }
  on (ad: 'dropped', fn: (k: Biraktigim) => void): this
}

// --- Kişisel köprü (RFC-0005 §15; D46) ---------------------------------------------------------------------------------

export const BRIDGE_COMMAND: { BRIDGE_PREPARE: 288; BRIDGE_RECEIVE: 289 }
export type KopruTuru = 'mekan.durum.giris' | 'mekan.durum.cikis' | 'mekan.durum.gec' | 'mekan.durum.serbest' | 'yuva.durum.gec' | 'yuva.durum.serbest'
export class BridgeApi {
  constructor (o: { kendi: 'ekip' | 'aile'; saklama?: { get (k: string): unknown; set (k: string, v: unknown): void; delete? (k: string): void } | null; kanal?: { birak (metin: string): void; temizle? (): void } | null; now?: () => number })
  /** Bu yönde geçebilecek türler (ekip: mekan.durum.*, aile: yuva.durum.*) */
  kinds (): KopruTuru[]
  /** Kişinin seçtiği düğmeler (yalnız bu telefonda; varsayılan hiçbiri). Hata BRIDGE_TYPE */
  buttons (turler?: KopruTuru[] | null): KopruTuru[]
  /** 288: "hfkopru1:…" taşıma metni (≤ 1 KB). Hata BRIDGE_DISABLED (düğme açık değil), BRIDGE_TYPE, BRIDGE_TEXT (≤ 280 bayt) */
  prepare (o: { type: KopruTuru; text: string }): { metin: string; yol: 'kanal' | 'metin' }
  /** 289: önizleme; kişi onaylarsa uygulama kendi mesajı olarak gönderir. kaynak ve uygulama platformdan (okunan yön
   *  klasörü, RFC-0027 §7 a); sil başarıyla alınan paketi kanaldan siler. at geçmişe 7 gün, ileriye 5 dakika.
   *  Hata INVALID_BRIDGE, BRIDGE_TYPE, BRIDGE_TEXT, BRIDGE_DIRECTION, BRIDGE_SOURCE, BRIDGE_REPLAY, BRIDGE_VERSION, BRIDGE_STALE, BRIDGE_AHEAD */
  receive (metin: string, o?: { kaynak?: 'ekip' | 'aile' | null; uygulama?: string | null; sil?: (() => void) | null }): { from: 'ekip' | 'aile'; type: KopruTuru; text: string; at: number; etiket: 'is' | 'aile'; uygulama?: string }
  /** Ayrılış ya da çıkarılma (RFC-0027 §7 d): düğmeler kapanır, gönderilmemiş paketler silinir */
  close (): void
}

// --- Afet modu (RFC-0012; D83) -------------------------------------------------------------------------------------------

/** Çekirdek komutları (worklet aralığı 310–319; RFC-0012 §13) */
export const DISASTER_COMMAND: { DISASTER_STATE: 310; DISASTER_SET: 311; DISASTER_SEND: 312; DISASTER_INBOX: 313; DISASTER_NEARBY: 314; DISASTER_SETTINGS: 315; DISASTER_SIGNAL: 316; DISASTER_LINK: 317; DISASTER_TAGS_GET: 318; DISASTER_CLEAR: 319 }
export const DISASTER_KIND: { metin: 1; iyiyim: 2; sos: 3; uyari: 4; alindi: 5 }
export type AfetDurumu = 'kapali' | 'hazir' | 'etkin'
export type AfetTuru = 'metin' | 'iyiyim' | 'sos' | 'uyari'
export type AfetBagi = 'bluetooth' | 'wifi-direct' | 'multipeer' | 'yerel'
export interface AfetKonum { latE5: number; lonE5: number; accM: number; at: number }
export interface AfetHali {
  durum: AfetDurumu
  /** Duruma geçiş anı */
  baslangic: number | null
  /** ETKİN'e elle mi geçildi (72 saat sorusu yalnız elle açılınca) */
  elle: boolean
  /** 72 saat doldu, elle açılmıştı: ürün "sürsün mü?" diye sorar, cevap sursun() ile */
  soru: boolean
  /** İnternetin gittiği an; varsa null */
  internetYok: number | null
  pil: number | null
  /** Teslim edilmemiş kendi mesajları */
  bekleyen: number
  /** Okunmamış gelen mesajlar */
  yeni: number
  /** Taşınan (başkalarının) mesaj sayısı */
  tasinan: number
}
export interface AfetMesaji {
  mid: Hex
  tur: AfetTuru
  yon: 'gelen' | 'giden'
  /** Gönderen (gelen) ya da alıcı (giden) kimliği */
  kimlik: Hex
  at: number
  /** Gelen: dogrudan (gönderenden) · tasindi (başka bir cihaz taşıdı; taşıyan verilmez). Giden: yolda · alindi */
  durum: 'dogrudan' | 'tasindi' | 'yolda' | 'alindi'
  metin?: string
  konum?: AfetKonum | null
  alarm?: { kind: 'deprem' | 'elektrik'; level: number; nearby: Hex[] } | null
  pil?: number | null
  okundu?: boolean
  /** Giden: internet dönünce normal yoldan da verildi (§8.4) */
  normalYoldan?: 'gitti'
}
export type AfetOlayi = { type: 'durum'; hal: AfetHali } | { type: 'mesaj'; mesaj: AfetMesaji } | { type: 'sursun-mu' } | { type: 'internet-dondu' }
export interface AfetBagOturumu { bag: AfetBagi; karsi: Hex; rol: string; caps: number; kapandi: string | null; gonder (cerceve: Uint8Array): boolean; dinle (fn: (cerceve: Uint8Array) => void): void; kapat (neden?: string): void }
/** RFC-0012 §6.5 AFET_LINK_UP: 0 Wi-Fi Direct, 1 Multipeer */
export interface AfetYukseltmeTeklifi { kind: 0 | 1; name: string; pass: string; port: number }
/** D104: grup sahibi (bağı başlatmayan) yukseltmeIste, başlatan yukseltmeGeldi */
export interface AfetBagCekirdegi { yukseltmeIste? (bag: { kimlik: Hex; bag: string }): AfetYukseltmeTeklifi | null | Promise<AfetYukseltmeTeklifi | null>; yukseltmeGeldi? (bag: { kimlik: Hex; bag: string }, teklif: AfetYukseltmeTeklifi): void }

export class DisasterApi extends Emitter {
  /** izin: platform izinleri (Bluetooth, yakındaki cihazlar) verilmiş mi; saklama Hat katmanının kalıcı deposu */
  /** bagCekirdegi (D104, RFC-0012 §6.5): Wi-Fi Direct / Multipeer yükseltme kancaları */
  constructor (o: { me: unknown; defter: () => unknown; saklama?: { get (k: string): unknown; set (k: string, v: unknown): void; kaydetmedenOnce? (fn: () => void): void } | null; saat?: () => number; izin?: () => boolean; bagCekirdegi?: AfetBagCekirdegi | null })
  /** D104 normal yol (RFC-0031 §8.4): worklet'in ürün zarfı kancalarına bağlanır */
  setupNormalPath (o: { urunZarfi (type: number, fn: (peer: Hex, bytes: Uint8Array, yol: string, rol: string) => void): void; zarfGonder (peer: Hex, type: number, bytes: Uint8Array, id?: string): boolean }): { gonder (): number }
  /** D104: uygulamanın yükseltme teklifi açık Bluetooth bağına */
  upgradeOffer (bag: { kimlik: Hex } | Hex, teklif: AfetYukseltmeTeklifi): boolean
  /** 310 */
  state (): AfetHali
  /** 311: elle aç; izin yoksa açılmaz */
  enable (): { acildi: boolean; neden?: 'izin' }
  /** 311: elle kapat ya da HAZIR'a in. Hata DISASTER_TARGET */
  close (hedef?: 'kapali' | 'hazir'): AfetHali
  keepOn (evet: boolean): AfetHali
  /** 315: hazirDk 10–120 (varsayılan 30). Hata INVALID_DISASTER_SETTINGS */
  settings (): { hazirDk: number }
  configure (a?: { hazirDk?: number }): { hazirDk: number }
  /** 316: yerel modülden internet, pil ve düğüm sinyalleri */
  signal (s?: { internet?: boolean; pil?: number | null; dugum?: { pilde?: boolean; sensor?: boolean; prizde?: boolean } | null }): AfetHali
  /** Durum makinesini ilerletir (zamanlayıcıyla) */
  tick (): AfetHali
  /** 312: her alıcıya ayrı mühür, hız sınırı tek gönderim. Metin ≤ 256 B (İYİYİM, SOS, UYARI ≤ 64 B). İYİYİM ve METİN
   *  konumu ~1 km'ye yuvarlanır, tamKonum yuvarlamaz; SOS yuvarlanmaz. uyari yalnız bağlı cihazdan, alarm ile.
   *  Hata INVALID_DISASTER_KIND, NO_DISASTER_RECEIVER, DISASTER_CANNOT_SEND, NO_DISASTER_PAIR, DISASTER_SEND_LIMIT (err.bekleMs), INVALID_DISASTER_*, DISASTER_FIELD_ALARM, DISASTER_LENGTH */
  send (tur: AfetTuru, alicilar: Hex[], metin?: string, konum?: AfetKonum | null, o?: { tamKonum?: boolean; alarm?: { kind: 'deprem' | 'elektrik'; level: number; nearby: Uint8Array[] } }): Hex[]
  /** §8.4: teslim edilmemiş kendi mesajları; olağan oturumla ya da emanetle (RFC-0003 §6.4 mührüyle) gönderilir */
  handToNormalPath (): Array<{ to: Hex; mid: Hex; tur: 0xb0; govde: Uint8Array }>
  /** §8.4: normal yoldan gelen AFET_MSG gövdesi; yalnız bana gelen açılır */
  takeFromNormalPath (govde: Uint8Array): { gecerli: boolean; mid?: Hex; neden?: string }
  /** 313: en yeni önce */
  messages (): AfetMesaji[]
  /** RFC-0037 §7: giden mid'in alıcısı ve ALINDI'sı */
  receiptOf (mid: Hex): { kimlik: Hex; alindi: boolean; at: number | null } | null
  markRead (mid: Hex): void
  relayed (): { adet: number; bayt: number }
  /** 319 */
  clear (): { adet: number; bayt: number }
  /** 318: reklam için AFET_TAGS; port verilirse yerel ağ duyurusu */
  tags (o?: { port?: number | null }): { liste: { v: 1; slot: number; tags: Uint8Array[] }; bayt: Uint8Array; duyuru: Uint8Array | null }
  /** Taranan etiket listesi ya da duyuru; eşleşen aile kimliği */
  match (o: { bayt?: Uint8Array | null; duyuru?: Uint8Array | null }): { kimlik: Hex; dilim: number; port: number | null } | null
  syncNeeded (kimlik: Hex): boolean
  /** 317: bağ oturumu (etiket, Noise IK, HELLO; açıklama 1 madde 2). Bağlanan eslestir() sonucunu verir, karşılayan
   *  bağlananı etiketten bulur. Afet bağında eşitleyip kapatır; yerel ağda olağan oturumu döndürür.
   *  Hata NO_DISASTER_PAIR, DISASTER_LABEL, DISASTER_NOISE, DISASTER_HELLO_*, DISASTER_CAPS */
  connect (o: { ham: unknown; baslatan: boolean; eslesme?: { kimlik: Hex; dilim: number } | null; bag: AfetBagi }): Promise<{ bitti: boolean; kapandi: string | null; alinan: unknown[] } | AfetBagOturumu>
  /** D88 (işçi): deprem ya da elektrik UYARI'sı her aile telefonuna (misafir ve kutu değil); govdeler kutuya olağan yerel
   *  oturumla bırakılır. Hata DISASTER_ALERT_TYPE, DISASTER_FIELD_ALARM, DISASTER_CANNOT_SEND, NO_DISASTER_RECEIVER, DISASTER_SEND_LIMIT */
  sendAlert (o: { tur: 'deprem' | 'elektrik'; seviye?: number; yakindakiler?: Hex[]; metin?: string | null }): { mids: Hex[]; govdeler: Array<{ to: Hex; rol: string | null; mid: Hex; govde: Uint8Array }> }
  /** D88 (kutu): işçinin bıraktığı UYARI taşınır, kutu ETKİN'e geçer. neden: NOT_CARRIER, INVALID_SOURCE, INVALID_PRIORITY, LIMIT_REACHED, REPLAY, DISASTER_CORRUPT */
  fromWorker (govde: Uint8Array, kaynak: Hex | Uint8Array): { tasindi: boolean; neden?: string }
  /** D88 (telefon): gelen deprem ve elektrik uyarıları (Acil A46, A47) */
  alerts (): Array<{ mid: Hex; tur: 'deprem' | 'elektrik'; seviye: number; evdekiler: Hex[]; zaman: number; pil: number | null; kimlik: Hex; okundu?: boolean }>
  /** 314: son 15 dakikada bağ kurulan aile cihazları */
  nearby (): Array<{ kimlik: Hex; tur: 'telefon' | 'kutu' | 'cihaz' | 'misafir'; bag: AfetBagi; sonEsitleme: number }>
  on (ad: 'disaster', fn: (o: AfetOlayi) => void): this
}

// --- Hizmet paylaşımı (RFC-0010 §5, §6, §8, §10, §12, açıklama 1; komutlar 300–306, 309) --------------------------------

export const SERVICE_COMMAND: { SERVICE_DIRECTORY: 300; SERVICE_CARD_ADD: 301; SHARE_PREPARE: 302; SHARE_APPROVE: 303; SHARE_SEND: 304; SHARE_CANCEL: 305; SHARE_LIST: 306; REPLY_FETCH: 309 }
export type HizmetKategorisi = 'veteriner' | 'bakim' | 'saglik' | 'guvenlik' | 'usta' | 'tedarikci' | 'cagri' | 'destek'
/** Hizmet satırı (Pati Hizmet, Bakım Uzman): dogrulama 'dizin' ise "Eser doğruladı" rozeti (güncel dizinden); saklamaGun kartın keepDays beyanı; maxMB en çok 25 */
export interface Hizmet { serviceId: Hex; ad: string; kategori: HizmetKategorisi; il: string; iletisim: string; endpoint: string; dogrulama: 'dizin' | 'yuz-yuze'; kural: boolean; maxMB: number; saklamaGun: number; keyVersion: number; yurtDisi: boolean }
export interface PaketDosyasi { blobId: Uint8Array; fileKey: Uint8Array; size: number; mime: string; name: string }
/** hepsi'ndekilerin hepsi ve biri'ndekilerden en az biri imzalar (aile: ortak veri bir ebeveyn, yetişkin kendisi, çocuk bir ebeveyn; ekip: ortak veri bir sahip, üyenin verisi üye ve bir sahip) */
export interface Imzacilar { hepsi: Hex[]; biri: Hex[] }
export interface HizmetOnizleme {
  shareId: Hex; hizmet: Hizmet; tur: 'tek' | 'gizli'; kategori: HizmetKategorisi; ozelNitelikli: boolean; yurtDisi: boolean
  baslik: string; not: string; /** paketin tam içeriği (açıklama 1 madde 7) */ ogeler: Array<{ type: string; alanlar: Alanlar }>
  dosyalar: Array<{ ad: string; mime: string; boyut: number }>; /** useUntil */ kullanim: number; saklamaGun: number; etiket: string
  /** PAKET_GOVDE baytları */ govde: Uint8Array; payloadHash: Hex; /** onayın gönderim son anı */ expiresAt: number
  /** verinin sahibi (kayıtların _subj'undan; ortak veride 16 sıfır) */ ownerId: Hex; imzacilar: Imzacilar
  kaynaklar: Array<{ collectionId: Hex; recordIds: Hex[] }>
}
export interface PaylasimSatiri {
  shareId: Hex; tur: 'tek' | 'kural' | 'gizli' | null; kategori: HizmetKategorisi | null; hizmet: Hex | null; hizmetAdi: string | null
  durum: 'taslak' | 'onay-bekliyor' | 'oneri' | 'onaylandi' | 'gonderiliyor' | 'gonderildi' | 'acildi' | 'ret' | 'silindi' | 'iptal' | 'gecersiz'; neden: string | null; onaySeq: number | null; ownerId: Hex
  expiresAt: number; /** kaydedilmiş cevap sayısı */ cevap: number; gonderildi: number | null; packageId: Hex | null
}
/** Platformun alıcıya yapacağı istek: PUT {endpoint}/v1/p/{serviceId}/{packageId}, başlık x-hf-owner */
export interface PaketIstegi { endpoint: string; serviceId: Hex; packageId: Hex; bytes: Uint8Array; owner: Hex }
/** DELETE {endpoint}/v1/p/{serviceId}/{packageId}, başlık x-hf-owner-secret; 409 ise hizmet paketi aldı */
export interface SilmeIstegi { endpoint: string | null; serviceId: Hex; packageId: Hex; ownerSecret: Hex }
export class ServiceApi extends Emitter {
  /** saklama zorunlu: takma adlar (Arşiv katmanı, yedeğe girer), il dizinleri ve taslaklar. Hata STORAGE_REQUIRED */
  constructor (o: { kayit: RecordApi; defter: LedgerApi; paylasimlar: Hex; dizinAnahtarlari?: Hex[]; saklama: { get (k: string): unknown; set (k: string, v: unknown): void }; now?: () => number })
  /** 300: bytes verilirse bir il dizini yüklenir ve saklanır (GET /v1/dizin/{region} platformda). Hata INVALID_SIGNATURE, INDEX_CORRUPT, INDEX_STALE (aynı ilin eski sürümü) */
  directory (o?: { bytes?: Uint8Array | Hex | null }): { iller: Array<{ region: string; version: number; validUntil: number; guncel: boolean; atlanan: number }>; hizmetler: Hizmet[] }
  services (): { eklenen: Hizmet[]; dizin: Hizmet[] }
  /** 301: yüz yüze QR ('HFH1:…'); dizin gerekmez. Hata INVALID_QR, CARD_CORRUPT, INVALID_SIGNATURE, CARD_STALE, NOT_SERVICE_ELIGIBLE */
  addCard (o: { qr: string }): Hizmet
  /** 302: öğeler kaynak kayıtlardan (alanlar verilirse yalnız onlar ve _v, _t, _subj; dosya başvurusu girmez), sahip kayıtların _subj'undan. Hiçbir şey yazılmaz.
   *  Hata NO_PERMISSION, CHILD_PERSONAL, SOURCE_REQUIRED, MIXED_SOURCE, RECORD_REQUIRED, NO_RECORD, MIXED_OWNER, NO_COLLECTION, NO_SERVICE, NOT_SERVICE_ELIGIBLE, INDEX_STALE, BODY_CORRUPT, SIZE_OVERRUN, NO_TARGET */
  prepare (t: { serviceId: Hex; kaynaklar: Array<{ collectionId: Hex | Uint8Array; recordIds: Array<Hex | Uint8Array>; alanlar?: string[] }>; title: string; note?: string; files?: PaketDosyasi[]; label?: string; kullanimGun?: number; sureGun?: number }): HizmetOnizleme
  /** 303: SHARE_CONSENT yazılır; ekipte ikinci imza gerekirse öneri. Özel nitelikli kategoride consentTextVersion, yurt dışı hizmette yurtDisiRiza zorunlu.
   *  Hata NO_DRAFT, APPROVAL_EXISTS, SUMMARY_REQUIRED, SUMMARY_MISMATCH, NOT_SIGNER, CONSENT_TEXT_REQUIRED, ABROAD_CONSENT_REQUIRED */
  confirm (o: { shareId: Hex; /** ekranda gösterilen önizlemenin özeti (açıklama 2 madde 2) */ payloadHash: Hex; consentTextVersion?: number | null; yurtDisiRiza?: boolean }): { shareId: Hex; durum: 'uygulandi'; seq: number } | { shareId: Hex; durum: 'oneri'; oneriId: string; waitingFor: Hex[] }
  /** 304: gönderim koşulu her çağrıda; aynı onayla tek paket (yeniden deneme aynı istek); teslim penceresi gönderimden 7 gün. Hata NO_APPROVAL, SUMMARY_MISMATCH, TERM_EXPIRED, SERVICE_MISMATCH, INVALID_KEY */
  send (o: { shareId: Hex }): PaketIstegi
  /** Alıcı PUT'u kabul edince: hf.paylasim.gonderildi yazılır (bir kez). Hata NO_DELIVERY */
  sent (o: { shareId: Hex }): { packageId: Hex }
  /** 305: taslak silinir ya da iptal SHARE_CONSENT'i yazılır (Paylaşımlar'ın her okuyucusu; gizli onayı yalnız sahibi; açıklama 3 madde 1); taslağın gövdesi ve sırları silinir.
   *  sil: Paylaşımlar kayıtlarındaki owner_secret'ten (başka cihazın gönderdiği paket dahil). Hata NO_SHARE, NO_PERMISSION */
  cancel (o: { shareId: Hex }): { durum: 'silindi'; sil: SilmeIstegi[] } | { durum: 'iptal'; seq: number; sil: SilmeIstegi[] } | { durum: 'oneri'; oneriId: string; waitingFor: Hex[]; sil: SilmeIstegi[] }
  /** 306 */
  shares (): PaylasimSatiri[]
  /** Başlatan imzacı değilse SHARE_PREVIEW (0xD0) zarfı; kime imzacılar. Hata NO_DRAFT, NOT_INITIATOR, PREVIEW_UNNEEDED */
  sendPreview (o: { shareId: Hex }): { type: number; bytes: Uint8Array; kime: Hex[] }
  /** İmzacının telefonunda gelen SHARE_PREVIEW (giriş noktası). Öğeler imzacının kendi kayıtlarıyla karşılaştırılır; sonra onayla().
   *  Hata INVALID_MESSAGE, TYPE_NOT_ALLOWED, FAMILY_MISMATCH, SENDER_MISMATCH, UNAUTHORIZED (başlatanın rolü), INVALID_SIGNATURE, PREVIEW_CORRUPT, PREVIEW_EXISTS, SOURCE_MISMATCH, MIXED_OWNER, NOT_SIGNER, IDENTITY_IN_PACKAGE */
  /** peerRole: oturumdaki rol (eşitleyici verir). Kaynak kayıtlar henüz yoksa önizleme bekletilir ve null döner (bekleyenOnizlemeler) */
  receivePreview (fromHex: Hex, bytes: Uint8Array, yol: 'dogrudan' | 'emanet' | 'posta', peerRole?: 'uye' | 'cihaz' | 'misafir'): HizmetOnizleme | null
  /** Bekletilen önizlemeleri yeniden dener (kayıt değişince); kabul edilenler. 7 günde düşer */
  pendingPreviews (): HizmetOnizleme[]
  /** Önizleme imzacıya teslim edildi (platformun zarf kuyruğu): taslak 7 gün durur (açıklama 3 madde 3) */
  deliverPreview (o: { shareId: Hex }): void
  /** Açılmış paket için silme isteği ('silme' paketi, ref = packageId; onay gerekmez). Hata NO_DELIVERY */
  requestDeletion (o: { shareId: Hex }): PaketIstegi
  /** Platformun GET {endpoint}/v1/r/{packageId}?after={after} istekleri (x-hf-owner-secret) */
  replyRequests (o: { shareId: Hex }): Array<{ endpoint: string | null; packageId: Hex; after: number; ownerSecret: Hex }>
  /** 309: cevaplar açılır, imza doğrulanır, yeni olanlar hf.paylasim.cevap olarak kaydedilir. Hata NO_SHARE */
  receiveReply (o: { shareId: Hex; cevaplar: Array<{ packageId: Hex; n?: number; bytes: Uint8Array | Hex }> }): { yeni: Array<{ packageId: Hex; n: number; kind: 'makbuz' | 'ret' | 'mesaj' | 'belge' | 'silindi'; text: string; at: number; dosya: number }>; atlanan: number }
  replies (o: { shareId: Hex }): Array<{ packageId: Hex; n: number; kind: string; text: string; at: number; dosyalar: Array<{ blobId: Hex; fileKey: Hex; size: number; mime: string; name: string }> }>
  on (ad: 'changed', fn: (alan: 'dizin' | 'paylasim') => void): this
  on (ad: 'preview', fn: (shareId: Hex) => void): this
}

// --- Uç cihaz (RFC-0008 §13; komutlar 340–345, 347) ----------------------------------------------------------------

export const EDGE_COMMAND: { EDGE_BECOME: 340; EDGE_CONFIGURE: 341; EDGE_STATUS: 342; EDGE_WATCH: 343; EDGE_WATCH_CLOSE: 344; EDGE_CARD_SEND: 345; APP_WIPE_REPORTS: 347 }
/** Ekran modunun kartı (§11.8); until: bu andan sonra gösterilmez (ms) */
export interface EkranKarti { id: string; title: string; lines: string[]; until: number }
/** Kart gönderilmeden önce gösterilecek uyarı (§11.8; açıklama 2 madde 4) */
export const SCREEN_ALERT: string
export type UcSensoru = 'ivme' | 'isik' | 'yakinlik' | 'basinc'
/** APP_WIPE_REPORT'un telefonda saklanan özeti (§9.3); uyari ekranda ve kayıtta en üstte yazılır */
export interface SilmeRaporu {
  deviceId: Hex; hostId: Hex; kind: 'uygulama-verisi-silindi'; trigger: 'emeklilik' | 'kaldirma'; os: 'windows' | 'macos' | 'android' | 'ios'
  osVersion: string; appVersion: string; keyStore: string; items: Array<{ what: string; method: 'anahtar-imha' | 'dosya-silme'; ok: boolean }>
  residue: string[]; startedAt: number; finishedAt: number; result: 'ok' | 'dogrulanamadi' | 'hata'
  /** appWipeReportHash (DEVICE_DETACH.wipeReportHash) */
  hash: Hex; uyari: string
  /** Bu telefonun bu uç için kaldırmayı başlattığı an (kaldirBaslat); yoksa null */
  istek: number | null
}
/** Yerli silme adımlarının sonuçları ve cihaz bilgisi (EdgeDevice.wipe) */
export interface SilmeGirdisi {
  trigger: 'emeklilik' | 'kaldirma'; hostId: Hex; os?: 'android' | 'ios' | 'windows' | 'macos'; osVersion?: string; appVersion?: string
  keyStore: 'tpm' | 'secure-enclave' | 'strongbox' | 'android-keystore' | 'ios-keychain' | 'dpapi' | 'macos-keychain'
  items?: Array<{ what: string; method: 'anahtar-imha' | 'dosya-silme'; ok: boolean }>
  residue?: Array<'sayfa-dosyasi' | 'hazirda-bekletme' | 'isletim-sistemi-yedegi' | 'disk-sifresiz' | 'fabrika-ayari-yapilmadi'>; startedAt?: number | null
}
export type UcModu = 'kamera' | 'sensor' | 'ekran' | 'kapali'
/** Ağdan gelen zarfın yolu (giris.gelenZarf); akış türleri ve profil yalnız 'dogrudan' */
export type ZarfYolu = 'dogrudan' | 'emanet' | 'posta'
/** UC_CONFIG gövdesi (§11.4). targets: kamerada 'device:<işçi hex>', 'uye:<hex>', 'rol:ebeveyn', 'rol:yetiskin' (çocuk ve misafir olamaz);
 *  sensörde yalnız 'koleksiyon:<olaylar koleksiyonu hex>', okuyucuları evin bütün ebeveyn ve yetişkinleri (açıklama 2 madde 1) */
export interface UcYapilandirma {
  mode: UcModu; targets?: string[]; video?: { maxWidth: number; maxHeight: number; fps: number; kbps: number }
  /** days: bit 0 Pazartesi … bit 6 Pazar; dakikalar ucun yerel saatiyle; boşsa her zaman */
  windows?: Array<{ days: number; startMin: number; endMin: number }>
  sensors?: Array<'ivme' | 'isik' | 'yakinlik' | 'basinc'>; screenFrom?: string[]; seq?: number
}
/** Görünür izleme (§11.6, açıklama 1); cevrimici: son bildirimden bu yana 20 dakika geçmedi; configSeq: uygulanan yapılandırma (0: yok) */
export interface UcDurumu {
  ucId: Hex; mode: UcModu; configSeq: number; kameraAcik: boolean; since: number; alicilar: Array<{ toId: Hex; purpose: 'analiz' | 'canli' }>
  yenidenBasladi: boolean; pil: { percent: number; tempC: number; onAC: boolean }; thermal: 'normal' | 'kisildi' | 'durdu'; seq: number; alinma: number; cevrimici: boolean
  /** Sensör modunda açık sensörler ve olayların gittiği koleksiyonlar (açıklama 2 madde 1); başka modda boş */
  sensors: UcSensoru[]; sensorHedefleri: Hex[]
}
export interface IzlemeAkisi {
  streamId: Hex; codec: 'h264'; profile: string; width: number; height: number; fps: number
  ac (cerceve: Uint8Array): { tip: 1 | 2; ssrc: number; seq: number; ts: number; level: number; sayac: number; yuk: Uint8Array }
  /** Ters yön (açıklama 1 madde 5): anahtar kare isteği, denetim izi */
  denetimMuhurle (yuk: Uint8Array, o: { ts: number; level?: number }): Uint8Array
}
/** Akış isteğinin ucun anındaki koşulları (§11.3, §11.4, §11.5) */
export interface UcKosulu { oturum: 'dogrudan' | 'role'; yerel: { gun: number; dk: number }; thermal?: 'normal' | 'kisildi' | 'durdu'; pil?: { percent: number; onAC: boolean; tempC?: number; kritik?: boolean } }
/** Yayınlanacak UC_STATUS ve alıcıları (aktif ebeveyn ve yetişkinler) */
export interface UcDurumYayini { bytes: Uint8Array; alicilar: Hex[] }
export class CameraApi extends Emitter {
  /** ciftSirri(peerHex): platformun çift sırrı (tören anahtarı dahil; zorunlu, açıklama 1 madde 7); saklama: uçların bilinen yapılandırma seq'leri */
  /** kayit verilirse silme raporu Ebeveynler koleksiyonuna `hf.wipe.report` olarak yazılır ve oradan okunur (§9.2 madde 7) */
  constructor (o: { defter: LedgerApi; ciftSirri: (peerHex: Hex) => Uint8Array | null; saklama?: { get (k: string): unknown; set (k: string, v: unknown): void } | null; kayit?: RecordApi | null; now?: () => number })
  edges (): Array<{ ucId: Hex; ad: string; durum: UcDurumu | null }>
  /** 341 (ebeveyn; biyometri platformda): uca doğrudan ya da kutu emanetiyle gidecek UC_CONFIG; seq verilmezse bilinen + 1. Hata WRONG_EDGE, UNAUTHORIZED, INVALID_TARGET, INVALID_BODY */
  configure (ucId: Hex, cfg: UcYapilandirma): { bytes: Uint8Array; seq: number }
  /** Başka ebeveynin yapılandırmasının kopyası: seq öğrenilir */
  configSeen (fromHex: Hex, bytes: Uint8Array, yol: ZarfYolu): number
  receiveStatus (fromHex: Hex, bytes: Uint8Array, yol: ZarfYolu): UcDurumu
  /** 342 */
  status (ucId: Hex): UcDurumu | null
  openCameras (): Array<{ ucId: Hex; alicilar: Array<{ toId: Hex; purpose: 'analiz' | 'canli' }>; since: number }>
  /** 343: UC_STREAM_OPEN (canlı); configSeq ucun UC_STATUS'undan. Uca yalnız doğrudan oturumla. Hata NO_CONFIG */
  watch (ucId: Hex, o?: { want?: { width: number; height: number; fps: number }; configSeq?: number | null }): { streamId: Hex; bytes: Uint8Array }
  receiveAccept (fromHex: Hex, bytes: Uint8Array, yol: ZarfYolu): IzlemeAkisi
  receiveClose (fromHex: Hex, bytes: Uint8Array, yol: ZarfYolu): { streamId: Hex; code: string }
  /** 344: uca gidecek UC_STREAM_CLOSE */
  stopWatching (streamId: Hex): Uint8Array
  /** 345: ekran ucuna kartlar (ebeveyn ya da yetişkin; en çok 12, zarf en çok 32 KB). SCREEN_ALERT gösterilip onaylanmadan imzalanmaz; sıra max(son + 1, ms). Hata WRONG_EDGE, UNAUTHORIZED, NO_ALERT_APPROVAL, NOT_MODE_SCREEN, SOURCE_NOT_ALLOWED, CARD_COUNT, TOO_LARGE, INVALID_MESSAGE */
  sendCard (ucId: Hex, cards: EkranKarti[], o: { uyariOnay: true }): { bytes: Uint8Array; seq: number; uyari: string }
  /** "Sensör açık" satırı (açıklama 2 madde 1): sensör modundaki uçlar, açık sensörleri ve hedef koleksiyonları */
  openSensors (): Array<{ ucId: Hex; sensors: UcSensoru[]; hedefler: Hex[]; cevrimici: boolean }>
  /** RETIRE_BEGIN (ebeveyn): uca gidecek kaldırma isteği; uç verisini cihazın başındaki kişi onaylayınca siler. Hata WRONG_EDGE, UNAUTHORIZED */
  startRemoval (ucId: Hex): Uint8Array
  /** APP_WIPE_REPORT (yalnız uç): imza defterdeki cihaz anahtarıyla; cihaz başına en yeni rapor saklanır, Ebeveynler'e yazılır ve 'wipe-report' yayılır. Hata UNAUTHORIZED, INVALID_SIGNATURE, INVALID_MESSAGE, TYPE_NOT_ALLOWED */
  receiveWipeReport (fromHex: Hex, bytes: Uint8Array, yol: ZarfYolu): SilmeRaporu & { kayit: 'yazildi' | 'vardi' | 'koleksiyon-yok' | null }
  /** 347: cihaz başına en yeni rapor (bu telefondakiler ve Ebeveynler'deki kayıtlar, yeniden doğrulanarak) */
  wipeReports (): SilmeRaporu[]
  /** Bu telefondaki raporlardan Ebeveynler'de kaydı olmayanları yazar (koleksiyon sonradan açıldıysa); yazılan sayısı */
  writeToParents (): number
  /** DEVICE_DETACH: `emeklilik` raporu varsa wipe ve özetle, yoksa (ya da yalnız `kaldirma` raporu varsa) özet sıfır (§9.2 madde 7, 8) */
  removeEdge (ucId: Hex, o?: { reason?: string }): YazimSonucu
  /** Defterden çıkarılmış uçlar; silindi: rapor özetiyle çıkarıldı */
  removed (): Array<{ ucId: Hex; ad: string; silindi: boolean; wipeReportHash: Hex | null; rapor: SilmeRaporu | null; removedSeq: number }>
  on (ad: 'status', fn: (ucId: Hex, s: UcDurumu) => void): this
  on (ad: 'stream-closed', fn: (streamId: Hex, code: string) => void): this
  on (ad: 'wipe-report', fn: (r: SilmeRaporu) => void): this
}
/**
 * Uç modundaki cihazın (Android uç, iOS ekran) çekirdek yüzü; kamera ve kodlayıcı uygulamanın yerli modülünde. Durumu
 * değiştiren her yöntem yayınlanacak UC_STATUS'u döner; güncel durum yayınlanmadan kare mühürlenmez (açıklama 1 madde 1).
 */
export class EdgeDevice extends Emitter {
  /** saklama: kalıcı (zorunlu; seq'ler ve yapılandırma geri yüklenir, açıklama 1 madde 2); ciftSirri zorunlu */
  constructor (o: { ledger?: unknown; defter?: (() => unknown) | null; me: unknown; ciftSirri: (peerHex: Hex) => Uint8Array | null; saklama: { get (k: string): unknown; set (k: string, v: unknown): void }; now?: () => number })
  /** 340: tören sonrası uç olma; NODE_PROFILE (seq kalıcı). Hata NOT_EDGE */
  become (o: { runtime?: 'android-uc' | 'ios-ekran'; modlar?: UcModu[] | null; hostId: Hex; appVersion: string; versionCode: number }): Uint8Array
  readonly mode: UcModu
  /** UC_CONFIG: { kabul, kapat, durum }. Hata WRONG_EDGE, UNAUTHORIZED, LEDGER_BEHIND, INVALID_TARGET, INVALID_BODY */
  receiveConfig (fromHex: Hex, bytes: Uint8Array, yol: ZarfYolu): { kabul: boolean; kapat: Uint8Array[]; durum: UcDurumYayini | null }
  /** UC_STREAM_OPEN: kabulde UC_STREAM_ACCEPT, önce yayınlanacak durum, mühürleme (STATUS_NOT_PUBLISHED) ve ters yön açıcısı */
  receiveStreamRequest (fromHex: Hex, bytes: Uint8Array, yol: ZarfYolu, u: UcKosulu): { kabul: Uint8Array; durum: UcDurumYayini; streamId: Hex; muhurle (yuk: Uint8Array, o: { ts: number; level?: number }): Uint8Array; denetimAc (cerceve: Uint8Array): { yuk: Uint8Array } } | { kapat: Uint8Array; code: string }
  closeStream (streamId: Hex, code: string): { kapat: Uint8Array; durum: UcDurumYayini }
  receiveClose (fromHex: Hex, bytes: Uint8Array, yol: ZarfYolu): { streamId: Hex; code: string; durum: UcDurumYayini }
  /** Akış ömrü (açıklama 1 madde 4): dakikada bir ve defter değişince; kapanan akışlar ve değiştiyse durum */
  check (u: UcKosulu): { kapat: Uint8Array[]; durum: UcDurumYayini | null }
  /** §11.2: kamera dokunulmayı bekliyor (açıklama 1 madde 6) */
  restarted (v: boolean): UcDurumYayini
  /** UC_STATUS: 15 dakikada bir */
  buildStatus (u?: UcKosulu): UcDurumYayini
  /** UC_SCREEN_PUSH (ekran modu): screenFrom'a uyan üyeden; gönderen başına seq kalıcı, kartlar bellekte. Hata NOT_MODE_SCREEN, SOURCE_NOT_ALLOWED, STALE_CARD, TOO_LARGE, CARD_COUNT, INVALID_MESSAGE, INVALID_SIGNATURE, UNAUTHORIZED, DELETED */
  receiveScreen (fromHex: Hex, bytes: Uint8Array, yol: ZarfYolu): { fromId: Hex; seq: number; kartSayisi: number }
  /** Ekranda gösterilecek kartlar (süresi geçmemiş) */
  cards (): Array<EkranKarti & { fromId: Hex }>
  /** Sensör olayı (sensör modu; tür başına dakikada bir, aksi null): olaylar koleksiyonuna REC_DROP, ailenin telefonlarına REC_OPS. Olay yalnız yapılandırmadaki hedef koleksiyonlara; yetki her çağrıda. Hata NOT_MODE_SENSOR, SENSOR_DISABLED, OUT_OF_WINDOW, STATUS_NOT_PUBLISHED, INVALID_TARGET, NO_DROP_PERMISSION, DELETED */
  sensorEvent (o: { sensor: UcSensoru; value: number; yerel: { gun: number; dk: number } }): { olaylar: Array<{ collectionId: Hex; opId: Hex; recordId: Hex; type: string }>; mesaj: { type: number; bytes: Uint8Array } } | null
  /** TASK: uç görev çalıştırmaz; gönderene TASK_REJECT { code: 'DESTEK_YOK' } (telde giden kod) */
  receiveTask (fromHex: Hex, bytes: Uint8Array, yol: ZarfYolu): { type: number; bytes: Uint8Array }
  /** Uç defterden çıkarıldı mı (platform yerel verisini siler) */
  removed (): boolean
  /** RETIRE_BEGIN (ebeveynden): kaldırma istendi; dönüş boş RETIRE_LIST. Hata WRONG_EDGE, UNAUTHORIZED */
  receiveRemoval (fromHex: Hex, bytes: Uint8Array, yol: ZarfYolu): Uint8Array
  /** 24 saat geçerli; isteyen artık ebeveyn değilse null */
  removal (): { from: Hex; t: number } | null
  /** Verisini sil ve raporla (§9.2 madde 4–5): APP_WIPE_REPORT, özeti, result, alıcılar (aktif ebeveynler) ve açık akışların kapanış bildirimleri. Sonra uç her yöntemde DELETED. Hata REMOVAL_NOT_REQUESTED, DELETED, INVALID_MESSAGE */
  wipe (o: SilmeGirdisi): { bytes: Uint8Array; hash: Hex; result: 'ok' | 'dogrulanamadi' | 'hata'; alicilar: Hex[]; kapat: Array<{ toId: Hex; bytes: Uint8Array }> }
  on (ad: 'config', fn: (m: unknown) => void): this
  on (ad: 'stream', fn: (streamId: Hex, a: { toId: Hex; purpose: 'analiz' | 'canli' }) => void): this
  on (ad: 'stream-closed', fn: (streamId: Hex, code: string) => void): this
  on (ad: 'removal', fn: (fromHex: Hex) => void): this
  on (ad: 'wiped', fn: (result: 'ok' | 'dogrulanamadi' | 'hata') => void): this
  on (ad: 'cards', fn: (kartlar: Array<EkranKarti & { fromId: Hex }>) => void): this
}
