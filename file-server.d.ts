/// <reference types="node" />

import { 
  RequestListener,
  Server,
  IncomingMessage,
  ServerResponse
} from "http";

import { ListenOptions } from "net";

import { Stats } from "fs";

/**
 * the prototype from which ctx is created.
 * You may add additional properties to ctx by editing app.context
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

type Next = () => void;
type Middleware = ((ctx: Context, next: Next) => Promise<void>)

export declare class App {
  constructor();
  middlewares: Array<Middleware>;
  context: BasicContext;

  /* NOT in koa! */
  prepend (middleware: Middleware): this

  use (middleware: Middleware): this

  callback (): RequestListener

  /**
   * a copypasta from net.d.ts
   */
  listen(port?: number, hostname?: string, backlog?: number, listeningListener?: () => void): Server;
  listen(port?: number, hostname?: string, listeningListener?: () => void): Server;
  listen(port?: number, backlog?: number, listeningListener?: () => void): Server;
  listen(port?: number, listeningListener?: () => void): Server;
  listen(path: string, backlog?: number, listeningListener?: () => void): Server;
  listen(path: string, listeningListener?: () => void): Server;
  listen(options: ListenOptions, listeningListener?: () => void): Server;
  listen(handle: any, backlog?: number, listeningListener?: () => void): Server;
  listen(handle: any, listeningListener?: () => void): Server;
}

export declare class Serve {
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
   * this.serveFile(ctx);
   */
  [Symbol.iterator] (): IterableIterator<Middleware>;

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