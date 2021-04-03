// derived from https://jimmywarting.github.io/StreamSaver.js/
function makeIframe(src, loadCb) {
  if (!src) throw new Error('meh');
  const iframe = document.createElement('iframe');
  iframe.hidden = true;
  iframe.src = src;
  iframe.name = 'iframe';
  iframe.postMessage = (...args) => iframe.contentWindow.postMessage(...args);
  iframe.addEventListener('load', () => typeof loadCb === "function" && loadCb(), { once: true });
  document.body.appendChild(iframe);
  return iframe;
}

// not using single instance design pattern
function createWriteStream(headers) {
  const channel = new MessageChannel();
  const passThrough = new TransformStream();
  const readableStream = passThrough.readable;
  
  // To service worker
  channel.port1.postMessage({ readableStream }, [readableStream]);
  // Service worker reply to us with a link that we should open.
  channel.port1.onmessage = event => {
    if (event.data.download) {
      makeIframe(event.data.download);
      // We never remove this iframes b/c it can interrupt saving
    }
  };

  if(headers instanceof Headers) {
    const clonedHeaders = {}
    for (const pair of headers.entries()) {
      clonedHeaders[pair[0]] = pair[1];
    }
    headers = clonedHeaders;
  }

  const port2relayer = makeIframe(
    "/stream-saver/relay.html",
    () => port2relayer.postMessage({ headers }, '*', [channel.port2])
  );

  return passThrough.writable;
}

export { createWriteStream };