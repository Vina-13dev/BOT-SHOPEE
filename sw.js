// sw.js — Service Worker do Bot Afiliados
//
// Estratégia: SÓ cacheia o "esqueleto" do app (o próprio index.html,
// manifest, ícones) — pra abrir rápido e funcionar minimamente offline.
// NUNCA cacheia nada do Firestore/Firebase (ofertas, perfil, links
// prontos) — isso sempre precisa vir fresco da rede, senão você via
// ofertas velhas ou perdia o que acabou de salvar.
//
// Sempre que possível usa a rede primeiro (network-first) — evita ficar
// preso numa versão antiga do app depois de uma atualização.
const CACHE_VERSION = 'bot-afiliados-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting(); // aplica a versão nova assim que instalar, sem esperar fechar todas as abas
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Só mexe em requisições do próprio site (GET). Firebase/Firestore,
  // Google Fonts, etc. (outros domínios) passam direto pra rede, sem cache.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copia));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
