/* TRIBASE service worker — instalável + offline básico (runtime cache).
   Estratégia: stale-while-revalidate para same-origin GET; navegações
   caem para o index.html em cache quando offline. */
const CACHE = "tribase-cache-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // não intercepta Supabase/CDNs

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") cache.put(request, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        e.waitUntil(network); // atualiza em segundo plano
        return cached;
      }
      const res = await network;
      if (res) return res;
      // offline e sem cache: para navegações, devolve o shell
      if (request.mode === "navigate") {
        return (await cache.match("/index.html")) || (await cache.match("/")) || Response.error();
      }
      return Response.error();
    })()
  );
});
