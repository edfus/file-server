import { stat, createWriteStream, createReadStream, readdir, existsSync } from "fs";
import { extname, basename, join, normalize, dirname } from "path";
import { pipeline } from "stream";
import mime from "./env/mime.js";
import pathMap from "./env/path-map.js";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const local = (...paths) => join(__dirname, ...paths.map(p => normalize(p)));

class App {
  middlewares = [];

  prepend (middleware) {
    this.middlewares.unshift(middleware);
    return this;
  }

  use (middleware) {
    this.middlewares.push(middleware);
    return this;
  }

  callback (host, protocol) {
    return async (req, res) => {
      const uriObject = new URL(req.url, `${protocol}//${req.headers.host || host}`);
      const ctx = {
        app: this,
        req, res,
        state: {
          pathname: "",
          uriObject: uriObject
        },
        throw (status, message) {
  
        },
        assert (shouldBeTruthy, status, message) {
  
        },
        url: uriObject.toString(),
        ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress
      }

      let index = 0
      const next = async () => {
        if(index >= this.middlewares.length)
          return ;
        return this.middlewares[index++](ctx, next);
      };

      try {
        await next();
      } catch (err) {
        res.writeHead(500, err.message);
      } finally {
        if(!res.headersSent)
          res.writeHead(204, "No Content", {
            "Cache-Control": "no-cache",
            "Connection": "close"
          });
        if(!res.writableEnded)
          res.end();
        req.resume();
      }
    }
  }
}


class Serve {
  implementedMethods = ["GET", "PUT", "HEAD"];
  listCache = new Map();
  mimeCache = new Map();

  commonRouter = [
    pathname => decodeURIComponent(pathname).replace(/\+/g, " "),
    pathname => pathMap.has(pathname) ? pathMap.get(pathname) : pathname,
  ];

