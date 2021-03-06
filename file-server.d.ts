/// <reference types="node" />

import {
  RequestListener,
  Server,
  IncomingMessage,
  ServerResponse
} from "http";
import { EventEmitter } from "events";
import { ListenOptions } from "net";

import { Stats } from "fs";

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

type Next = () => Promise<void>;
type Middleware = ((ctx: Context, next: Next) => Promise<void>);

export declare class App extends EventEmitter {
  constructor();
  middlewares: Array<Middleware>;
  context: BasicContext;

  /* NOT in koa! */
  prepend(middleware: Middleware): this;

  use(middleware: Middleware): this;

  callback(): RequestListener;

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

type SubRouter<T> = Array<((input: T) => T)>;

type Router<T> = {
  [subrouter: string]: SubRouter<T>;
};

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