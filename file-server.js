import { stat, createWriteStream, createReadStream, readdir, existsSync } from "fs";
import { extname, basename, join, normalize, dirname } from "path";
import { pipeline } from "stream";
import mime from "./env/mime.js";
import pathMap from "./env/path-map.js";
import { fileURLToPath } from "url";
import EventEmitter from "events";
import { createServer } from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const local = (...paths) => join(__dirname, ...paths.map(p => normalize(p)));

const indexHTML = local("./lib/www/index.html");

class App extends EventEmitter {
  middlewares = [];
  context = {
    app: this,
    throw (status, message) {
      const err = new Error(message || status);
      err.status = status;
      err.expose = true;
      throw err;
    },
    assert (shouldBeTruthy, status, message) {
      if(!shouldBeTruthy) {
        this.throw(status, message);
      }
    }
  }

  prepend (middleware) {
    this.middlewares.unshift(middleware);
    return this;
  }

  use (middleware) {
    this.middlewares.push(middleware);
    return this;
  }

  callback () {
    return async (req, res) => {
      const proto = req.socket.encrypted ? "https:" : proxyHeader(req, "X-Forwarded-Host") || "http:";
      const protocol = proto.replace(/([^:]$)/, "$1:");

      let uriObject;
      try {
        uriObject = new URL(
          req.url, 
          `${protocol}//${proxyHeader(req, "X-Forwarded-Host") || req.headers.host}`
        );
      } catch (err) {
        this.emit("error", err);
        return req.destroy();
      }

      const ctx = {
        ...this.context,
        req, res,
        state: {
          pathname: decodeURIComponent(uriObject.pathname),
          uriObject: uriObject
        },
        url: uriObject.toString(),
        secure: protocol === "https:",
        ip: proxyHeader(req, "X-Forwarded-For") || req.socket.remoteAddress
      }

      let index = 0;
      const next = async () => {
        if(index >= this.middlewares.length)
          return ;
        return this.middlewares[index++](ctx, next);
      };

      try {
        await next();
      } catch (err) {
        const status = Number(err.status || 500);
        if(err.expose !== false && err.status < 500) {
          res.writeHead(status, err.message).end(err.message);
        } else {
          res.writeHead(status);
        }
        this.emit("error", err);
      } finally {
        if(!res.headersSent)
          res.writeHead(204, {
            "Cache-Control": "no-cache",
            "Connection": "close"
          });
        if(!res.writableEnded)
          res.end();
        req.resume();
      }
    }
  }

  listen (...argvs) {
    return (
      createServer(this.callback())
      .listen(...argvs)
    );
  }
}

const nonce = "nonce-dfbar12m3";
class Serve {
  implementedMethods = ["GET", "PUT", "HEAD"];
  listCache = new Map();
  mimeCache = new Map();

