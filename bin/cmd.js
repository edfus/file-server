#!/usr/bin/env node

import { existsSync, promises as fsp } from "fs";
import { createServer as https_server } from "https";
import { createServer as http_server } from "http";
import { createServer as net_server } from "net";

import { App, Serve } from "../file-server.js";
import { JSONCache, Log, questions, local } from "./helpers.js";

import prompts from "prompts";
const { prompt } = prompts;
/**
 * 
 * main
 * 
 */

(async () => {
  const app = new App();
  const cache = new JSONCache();

  /**
   * user input
   */
  let requirements;
  try {
    requirements = await cache.get(
      "requirements",
      () => prompt({ // get password callback
        type: 'password',
        name: 'password',
        message: 'To recall your previous configuration, enter the password'
      }).then(({ password }) => password)
    );
  } catch (err) {
    console.info("Cache file corrupted. ", err);
  }

  let shouldPrompt = true;

  if(process.argv[2]) {
    const location = process.argv[2];
    if(existsSync(location)) {
      shouldPrompt = false;
      if(typeof requirements === "object") {
        requirements.location = location;
      } else {
        requirements = { location };
      }
    } else {
      console.error(`${process.argv[2]} DO NOT exist`);
    }
  }

  if(typeof requirements === "object") {
    if(shouldPrompt) {
      const { usePrevious } = !(await prompt({
        type: 'toggle',
        name: 'usePrevious',
        message: 'Use previous configuration?',
        initial: true,
        active: 'Yes',
        inactive: 'No'
      }));

      if(!usePrevious)
        requirements = {};

      shouldPrompt = !usePrevious;
    }

    // set initial value from remembered config
    questions.forEach(q => 
      q.name in requirements
      ? q.initial = requirements[q.name]
      : void 0
    );
    
    // set initial value for multiselect autocompleteMultiselect
    questions.forEach(q => 
      Array.isArray(q.choices)
        ? Array.isArray(q.initial) && q.initial.forEach(
          value => 
            q.choices.forEach(
              choice =>
                choice.value === value && (choice.selected = true)
            )
        )
        : void 0
    );
  }

  if(shouldPrompt) {
    requirements = {
      ...typeof requirements === "object" ? requirements : {},
      ...await prompt(questions)
    };

    if(Object.keys(requirements).length > 5)
      cache.set("requirements", requirements);
  }

  /**
   * add middlewares
   */
  if (requirements.auth?.length) {
    requirements.auth = requirements.auth.map(
      ruleStr => new RegExp(ruleStr, "i")
    );

    const basicAuth = Buffer.from(
      `${requirements.username}:${requirements.password}`
    ).toString("base64");

    app.use(
      (ctx, next) => {
        const { req, res, state } = ctx;

        if (requirements.auth.some(rule => rule.test(state.pathname))) {
          const authorization = req.headers["authorization"];

          if (!authorization) {
            return res.writeHead(401, {
              "WWW-Authenticate": `Basic realm="restricted"`,
              "Content-Length": 0
            }).end();
          }

          if (authorization !== `Basic ${basicAuth}`) {
            return res.writeHead(401, {
              "WWW-Authenticate": `Basic realm="restricted"`
            }).end("Wrong username or password");
          }
        }

        return next();
      }
    );
  }

  const services = new Serve().mount(requirements.location);
  for (const service of services) app.use(service);

  /**
   * create servers
   */
  const servers = {};
  let protocol = requirements.notTLS !== false ? "http:" : "https:";

  if(!requirements.useSelfSignedCert) {
    if(!requirements.key || !requirements.cert) {
      if(!["localhost", "127.0.0.1", undefined].includes(requirements.hostname)) {
        console.error("Self signed certificate is valid only for hostnames ['localhost', '127.0.0.1']");
        protocol = "http:";
      }
    }
  }

  const port = requirements.port || 0;
  const hostname = requirements.hostname || "localhost";
  const requestListener = app.callback(
    `${hostname}${port ? ":".concat(port) : ""}`, protocol
  );

  if(protocol === "https:") {
    const keyPromise = fsp.readFile(requirements.key || local("./dev/server.key"));
    const certPromise = fsp.readFile(requirements.cert || local("./dev/server.crt"));
  
    servers.https = https_server(
      { key: await keyPromise, cert: await certPromise },
      requestListener
    );

    servers.http = http_server((req, res) =>
      res.writeHead(308, {
        "Location": `https://${req.headers.host}${req.url}`
      }).end()
    );

    servers.main = net_server(socket => 
      socket.once("data", chunk => {
        socket.pause().unshift(chunk);

        servers[chunk[0] === 22 ? "https" : "http"]
          .emit("connection", socket);

        process.nextTick(() => socket.resume());
      })
    );
  } else {
    servers.main = http_server(requestListener);
  }

  servers.main.listen(
    port,
    hostname,
    function () {
      console.info(
        `File server is running at ${protocol}//${getServerAddress(this)}`
      );
    }
  );

  /**
   * log & process
   */
  const logPath = requirements.logPath || "./log";
  await (!existsSync(logPath) && fsp.mkdir(logPath));
  const logger = new Log(logPath);

  app
    .prepend(
      async (ctx, next) => {
        await next();
        logger.access([
          new Date().toLocaleString(),
          `${ctx.ip} ${ctx.req.method} ${ctx.req.url}`,
          ctx.res.statusCode
        ].join(" - "));
      }
    )
    .on("error", logger.error.bind(logger))
  ;

  Object.values(servers).forEach(server => server.on("error", logger.critical.bind(logger)));
  
  const sockets = new Set();

  servers.main.on("connection", socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const shutdown = () => {
    console.info("Shutting down...");
    Object.values(servers).forEach(server => server.close());
    for (const socket of sockets.values()) {
      socket.destroy();
    }
    process.exitCode = 0;
    setTimeout(() => process.exit(0), 1000).unref(); //
  };

  process.on("SIGINT", shutdown);
  process.on("SIGQUIT", shutdown);

  process.on('uncaughtExceptionMonitor', err => {
    logger.critical("There was an uncaught error\n".concat(err.stack, true));
  });
})();

function getServerAddress(server) {
  const address = server.address();
  return (
    address.family === "IPv6"
    ? `[${address.address}]:${address.port}`
    : `${address.address}:${address.port}`
  );
}