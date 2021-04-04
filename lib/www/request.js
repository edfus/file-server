let createWriteStream = null; //
async function download(pathname, isRangeRequest, threadsInput) {
  const url = new URL(pathname, location.origin);
  url.searchParams.set("download", 1);

  if (isRangeRequest) {
    const titleLogger = ProgressLog.instance.bar(`Warming up for fetching ${url.pathname}...`);
    const intervalTimer = setInterval(titleLogger.log, 20);
    
    return fetch(
      url,
      {
        method: "HEAD",
        headers: new Headers({
          range: "0-"
        })
      }
    ).then(
      async res => {
        clearInterval(intervalTimer);
        titleLogger.close();
        ProgressLog.instance.bar(`Downloading ${url.pathname}...`);

        if (res.status !== 206) {
          throw new Error(`${res.status} ${res.statusText}`);
        }

        const MiB = 2 ** 20;
        const contentLength = Number(res.headers.get("Content-Length"));
        const threads = Number(threadsInput);

        if (contentLength < 32 * MiB * threads) {  // concat with Blob directly
          const gap = Math.max(Math.floor(contentLength / threads), 8 * MiB);
          
          let offset = 0;
          return Promise.all(
            new Array(Math.ceil(contentLength / gap)).fill(void 0)
              .map(
                (v, i) => new Promise((resolve, reject) => {
                  const start = offset;
                  let end = (offset += gap) - 1;
                  if (end >= contentLength) end = "";
                  
                  rangeRequest(url, start, end)
                    .catch(err => rangeRequest(url, start, end))  // retry
                    .then(res => res.arrayBuffer())
                    .then(resolve, reject)
                    ;
                })
              )
          ).then(
            results => {
              const contentType = res.headers.get("Content-Type").split(";")[0];

              const link = URL.createObjectURL(new Blob(results, { type: contentType }));
              const a = document.createElement("A");
              a.href = link;
              a.download = res.headers.get("Content-Disposition").replace(
                /^attachment;\sfilename="(.+)?"/,
                (whole, filename) => decodeURIComponent(filename)
              );
              a.click();
            }
          );
        } else {
          if (!createWriteStream) {
            createWriteStream = (await import("/_lib_/stream-saver/index.js")).createWriteStream;
          }

          const gap = 32 * MiB;
          const fileStream = createWriteStream(res.headers);
          const iterator = rangeYielder(url, gap, contentLength);

          const responses = new class extends Array {
            constructor(threads) {
              super();
              for (let i = 0; i < threads; i++) {
                this.push(iterator.next().value);
              }
            }

            shift() {
              if (!this.done) {
                const ret = iterator.next();
                if (ret.done) {
                  this.done = true;
                } else {
                  this.push(ret.value);
                }
              }
              return super.shift();
            }

            async pipeTo(writable) {
              while (true) {
                const res = await this.shift();
                if (!res) break;
                await res.body.pipeTo(writable, { preventClose: true });
              }
              writable.close();
            }
          }(threads - 1);

          return responses.pipeTo(fileStream);
        }
      }
    )
      .then(() => setTimeout(() => ProgressLog.instance.close(), 1200))
      .catch(err => {
        clearInterval(intervalTimer);
        ProgressLog.instance.close();
        throw err;
      })
  } else {
    const iframe = document.createElement('IFRAME');
    iframe.hidden = true;
    iframe.src = url;
    iframe.addEventListener('load', () => {
      logAppend(url.pathname, iframe.contentDocument.body.textContent);
      iframe.remove();
    }, { once: true });
    document.body.appendChild(iframe);
  }
}

