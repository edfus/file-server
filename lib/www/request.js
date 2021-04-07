class AbortableResponseQueue extends Array {
  constructor(iterator, threads) {
    super();
    for (let i = 0; i < threads; i++) {
      this.push(iterator.next().value);
    }
    this.iterator = iterator;
  }

  shift() {
    if (!this.errored) {
      const ret = this.iterator.next();
      if (ret.done) {
        this.done = true;
      } else {
        this.push(ret.value);
      }
    }

    return super.shift();
  }

  async pipeTo(writable) {
    if (this.writer) {
      console.error("AbortableResponseQueue: this.writer exists");
      await this.writer.closed; // rejects if the stream errors.
    }
    const writer = writable.getWriter();
    await writer.ready;
    this.writer = writer;

    return new Promise(async (resolve, reject) => {
      this._reject = reject;
      try {
        while (true) {
          const res = await this.shift();
          if (!res) break;
          const reader = res.body.getReader();
          while (true) {
            const result = await reader.read();
            if (result.done) break;
            await this.writer.write(result.value);
            // will stuck forever if user canceled download
          }
        }

        await this.writer.close();
        this.writer = null;
        this._reject = null;

        return resolve();
      } catch (err) {
        this.writer = null;
        this._reject = null;

        return this.abort(err).then(() => reject(err), reject);
      }
    });
  }

  async abort(err) {
    this.errored = true;
    this._reject && this._reject(err);
    this.forEach(
      async res => {
        if (res instanceof Promise) {
          (await res).body.cancel();
        } else {
          res.body.cancel();
        }
      }
    );
    return this.writer.abort();
  }
}

let createWriteStream = null; //
async function download(pathname, isRangeRequest, threadsInput) {
  const url = new URL(encodeURIComponent(pathname), location.origin);
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
          const iterator = rangeYielder(url, gap, contentLength);
          const responses = new AbortableResponseQueue(iterator, threads - 1);
          const fileStream = createWriteStream(res.headers, err => responses.abort(err));

          return responses.pipeTo(fileStream);
        }
      }
    )
      .then(() => setTimeout(() => ProgressLog.instance.close(), 1200))
      .catch(err => {
        clearInterval(intervalTimer);
        ProgressLog.instance && ProgressLog.instance.close();
        throw err;
      });
  } else {
    return fetch(
      url,
      {
        method: "HEAD"
      }
    ).then(res => {
      if (res.status === 200) {
        const iframe = document.createElement('IFRAME');
        iframe.hidden = true;
        iframe.src = url;

        return new Promise((resolve, reject) => {
          iframe.addEventListener('load', () => {
            resolve(`${url.pathname} ${iframe.contentDocument.body.textContent}`);
            iframe.remove();
          }, { once: true });

          document.body.appendChild(iframe);
          // setTimeout(() => reject(`Download ${url.pathname} failed.`), 10000);
        });
      } else {
        throw new Error(`Download ${url.pathname} errored: ${res.status} ${res.statusText}`);
      }
    });
  }
}

class SetDirentList {
  constructor (input) {
    if(Array.isArray(input))
      return SetDirentList._defineFiles({}, new Set(input));

    return SetDirentList._defineFiles({}, new Set());
  }

  static _defineFiles (instance, value) {
    return Object.defineProperty(
      instance,
      Symbol.for("files"),
      {
        enumerable: false,
        writable: true,
        value
      }
    )
  }

  static shallowSquash (list, newList) {
    //TODO
  }

  static shallowMerge (list, newList) {
    const set = list[Symbol.for("files")];
    if(newList[Symbol.for("files")])
      newList[Symbol.for("files")].forEach(file => set.add(file));

    //TODO
    for (const foldername of Object.keys(newList)) {
      if(!list[foldername]) {
        list[foldername] = newList[foldername];
      }
    }
    list[Symbol.for("files")] = set;

    return list;
  }
}

class DirentListFetcher {
  list = new SetDirentList();

  updateDirentList(path, direntList) {
    path = this.normalizePath(path);

    const list = this._getList(path);
    if(list) {
      const files = list[Symbol.for("files")];
      const folders = Object.keys(list);

      if(!files.size && !folders.length)
        return "empty";

      const newDirentList = direntList.cloneNode(false);

      files.forEach(
        file => {
          const option = document.createElement("OPTION");

          option.setAttribute("type", "file");
          option.value = this.normalizePath(`${path}/${file}`).replace(/^\/+/, "");

          newDirentList.appendChild(option);
        }
      );

      folders.forEach(
        folder => {
          const option = document.createElement("OPTION");

          option.setAttribute("type", "folder");
          option.value = this.normalizePath(`${path}/${folder}`).replace(/^\/+/, "");

          newDirentList.appendChild(option);
        }
      );
      
      direntList.parentNode.replaceChild(newDirentList, direntList);
      direntList.remove();
      return "ok";
    }
  }

