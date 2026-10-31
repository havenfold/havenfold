# Gerçek sistemde deneme: görüntü görevinin pod'u (D89, inceleme 23 madde 3 ve 11)

Deneme makinesinde (Ubuntu Server 24.04, 25 Ekim 2026) gerçek deneme **yapılamadı**:

| Engel | Durum |
|-------|-------|
| Podman | Kurulu değil (`podman: command not found`) |
| Ayrıcalıksız kullanıcı ad alanı | `kernel.apparmor_restrict_unprivileged_userns = 1`: `unshare -rn` → `uid_map: Operation not permitted`. Rootless Podman'ın AppArmor profili `podman` paketiyle gelir. |
| `/run/netns` | Yok (kök ad alanı kurulmadı; yeni tasarımda gerekmiyor) |

## Yönetici adımı (sudo)

```
sudo apt install podman uidmap slirp4netns
```

(`havenfold-task` kullanıcısı kurulumla gelir; yoksa deneme geliştiricinin kendi kullanıcısıyla da yapılabilir.)

## Sonra koşulacak deneme (sudo gerekmez)

1. Rootless pod, yalnız geri döngü:
   ```
   podman pod create --name hf-deneme --network=none --userns=keep-id
   podman run --rm --pod hf-deneme docker.io/library/busybox:1.36 ip addr      # yalnız lo beklenir
   podman run --rm --pod hf-deneme docker.io/library/busybox:1.36 wget -T 3 -q -O- http://1.1.1.1 ; echo $?   # başarısız beklenir
   ```
2. Akış sunucusu konteyneri (benzetim) aynı pod'da 127.0.0.1:8554 dinler; görev konteyneri aynı pod'dan bağlanır:
   `node/edge/rtsp-simulation.js` için Node içeren yerel bir imaj (`localhost/havenfold-rtsp:benzetim`), `podman.js` `sunucuArgumanlari` ile aynı bayraklar (`--read-only --cap-drop=all --security-opt=no-new-privileges --memory=64m --pids-limit=32 --log-driver=none`).
3. Denetçinin (başka kullanıcı) `akis/akis.sock`'a grup izniyle (2770 dizin, 0660 soket) bağlanabildiği.
4. `podman pod rm --force hf-deneme`.

Sonuçlar bu dosyaya ve `kollar/D-durum.md` D89 satırına işlenir.
