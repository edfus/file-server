# File-server

[![npm](https://img.shields.io/npm/v/@edfus/file-server?logo=npm)](https://www.npmjs.com/package/@edfus/file-server)
[![install size](https://packagephobia.com/badge?p=@edfus/file-server)](https://packagephobia.com/result?p=@edfus/file-server)
[![dependencies Status](https://status.david-dm.org/gh/edfus/file-server.svg)](https://david-dm.org/edfus/file-server)


A LAN server with auth, upload and multithreaded download

<img src="https://raw.github.com/edfus/file-server/master/img/terminal.gif">

---

This package is developed as an easy and quick mean to share files across my LAN with some more abilities like authorization / client upload / client range request.

## Features

- User-friendly interactive prompts powered by [prompts](https://github.com/terkelg/prompts#-prompts)
- Multithreaded download based on [StreamSaver.js](https://github.com/jimmywarting/StreamSaver.js)
- Composing router logic & cascading middlewares in [Koa](https://koajs.com/) style
- HTTPS & HTTP over the same port

## CMD Usage

The one-line way:
```bash
npx @edfus/file-server
```

Alternatively, you can install this package either globally or locally
```bash
npm install @edfus/file-server -g
```

```bash
npm install @edfus/file-server
cd node_modules/@edfus/file-server
```

```bash
git clone --depth 1 https://github.com/edfus/file-server 
cd file-server
npm install
```

And then run:
```bash
# global
serve 
# local
npm run serve
```

Available command-line options:

- `--config [config_path]`: The path to your preferred config location for retriving/creating/updating settings.
- `--password [passwd]`: The optional password for encrypting and decrypting config file. Password set by the authorization prompt takes priority over this.
- `--no-prompt`: Skip the prompts, use possible or default settings.
- `--no-validate`: Do not check validity of pathnames.
- `--no-log-files`: Do not dump access/error/critical logs to fs.
- `--no-fallback`: Exits immediately when any misconfiguration is found.
- `<folder_name>`: The first unpaired, non-option command line argument will be treated as the `<folder_name>`, if exists. Specifying `<folder_name>` will skip the prompts, serve what you want directly using possible or default settings.

When a encrypted config is encountered, a `To recall your previous configuration, enter the password` prompt will always jump out regardless of the `"will-skip-prompts"` options being set or not. Specify `--password passwd` explicitly in this case.

Examples:
```bash
serve .

npx @edfus/file-server /var/www/localhost/ --config /var/www/docker_volume/config 
serve --config /var/www/docker_volume/config --password K3qUrFS+h@G --no-prompt
npm run serve -- --no-prompt
```

Alias:
- `-c`: `--config [config_path]`
- `-p`: `--password [passwd]`
- `-h`: `--help`
- `-n`: `--no-prompt`
- `-l`, `--loose`: `--no-validate`
- `-e`, `--set-e`: `--no-fallback`

## Env Settings

See files in folder [./env/](https://github.com/edfus/file-server/tree/master/env) for behaviors that you can customize.

## API

Some quick start snippets:

```js
import { App, Serve } from "@edfus/file-server";

const app = new App();
const services = new Serve().mount("./");

for (const service of services)
  app.use(service);

// simply sugar for http.createServer(app.callback()).listen();
app.listen(0, "localhost", function () {
  console.info(`File server is running at http://localhost:${this.address().port}`);
});
```

```js
import { App, Serve } from "@edfus/file-server";

const app = new App();

app.prepend(
  async (ctx, next) => {
    await next();
    
    console.info(
      new Date().toLocaleString(),
      ctx.ip,
      ctx.req.method,
      ctx.url,
      ctx.res.statusCode
    );
  }
);

app.use(new Serve().mount("./doc").serveFile).listen(
  8080, "localhost", function () {
    console.info(`File server is running at http://localhost:${this.address().port}`);
  }
);
```

---

This package has two named exports:

### `App`

Class `App` is a minimal implementation of [Koa](https://koajs.com/).

Following properties are available in ctx for middlewares:

```ts
/**
 * the prototype from which ctx is created.
 * You may add additional properties to ctx by editing app.context
 */
interface BasicContext {
  app: App;
  /* parameter `properties` not supported */
  throw(status?: number, message?: string): void;
  /* parameter `properties` not supported */
  assert(shouldBeTruthy: any, status?: number, message?: string): void;
}

interface Context extends BasicContext {
  req: IncomingMessage;
  res: ServerResponse;
  state: {
    pathname: string;
    uriObject: URL;
  };
  url: string;
  secure: boolean;
  ip: string;
}
```

See <https://github.com/edfus/file-server/blob/master/file-server.d.ts> for more details.

### `Serve`

Class `Serve` is the core of this package, highly decoupled.

```ts
class Serve {
  constructor();
  implementedMethods: ["GET", "PUT", "HEAD"];

  /**
   * sugar for
   * this.implementedMethods.includes(ctx.req.method)
   * 
   * if (ctx.state.pathname === "/api") {
   *   switch (ctx.state.uriObject.searchParams.get("action")) {
   *     case "list":
   *     case "get-list": return this.getList(ctx);
   *     case "upload": return this.uploadFile(ctx);
   *   }
   * }
   * 
   * this.serveFile
   */
  [Symbol.iterator](): IterableIterator<Middleware>;

  _getList(ctx: Context): Promise<void>;
  _uploadFile(ctx: Context): Promise<void>;
  _serveFile(ctx: Context): Promise<void>;

  /**
   * sugar for _getList with correct `this` reference
   */
  getList(ctx: Context): Promise<void>;

  /**
   * sugar for _uploadFile with correct `this` reference
   */
  uploadFile(ctx: Context): Promise<void>;

  /**
   * _serveFile with correct `this` reference.
   * Will silence errors with status 404
   */
  serveFile(ctx: Context): Promise<void>;

  /**
   * sugar for
   * this.pathnameRouter.dir.push(pathname => join(directory, normalize(pathname)));
   * 
   * this.pathnameRouter.file.push(pathname => join(directory, normalize(pathname)));
   */
  mount(directory: string): this;

  pathnameRouter: Router<string>;
  fileResHeadersRouter: Router<string>;
  routeThrough<T>(input: T, ...routers: SubRouter<T>): T;

  etag(stats: Stats): string;
  listCache: Map<string, object>;
  mimeCache: Map<string, string>;
}
```

Serve#pathnameRouter is where you can customize routing logic. By default, following actions are used.

```js
  pathnameRouter = {
    map: [
      pathname => pathMap.has(pathname) ? pathMap.get(pathname) : pathname,
    ],
    filter: [
      // hide all files starting with . in their names
      pathname => basename(pathname).startsWith(".") ? false : pathname
    ],
    fs: [
      pathname => pathname.replace(/<|>|:|"|\||\?|\*/g, "-")
    ],
    file: [
      pathname => pathname.endsWith("/") ? pathname.concat("index.html") : pathname
    ],
    dir: [
      pathname => pathname.endsWith("/") ? pathname : pathname.concat("/")
    ]
  };
```

## Notes

[./lib/stream-saver](https://github.com/edfus/file-server/tree/master/lib/stream-saver) is a modified version of [StreamSaver.js](https://github.com/jimmywarting/StreamSaver.js), only browsers compatible with [Transferable Streams](https://github.com/whatwg/streams/blob/main/transferable-streams-explainer.md) are supported and a valid SSL certificate is required for service worker registration when serving via https (http is ok, though)

Strict [CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) rules is applied for `$indexHTML`. Delete lines in `Serve#fileResHeadersRouter.CSP` in `./bin/cmd.js` if needed.

App#callback trust `proxy set headers` by default (e.g. X-Forwarded-Host, X-Forwarded-For)

HTTP/2 is not supported.