  // absolute path required
  normalizePath(path = "/") {
    return path = path.trim().replace(/[\\\/]+/g, "/").replace(/^([^\/])/, "/$1");
  }

  _getList(path) {
    const pathParts = path.split("/");

    let list = this.list;
    for (const part of pathParts) {
      if(!part.length)
        continue;
      if(typeof list[part] === "object") {
        list = list[part];
      } else {
        return null;
      }
    }

    return list;
  }

  _addFiles (path, filesArray) {
    const pathParts = path.split("/").filter(p => p);

    const setDirentList = new SetDirentList(filesArray);

    if(!pathParts.length) // root
      return SetDirentList.shallowMerge(this.list, setDirentList);

    let list = this.list;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if(typeof list[part] === "object") {
        list = list[part];
      } else {
        list = list[part] = new SetDirentList();
      }
    }
    
    const lastPart = pathParts[pathParts.length - 1];
    if(!lastPart)
      throw new Error("Unexpected falsy lastpart of ".concat(path));

    if(typeof list[lastPart] === "object") {
      return SetDirentList.shallowMerge(list[lastPart], setDirentList);
    } else {
      return list[lastPart] = setDirentList;
    }
  }

  _touchFolder(path) {
    const pathParts = path.split("/");

    let list = this.list;
    for (const part of pathParts) {
      if(!part.length)
        continue;
      if(list[part] === "object") {
        list = list[part];
      } else {
        list = list[part] = new SetDirentList();
      }
    }

    return list;
  }

  _setList(path, list) {
    const oldList = this._touchFolder(path);

    return SetDirentList.shallowMerge(oldList, list);
  }

  async fetch(path, auth) {
    path = this.normalizePath(path);
    const headers = {
      "Accept": "application/json"
    };

    if (auth) {
      headers["Authorization"] = auth;
    }

    return fetch(
      new URL(`${location.origin}/api?action=get-list&list=${encodeURIComponent(path)}`),
      { headers }
    )
      .then(res => {
        if (res.status === 200)
          return res.text();
        throw new Error(`${res.status} ${res.statusText}`);
      })
      .then(
        rawJSON => {
          const dirents = JSON.parse(rawJSON);

          const folders = [];
          const files = (
            dirents.filter(
              dirent => {
                switch (dirent.type) {
                  case "folder":
                    folders.push(dirent.value);
                    return false;
                  case "file":
                    return true;
                }  
              }
            ).map(
              ({ type, value }) => {
                const filepath = this.normalizePath(value);
                if(!filepath.startsWith(path))
                  throw new Error(`Expected '${filepath}'.startsWith(${path})`);
                return filepath.replace(path, "");
              }
            ).sort(
              (filenameA, filenameB) => filenameA.localeCompare(filenameB) 
            )
          );

          this._addFiles(path, files);

          for (const folderpath of folders) {
            this._touchFolder(this.normalizePath(folderpath));
          }

          return this._getList(path);
        }
      );
  }
}

async function upload(file, destination, auth) {
  if (!/\.[^\\/]+$/.test(destination) && /\.[^\\/]+$/.test(file.name)) {
    destination = destination.concat(file.name.match(/\.[^\\/]+$/)[0]);
  } // add extension

  return fetch(
    new URL(`${location.origin}/api?action=upload&path=${encodeURIComponent(destination)}`),
    {
      method: "PUT",
      body: file,
      headers: {
        "Authorization": auth,
        "Content-Type": file.type,
        "Content-Length": file.size
      }
    }
  ).then(async res => {
    if ([200, 204, 201].includes(res.status))
      return res;
    else throw new Error(`${res.status} ${await res.text() || res.statusText}`);
  });
}


class ProgressLog {
  entries = {};
  twirl = ["\\", "|", "/", "-"];
  length = 0;
  debounce = {
    in: false,
    func: () => {
      if (this.entries) {
        this.dom.value = Object.keys(this.entries).reduce((acc, i) => acc.concat(this.entries[i].concat("\n")), "");
        this.debounce.in = false;
      }
    }
  };

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
  DirentListFetcher,
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