  pathnameRouter = {
    map: [
      pathname => pathMap.has(pathname) ? pathMap.get(pathname) : pathname,
    ],
    filter: [
      pathname => basename(pathname).startsWith(".") ? false : pathname
    ],
    fs: [
      pathname => pathname.replace(/<|>|:|"|\||\?|\*/g, "-")
    ],
    file: [
      pathname => pathname.endsWith("/") ? pathname.concat("index.html") : pathname,
      pathname => {
        if (/^\/index.html?$/.test(pathname))
          return {
            done: true,
            value: indexHTML
          };
        return pathname;
      },
      pathname => {
        if (/^\/_lib_\//.test(pathname))
          return {
            done: true,
            value: local("./lib/", pathname.replace(/^\/_lib_\//, ""))
          };
        return { done: false, value: pathname };
      }
    ],
    dir: [
      pathname => pathname.endsWith("/") ? pathname : pathname.concat("/")
    ]
  };

  fileResHeadersRouter = {
    cacheControl: [
      extension => "no-cache"
    ],
    CSP: [
      filepath => {
        if(filepath === indexHTML)
          return {
            done: true,
            value: `object-src 'none'; script-src 'self' '${nonce}' 'unsafe-inline'; require-trusted-types-for 'script';`
          }
        return filepath;
      },
      filepath => ""
    ]
  }

  mount (directory) {
    this.pathnameRouter.dir.push(pathname => join(directory, normalize(pathname)));
    this.pathnameRouter.file.push(pathname => join(directory, normalize(pathname)));
    return this;
  }

  * [Symbol.iterator] () {
    return yield * [
      async (ctx, next) => {
        ctx.assert(
          this.implementedMethods.includes(ctx.req.method.toUpperCase()),
          501
        );
        return next();
      },
      async (ctx, next) => {
        if (ctx.state.pathname === "/api") {
          switch (ctx.state.uriObject.searchParams.get("action")) {
            case "list":  /* Fall through */
            case "get-list": return this.getList(ctx);
            case "upload": return this.uploadFile(ctx);
            default: return ctx.throw(400, "Field 'action' required");
          }
        }
        return next();
      },
      async (ctx, next) => {
        try {
          await this.serveFile(ctx);
        } catch (err) {
          switch(err.status) {
            case 404: return ctx.res.writeHead(404).end("404 NOT FOUND");
            default: throw err;
          }
        }
      }
    ];
  }

  async getList(ctx) {
    const { req, res, state } = ctx;
    const url = state.uriObject;

    const dirToList = url.searchParams.get("l") || url.searchParams.get("list");

    ctx.assert(dirToList, 400, "Folder path required.");
    ctx.assert(req.method.toUpperCase() === "GET", 405, "Expected Method GET");

    const dirpath = this.routeThrough(
      dirToList,
      this.pathnameRouter.map, this.pathnameRouter.fs, this.pathnameRouter.dir
    );

    if (this.listCache.has(dirpath)) {
      const cached = this.listCache.get(dirpath);
      if (Date.now() - cached.createdAt > cached.maxAge) {
        this.listCache.delete(dirpath);
      } else {
        return res.writeHead(
          200, { "Content-Type": "application/json" }
        ).end(cached.value);
      }
    }

    return new Promise((resolve, reject) => {
      readdir(dirpath, { withFileTypes: true }, (err, files) => {
        if (err) {
          switch (err.code) {
            case "ENAMETOOLONG":
            case "ENOENT":
            case "ENOTDIR":
              err.status = 404;
              err.expose = false;
              return reject(err);
            default:
              err.status = 500;
              err.expose = false;
              return reject(err);
          }
        }

        const result = JSON.stringify(
          files
          .map(dirent => {
            if(!this.routeThrough(dirent.name, this.pathnameRouter.filter))
              return false;

            if (dirent.isFile()) {
              return {
                type: "file",
                value: join(dirToList, dirent.name).replace(/\\/g, "/")
              }
            }

            if(dirent.isDirectory()) {
              return {
                type: "folder",
                value: join(dirToList, dirent.name).replace(/\\/g, "/")
              }
            }
          })
          .filter(s => s)
        );

        this.listCache.set(dirpath, {
          createdAt: Date.now(),
          maxAge: 10 * 1000, // 10 seconds
          value: result
        });

        res.writeHead(200, { "Content-Type": "application/json" }).end(result, resolve);
      });
    });
  }

  async uploadFile(ctx) {
    const { req, res, state } = ctx;
    const url = state.uriObject;

    const uploadTarget = url.searchParams.get("p") || url.searchParams.get("path");
    
    ctx.assert(req.method.toUpperCase() === "PUT", 405, "Expected Method PUT");
    ctx.assert(uploadTarget, 400, "Destination path required.");

    let destination = uploadTarget; // decoded

    // content-type
    if (!/\.[^\\/]+$/.test(destination) && req.headers["content-type"]) {
      const contentType = req.headers["content-type"];
      if (mimeCache.has(contentType)) {
        destination = destination.concat(mimeCache.get(contentType));
      } else {
        for (const key of Object.keys(mime)) {
          if (mime[key] === contentType) {
            mimeCache.set(contentType, key);
            destination = destination.concat(key);
            break;
          }
        }
      }
    }

    const filepath = this.routeThrough(
      destination,
      this.pathnameRouter.fs, this.pathnameRouter.file
    );

    ctx.assert(
      existsSync(dirname(filepath)),
      403,
      "You DO NOT have the permission to create folders"
    );

    if (existsSync(filepath)) {
      return new Promise((resolve, reject) => {
        stat(filepath, (err, stats) => {
          if (err) {
            error.status = 500;
            error.expose = false;
            return reject(error);
          }
  
          try {
            ctx.assert(stats.isFile(), 403, "A directory entry already exists.");
          } catch (err) {
            return reject(err);
          }

          res.writeHead(200, {
            "Content-Location": encodeURIComponent(destination)
          }).flushHeaders();
  
          pipeline(
            req,
            createWriteStream(filepath, { flags: "w" }),
            error => {
              if(error) {
                error.status = 500;
                error.expose = false;
                return reject(error);
              }
              
              return res.end(`Modified ${destination}`, resolve);
            }          
          );
        });
      });
    } else {
      res.writeHead(201, {
        "Content-Location": encodeURIComponent(destination)
      }).flushHeaders();

      return new Promise((resolve, reject) => {
        pipeline(
          req,
          createWriteStream(filepath, { flags: "w" }),
          error => {
            if(error) {
              error.status = 500;
              error.expose = false;
              if(error.code === "ERR_STREAM_PREMATURE_CLOSE") {
                return reject(error.message);
              }
              return reject(error);
            }
            return res.end(`Created ${destination}`, resolve);
          }
        );
      }); 
    }
  }

  async serveFile(ctx) {
    const { req, res, state } = ctx;
    const url = state.uriObject;

    const isDownload = url.searchParams.get("d") || url.searchParams.get("download");
    const filepath = this.routeThrough(
      state.pathname,
      this.pathnameRouter.map, this.pathnameRouter.fs, this.pathnameRouter.file
    );

    return new Promise((resolve, reject) => {
      stat(filepath, (err, stats) => {
        if (err) {
          switch (err.code) {
            case "ENAMETOOLONG":
            case "ENOENT":
              err.status = 404;
              err.expose = false;
              return reject(err);
            default:
              err.status = 500;
              err.expose = false;
              return reject(err);
          }
        }
  
        try {
          ctx.assert(!stats.isDirectory(), 400, "This is a FOLDER");
          ctx.assert(stats.isFile(), 404);
        } catch (err) {
          return reject(err);
        }
  
        const filename = basename(filepath);
        const fileExtname = extname(filename);
  
        const type = mime[fileExtname] || "text/plain";
        const charset = "utf8";
  
        const lastModified = stats.mtimeMs;
        const eTag = this.etag(stats);
  
        // conditional request
        if (
          req.headers["if-none-match"] === eTag
          ||
          (
            req.headers["last-modified"] &&
            Number(req.headers["last-modified"]) > lastModified
          )
        ) {
          return res.writeHead(304).end("Not Modified", resolve);
        }
  
        const headers = {
          "Content-Type": `${type}${charset ? "; charset=".concat(charset) : ""}`,
          "Last-Modified": lastModified,
          "ETag": eTag,
          "Accept-Ranges": "bytes",
          "Content-Security-Policy": this.routeThrough(
            filepath,
            this.fileResHeadersRouter.CSP
          ),
          "Cache-Control": this.routeThrough(
            fileExtname,
            this.fileResHeadersRouter.cacheControl
          ) || "private, max-age=864000" // 10 days
        };
  
        if (isDownload) {
          headers["Content-Disposition"]
            = `attachment; filename="${encodeURIComponent(filename)}"`
            ;
        }
  
        if (stats.size === 0)
          return res.writeHead(204, "Empty file", headers).end(resolve);
  
        let _start_ = 0, _end_ = stats.size - 1;
        if (req.headers["range"]) {
          const range = req.headers["range"];
          let { 0: start, 1: end } = (
            range.replace(/^bytes=/, "")
              .split("-")
              .map(n => parseInt(n, 10))
          );
          end = isNaN(end) ? stats.size - 1 : end;
          start = isNaN(start) ? stats.size - end - 1 : start;
  
          if (!isInRange(-1, start, end, stats.size)) {
            headers["Content-Range"] = `bytes */${stats.size}`;
            return res.writeHead(416, headers).end(resolve);
          }
  
          res.writeHead(206, {
            ...headers,
            "Content-Range": `bytes ${start}-${end}/${stats.size}`,
            "Content-Length": String(end - start + 1),
          });
  
          /**
           * Range: bytes=1024-
           * -> Content-Range: bytes 1024-2047/2048
           */
  
          /**
           * https://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
           * An example to read the last 10 bytes of a file which is 100 bytes long:
           * createReadStream('sample.txt', { start: 90, end: 99 });
           */
          _start_ = start;
          _end_ = end;
        } else {
          //   headers["Transfer-Encoding"] = "chunked";
          headers["Content-Length"] = stats.size;
          res.writeHead(200, headers);
        }
  
        if (req.method.toUpperCase() === "HEAD") {
          return res.end(resolve);
        }
  
        pipeline(
          // Number.MAX_SAFE_INTEGER is 8192 TiB
          createReadStream(filepath, { start: _start_, end: _end_ }),
          res,
          error => {
            if(error) {
              error.status = 500;
              error.expose = false;
              if(error.code === "ERR_STREAM_PREMATURE_CLOSE") {
                return reject(error.message);
              }
              return reject(error);
            }

            return resolve();
          }
        );
      });
    });
  }

  routeThrough(input, ...routers) {
    let ret = input;
  
    for (const router of routers) {
      for (const callback of router) {
        ret = callback(ret);
        if(ret === false)
          return false;
        if (ret.done) {
          ret = ret.value;
          break;
        }
        ret = ret.value || ret;
      }
    }
  
    return typeof ret === "object" ? ret.value : ret;
  }

  etag(stats) {
    return `"${stats.mtime.getTime().toString(16)}-${stats.size.toString(16)}"`;
  }
}

export { Serve, App };

function isInRange(...ranges) {
  for (let i = 0; i < ranges.length - 1; i++) {
    if (ranges[i] >= ranges[i + 1]) {
      return false;
    }
  }
  return true;
}

function proxyHeader(req, name) {
  name = name.toLowerCase();
  if(req.headers[name])
    return req.headers[name].split(",", 1)[0].trim();
  else
    return false;
}