function setList(dataList) {
  fetch(
    new URL(`${location.origin}/api?action=get-list&list=${encodeURIComponent("/")}`)
  )
    .then(res => {
      if (res.status === 200)
        return res.text();
      throw new Error(`${res.status} ${res.statusText}`);
    })
    .then(
      rawJSON => {
        const files = JSON.parse(rawJSON);
        
        dataList.innerHTML = files.sort(
            (direntA, direntB) => {
              if(direntA.type === "folder") {
                if(direntB.type === "folder") {
                  return direntA.value.localeCompare(direntB.value);
                } else {
                  return -1; // folder first
                }
              } else {
                if(direntB.type === "file") {
                  return direntA.value.localeCompare(direntB.value);
                } else {
                  return -1;
                }
              }
            }
          ).map(
          ({ type, value }) => {
            //TODO implement my own custom solution
            switch (type) {
              case "file":
                value = value.replace(/^\//, "");
                return  `<option type="${type}" value="${value}">`;
              case "folder":
              // value = value.replace(/([^\/])$/, "$1/");
                return  `<option type="${type}" value="${value}">`;
            }
          });
      }
    );
}

async function upload (file, destination) {
  if(!/\.[^\\/]+$/.test(destination) && /\.[^\\/]+$/.test(file.name)) {
    destination = destination.concat(file.name.match(/\.[^\\/]+$/)[0]);
  } // add extension
  
  return fetch(
    new URL(`${location.origin}/api?action=upload&path=${encodeURIComponent(destination)}`),
    {
      method: "PUT",
      body: file,
      headers: {
        "Authorization": `Basic ${btoa(`${username.value}:${password.value}`)}`,
        "Content-Type": file.type,
        "Content-Length": file.size
      }
    }
  ).then(async res => {
    if([200, 204, 201].includes(res.status))
      return res;
    else throw new Error(`${res.status} ${await res.text() || res.statusText}`)  
  })
}


class ProgressLog {
  entries = {};
  twirl = ["\\", "|", "/", "-"];
  length = 0;
  debounce = {
    in: false,
    func: () => {
      this.dom.value = Object.keys(this.entries).reduce((acc, i) => acc.concat(this.entries[i].concat("\n")), "");
      this.debounce.in = false;
    }
  }

  constructor(textArea, minInterval = 50) {
    this.dom = textArea;
    this._stash = textArea.value;
    this.minInterval = minInterval;

    this.constructor.instance = this;
  }

  bar(head) {
    const index = this.length++;
    this.entries[index] = head;
    let closed = false, x = 0;
    return {
      log: footer => {
        if (closed || this.closed) return;
        this.entries[index] = head.concat(this.twirl[x++]).concat(footer);
        this.update();
        if (x >= this.twirl.length) x = 0;
      },
      close: () => {
        delete this.entries[index];
        closed = true;
        this.update();
      }
    };
  }

  update() {
    if (this.debounce.in || this.closed) {
      return;
    } else {
      this.debounce.in = true;
      setTimeout(this.debounce.func, this.minInterval);
    }
  }

  close() {
    this.dom.value = this._stash;
    this._stash = null;
    this.entries = null;
    this.twirl = null;
    this.fleet = null;
    this.closed = true;

    this.constructor.instance = null;
  }

  static instance = null;
}

export {
  download,
  upload,
  setList,
  ProgressLog
};

/**
 * private
 */
async function rangeRequest(url, start, end) {
  const { log, close } = ProgressLog.instance.bar(`Bytes ${start}-${end} `);
  const progressCb = (loaded, total) => log(` ${(loaded / total * 100).toFixed(0)}%`);

  return fetch(url, {
    headers: new Headers({
      "Range": `bytes=${start}-${end}`,
      "Connection": "keep-alive"
    })
  }).then(response => {
    const reader = response.body.getReader();
    const total = parseInt(response.headers.get("Content-Length"), 10);
    let loaded = 0;

    return new Response(
      new ReadableStream({
        async start(controller) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              close(); break;
            }
            loaded += value.byteLength;
            progressCb(loaded, total);
            controller.enqueue(value);
          }
          controller.close();
        }
      })
    );
  });
  ;
}

function* rangeYielder(url, gap, contentLength) {
  for (let offset = 0; ;) {
    const start = offset;
    const end = (offset += gap) - 1;

    if (end >= contentLength) {
      return yield rangeRequest(url, start, "");
    }
    yield rangeRequest(url, start, end);
  }
}