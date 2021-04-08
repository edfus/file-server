# file-server

**A LAN server with auth, upload and multithreaded download**

---

<img src="https://raw.github.com/edfus/file-server/master/img/terminal.gif">

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

- `--config config_path`: The path to your preferred config location for retriving/creating/updating settings.
- `folder_name`: The first unpaired, non-option command line argument will be treated as the `folder_name`, if exists.

Specifying `folder_name` will skip the prompts, serve what you want directly using previous config (or config you provided via `--config`)

Example:
```bash
npx @edfus/file-server /var/www/localhost/ --config /var/www/docker_volume/config 
npx @edfus/file-server --config ./configs/$(LANG=en_us_88591; date "+%B").cache ./

npm run serve -- --config localconfig
```

## Env Settings

See files in folder [./env/](https://github.com/edfus/file-server/tree/master/env) for behaviors that you can customize.

## API

A quick start snippet:

```js

import { App, Serve } from "@edfus/file-server";

const app = new App();
const services = new Serve().mount("./");
for (const service of services) app.use(service);

// simply sugar for http.createServer(app.callback()).listen();
app.listen(0, "localhost", function () {
  console.info(`File server is running at http://localhost:${this.address().port}`);
});

app.on("error", console.error);
```

This package has two named exports:

### `App`

Class `App` is a minimal implementation of [Koa](https://koajs.com/).

Following properties are available in ctx for middlewares:

```ts
/**
 * The prototype from which ctx is created.
 * You may add additional properties to ctx by editing App#context
 */
type BasicContext = {
  app: App,
  /* parameter `properties` not supported */
  throw (status?: number, message?: string): void;
  /* parameter `properties` not supported */
  assert (shouldBeTruthy: any, status?: number, message?: string): void;
}

type Context = BasicContext & {
  req: IncomingMessage, 
  res: ServerResponse,
  state: {
    pathname: string,
    uriObject: URL
  },
  url: string,
  secure: boolean,
  ip: string
}
```

See <https://github.com/edfus/file-server/master/file-server.d.ts> for more details.

### `Serve`

class `Serve` is the core of this package, highly decoupled.

```ts
class Serve {
  constructor();
  implementedMethods: ["GET", "PUT", "HEAD"];

  /**
   * sugar for
   * MUST this.implementedMethods.includes(ctx.req.method)
   * 
   * ROUTER
   * if (ctx.state.pathname === "/api") {
   *   switch (ctx.state.uriObject.searchParams.get("action")) {
   *     case "list":
   *     case "get-list": return this.getList(ctx);
   *     case "upload": return this.uploadFile(ctx);
   *   }
   * }
   * 
   * ROUTER
   * this.serveFile(ctx);
   */
  [Symbol.iterator] (): IterableIterator<Middleware>;

  /**
   * will send stringified JSON {
   *  { type: "file", value: "xxx" },
   *  { type: "folder", value: "xxx" }
   * }
   */
  getList (ctx: Context): Promise<void>;
  uploadFile (ctx: Context): Promise<void>;
  serveFile (ctx: Context): Promise<void>;

  /**
   * sugar for
   * this.pathnameRouter.dir.push(pathname => join(directory, normalize(pathname)));
   * 
   * this.pathnameRouter.file.push(pathname => join(directory, normalize(pathname)));
   */
  mount(directory: string): this

  pathnameRouter: object;
  fileResHeadersRouter: object;
  routeThrough<T>(input: T, ...routers: Array<((input: T) => T)>): T;

  etag (stats: Stats): string;
  listCache: Map<string, object>;
  mimeCache: Map<string, string>;
}
```

Serve#pathnameRouter is where you can customize the routing logic:

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
      pathname => pathname.endsWith("/") ? pathname.concat("index.html") : pathname,
      pathname => {
        if (/\/index.html?$/.test(pathname))
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
```

## Notes

./lib/stream-saver is a modified version of [StreamSaver.js](https://github.com/jimmywarting/StreamSaver.js), only browsers compatible with [Transferable Streams](https://github.com/whatwg/streams/blob/main/transferable-streams-explainer.md) are supported and a valid SSL certificate is required for service worker registration when serving via https (http is ok, though)

Strict [CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) rules is applied for $indexHTML. Delete lines in `Serve#fileResHeadersRouter.CSP` if needed.

App#callback trust `proxy set headers` by default (e.g. X-Forwarded-Host, X-Forwarded-For)

HTTP/2 is not supported.