  fsRouter = [
    pathname => pathname.replace(/<|>|:|"|\||\?|\*/g, "-")
  ];

  fileRouter = [
    pathname => pathname.endsWith("/") ? pathname.concat("index.html") : pathname,
    pathname => {
      if (/\/index.html?$/.test(pathname))
        return {
          done: true,
          value: local("./src/index.html")
        };
      return pathname;
    },
    pathname => {
      if (/^\/stream-saver\//.test(pathname))
        return {
          done: true,
          value: local("./lib/", pathname)
        };
      return { done: false, value: pathname };
    }
  ];

  dirRouter = [
    pathname => pathname.endsWith("/") ? pathname : pathname.concat("/")
  ];

  _reqHandlers = [];

  constructor({
    key, cert,
    logger = {
      error: console.error,
      info: console.info,
      critical: err => console.error(new Error(err))
    }
  } = {}) {
    this.logger = logger;
  }

  default(directory) {
    this.prependListener(
      (url, req, res) => {
        if (!this.implementedMethods.includes(req.method.toUpperCase())) {
          res.writeHead(501).end();
          return true;
        }
      }
    );

    this.addListener(
      (url, req, res) => {
        if (url.pathname === "/api")
          return this.getList(url, req, res);
      }
    );

    this.addListener(
      (url, req, res) => {
        if (url.pathname === "/upload")
          return this.uploadFile(url, req, res);
      }
    );

    this.fileRouter.push(pathname => join(directory, normalize(pathname)));
    this.dirRouter.push(pathname => join(directory, normalize(pathname)));

    return this.addListener(this.serveFile.bind(this));
  }

  listen(port, hostname, cb) {
    this.tcp.ref();
    this.http.ref();
    this.https.ref();
    this.tcp.listen(port, hostname, cb);
    return this;
  }

  prependListener(func) {
    this._reqHandlers.unshift(func);
    return this;
  }

  addListener(func) {
    this._reqHandlers.push(func);
    return this;
  }

  getList(url, req, res) {
    if (req.method.toUpperCase() !== "GET") {
      res.writeHead(405).end("Expected Method GET");
      return true;
    }

    const dirToList = url.searchParams.get("l") || url.searchParams.get("list");

    if (dirToList) {
      const dirpath = getRoute(dirToList, this.commonRouter, this.fsRouter, this.dirRouter);

      if (this.listCache.has(dirpath)) {
        const cached = this.listCache.get(dirpath);
        if (Date.now() - cached.createdAt > cached.maxAge) {
          this.listCache.delete(dirpath);
        } else {
          res.writeHead(200, { "Content-Type": "application/json" }).end(cached.value);
          return true;
        }
      }

      readdir(dirpath, { withFileTypes: true }, (err, files) => {
        if (err) {
          this.logger.error(err, req);
          switch (err.code) {
            case "ENAMETOOLONG":
            case "ENOENT":
            case "ENOTDIR":
              return res.writeHead(404).end("Not Found");
            default:
              return res.writeHead(500).end(err.message);
          }
        }

        const result = JSON.stringify(
          files.map(dirent => {
            if (dirent.isFile()) {
              return dirToList.concat(dirent.name);
            }
            return false; // dirent.isDirectory ...
          }).filter(s => s)
        );

        this.listCache.set(dirpath, {
          createdAt: Date.now(),
          maxAge: 10 * 1000, // 10 seconds
          value: result
        });
        this.logger.info(`Serving files list of ${dirToList} to ${req.socket.remoteAddress}:${req.socket.remotePort} succeeded`);
        return res.writeHead(200, { "Content-Type": "application/json" }).end(result);
      });

      return true;
    }
    res.writeHead(400).end("Folder path required.");
    return true;
  }

  uploadFile(url, req, res) {
    if (req.method.toUpperCase() !== "PUT") {
      return res.writeHead(405).end("Expected Method PUT");
    }

    const uploadTarget = url.searchParams.get("p") || url.searchParams.get("path");

    if (uploadTarget) {
      if (normalize(uploadTarget).replace(/[^/\\]/g, "").length > 1) {
        res.writeHead(403, "Forbidden").end("You DO NOT have the permission to create folders");
        return true;
      }

      let destination = uploadTarget;

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

      const filepath = getRoute(destination, this.fsRouter, this.fileRouter);

      if (existsSync(filepath)) {
        stat(filepath, (err, stats) => {
          if (err) {
            this.logger.error(err, req);
            return res.writeHead(500).end(err.message);
          }

          if (!stats.isFile()) {
            return res.writeHead(403, "Forbidden").end("A directory entry already exists.");
          }

          res.writeHead(200, {
            "Content-Location": destination
          }).end(`Modified ${destination}`);

          pipeline(
            req,
            createWriteStream(filepath, { flags: "w" }),
            error => error
              ? this.logger.error(error, req)
              : this.logger.info(`Modifying ${filepath} for ${req.socket.remoteAddress}:${req.socket.remotePort} succeeded`)
          );
        });
        return true;
      } else {
        res.writeHead(201, {
          "Content-Location": destination
        }).end(`Created ${destination}`);

        pipeline(
          req,
          createWriteStream(filepath, { flags: "w" }),
          error => error
            ? this.logger.error(error, req)
            : this.logger.info(`Creating ${filepath} for ${req.socket.remoteAddress}:${req.socket.remotePort} succeeded`)
        );
        return true;
      }
    }
    res.writeHead(400).end("Destination path required.");
    return true;
  }

  serveFile(url, req, res) {
    const isDownload = url.searchParams.get("d") || url.searchParams.get("download");
    const filepath = getRoute(url.pathname, this.commonRouter, this.fsRouter, this.fileRouter);

    stat(filepath, (err, stats) => {
      if (err) {
        this.logger.error(err, req);
        switch (err.code) {
          case "ENAMETOOLONG":
          case "ENOENT":
            return res.writeHead(404).end("Not Found");
          default:
            return res.writeHead(500).end(err.message);
        }
      }

      if (!stats.isFile()) {
        return res.writeHead(404).end("Not Found");
      }

      const filename = basename(filepath);
      const fileExtname = extname(filename);

      if (filename.startsWith("."))
        return res.writeHead(404).end("Not Found");

      const type = mime[fileExtname] || "text/plain";
      const charset = "utf8";

      if (type === "text/plain" && fileExtname !== ".txt") // hacky
        this.logger.critical(`!mime[${fileExtname}] for ${filename}`);

      const lastModified = stats.mtimeMs;
      const eTag = etag(stats);

      // conditional request
      if (
        req.headers["if-none-match"] === eTag
        ||
        (
          req.headers["last-modified"] &&
          Number(req.headers["last-modified"]) > lastModified
        )
      ) {
        return res.writeHead(304).end("Not Modified");
      }

      const headers = {
        "Content-Type": `${type}${charset ? "; charset=".concat(charset) : ""}`,
        "Last-Modified": lastModified,
        "ETag": eTag,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=864000" // 10 days
      };

      if (isDownload) {
        headers["Content-Disposition"]
          = `attachment; filename="${encodeURIComponent(filename)}"`
          ;
      }

      if (stats.size === 0)
        return res.writeHead(204, "Empty file", headers).end("Empty file");

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
          return res.writeHead(416, headers).end();
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
        // if (stats.size > 27799262) // roughly 25 MiB
        //   headers["Transfer-Encoding"] = "chunked";
        headers["Content-Length"] = stats.size;
        res.writeHead(200, headers);
      }

      if (req.method.toUpperCase() === "HEAD") {
        return res.end();
      }

      pipeline(
        // Number.MAX_SAFE_INTEGER is 8192 TiB
        createReadStream(filepath, { start: _start_, end: _end_ }),
        res,
        error => error
          ? this.logger.error(error, req)
          : this.logger.info(`Serving file ${filename} to ${req.socket.remoteAddress}:${req.socket.remotePort} succeeded`)
      );
    });
    return true;
  }
}

export { Serve, App };

function getRoute(pathname, ...routers) {
  let ret = pathname;

  for (const router of routers) {
    for (const callback of router) {
      ret = callback(ret);
      if (ret.done) {
        ret = ret.value;
        break;
      }
      ret = ret.value || ret;
    }
  }

  return typeof ret === "object" ? ret.value : ret;
}

function etag(stats) {
  return `"${stats.mtime.getTime().toString(16)}-${stats.size.toString(16)}"`;
}

function isInRange(...ranges) {
  for (let i = 0; i < ranges.length - 1; i++) {
    if (ranges[i] >= ranges[i + 1]) {
      return false;
    }
  }
  return true;
}