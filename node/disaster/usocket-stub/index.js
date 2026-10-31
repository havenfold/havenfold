// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL
// was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// usocket yerine boş paket (D91): dbus-next unix soket yolunda require('usocket') hatasını yakalar ve Node'un net
// modülüyle bağlanır. Dosya tanıtıcısı geçirme (AcquireWrite/AcquireNotify) ve soyut soket kullanılmaz; yerli derleme yok.
throw new Error('NO_USOCKET')
