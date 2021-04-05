// derived from https://jimmywarting.github.io/StreamSaver.js/
function makeIframe(src, loadCb, errorCb) {
  if (!src) throw new Error('meh');
  window[`__iframe${btoa(src)}OnError`] = errorCb;
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
function createWriteStream(headers, errorHandler) {
  const channel = new MessageChannel();
  const passThrough = new TransformStream();
  const readableStream = passThrough.readable;
  
  // To service worker
  channel.port1.postMessage({ readableStream }, [readableStream]);
  // Service worker reply to us with a link that we should open.
  channel.port1.onmessage = event => {
    if (event.data.download) {
      return makeIframe(event.data.download);
      // We never remove this iframes b/c it can interrupt saving
    }

    if("error" in event.data) {
      return errorHandler(
        event.data.error instanceof Error
         ? event.data.error
         : new Error(event.data.error)
      );
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
    "/_lib_/stream-saver/relay.html",
    () => port2relayer.postMessage({ headers }, '*', [channel.port2]),
    async err => {
      try {
        await passThrough.readable.cancel(err.message);
        await passThrough.writable.abort(err.message);
      } catch (error) {
        // locked
      }

      if(typeof errorHandler === "function") {
        return errorHandler(err);
      } else {
        throw err;
      }
    }
  );

  return passThrough.writable;
}

export { createWriteStream };