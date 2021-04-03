self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

const map = new Map();

// This should be called once per download
// Each event has a dataChannel that the data will be piped through
self.onmessage = event => {
  const data = event.data;
  const port = event.ports[0];
  const metadata = {
    data,
    port,
    stream: null
  };

  port.onmessage = event => {
    port.onmessage = null;
    metadata.stream = event.data.readableStream;
  };

  map.set(data.url, metadata);
  port.postMessage({ download: data.url });
};

self.onfetch = event => {
  const url = event.request.url;
  if (!map.has(url)) 
    return ;
  const { stream, data, port } = map.get(url);
  map.delete(url);

  event.respondWith(
    new Response(
      stream,
      { 
        headers: new Headers({
          'Content-Security-Policy': "default-src 'none'",
          'X-Content-Security-Policy': "default-src 'none'",
          'X-WebKit-CSP': "default-src 'none'",
          'X-XSS-Protection': '1; mode=block',
          ...data.headers
        }) 
      }
    )
  );
};
