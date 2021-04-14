#!/usr/bin/env node

import { existsSync, promises as fsp } from "fs";
import { createServer as https_server } from "https";
import { createServer as http_server } from "http";
import { createServer as net_server } from "net";
import { basename, dirname, normalize, join } from "path";

import { App, Serve } from "../file-server.js";
import { JSONCache, Log, questions, local, __dirname, removableValidations } from "./helpers.js";

import prompts from "prompts";
const { prompt } = prompts;

const argvs = process.argv.slice(2);
/**
 * 
 * main
 * 
 */

(async () => {
  const app = new App();
  /**
   * command line options
   */
  const configpath_cli = extractArg(/^--?c(onfig)?$/, 1);
  const cachename = configpath_cli ? basename(configpath_cli) : "requirements.cache";
  const cachepath = configpath_cli ? dirname(configpath_cli) : __dirname;
  const cache = new JSONCache(cachepath);

  const password_cli = extractArg(/^--?p(assw(or)?d)?$/, 1);

  const noPrompt_cli = extractArg(/^--?n(o[-_]prompt)?$/) !== false;
  const noLogFile_cli = extractArg(/^--?no[-_]logs?([-_]files?)?$/) !== false;
  const noValidate_cli = extractArg(/^--?(no[-_]validat(e|ion)|l(oose)?)$/) !== false;

  const isHelp = extractArg(/^--?h(elp)?$/) !== false;
  
  const setErrorExit_cli = extractArg(/^--?(no[-_]fallback|e|set-e)$/) !== false;
  const onFallback = setErrorExit_cli ? hint => {
    throw new Error(hint || "An misconfiguration is encountered with --no-fallback set");
  } : () => void 0;
  
  const foldername_cli = extractArg(/^[^-]/, 0);

  if(isHelp) {
    return console.info([
      "Options:",
      "--config     [config_path]  The path to your preferred config location",
      "                            for retriving/creating/updating settings.",
      "--password   [password]     The optional password for encrypting and",
      "                            decrypting config file.",
      "Flags:",
      "--help",
      "--no-prompt     Skip the prompts, use possible or default settings.",
      "--no-validate   Do not check validity of pathnames.",
      "--no-fallback   Exits immediately when any misconfiguration is found.",
      "--no-log-files  Do not dump access/error/critical logs to fs.",
      "Shortcuts:",
      "<folder_name>   Folder to be served.",
      "Alias:",
      "-c: --config [config_path]",
      "-p: --password [passwd]",
      "-h: --help",
      "-n: --no-prompt",
      "-l, --loose: --no-validate",
      "-e, --set-e: --no-fallback"
    ].map(s => /^[A-Z]/.test(s) ? "\n".concat(s) : " ".repeat(4).concat(s)).join("\n"));
  }

  if(argvs.length) {
    console.info("Unrecognized arguments:", argvs);
    onFallback();
  }

  if(password_cli !== false && !password_cli) {
    onFallback(`Empty password ${password_cli}.`);
  }

  if(configpath_cli && !existsSync(configpath_cli)) {
    console.info(`\x1b[1m\x1b[30m${configpath_cli} doesn't exist, switching to create mode...\x1b[0m`);
    onFallback();
  }
  
  /**
   * user input
   */
  let requirements;
  try {
    requirements = await cache.get(
      cachename,
      // get password callback
      () => {
        if(password_cli !== false)
          return password_cli;
        return prompt({
          type: 'password',
          name: 'password',
          message: 'To recall your previous configuration, enter the password'
        }).then(({ password }) => password)
      }
    );
  } catch (err) {
    console.info("Config file corrupted. ", err);
    onFallback();
  }

  let shouldPrompt = !noPrompt_cli;

  if(foldername_cli) {
    const location = foldername_cli;
    if(existsSync(location)) {
      shouldPrompt = false;
      if(typeof requirements === "object") {
        requirements.location = location;
      } else {
        requirements = { location };
      }
    } else {
      throw new Error(`${foldername_cli} DOES NOT exist`);
    }
  }

  if(noValidate_cli) {
    // remove validate
    questions.forEach(q => {
      if(removableValidations.includes(q.name))
        return delete q.validate;
    });
  }

  if(typeof requirements === "object") {
    if(shouldPrompt) {
      const { usePrevious } = await prompt({
        type: 'toggle',
        name: 'usePrevious',
        message: 'Use previous configuration?',
        initial: true,
        active: 'Yes',
        inactive: 'No'
      });

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

    if(requirements.password) {
      if(requirements.comfirmed_password !== requirements.password) {
        onFallback("requirements.comfirmed_password !== requirements.password");
        requirements.password = requirements.comfirmed_password = false;
      }
    }

    if(password_cli && !requirements.password)
      requirements.password = password_cli;

    if(Object.keys(requirements).length > 4)
      cache.set(cachename, requirements);
  }

  requirements = typeof requirements === "object" ? requirements : {};

  /**
   * add middlewares
   */
  if (requirements.auth?.length) {
    const authRules = requirements.auth.map(
      ruleStr => new RegExp(ruleStr, "i")
    );

    const basicAuth = `Basic ${Buffer.from(
      `${requirements.username}:${requirements.password}`
    ).toString("base64")}`;

    app.use(
      (ctx, next) => {
        const { req, res, state } = ctx;

        if (authRules.some(rule => rule.test(state.uriObject.search))) {
          const authorization = req.headers["authorization"];

          if (!authorization) {
            return res.writeHead(401, {
              "WWW-Authenticate": `Basic realm="restricted"`,
              "Content-Length": 0
            }).end();
          }

          if (authorization !== basicAuth) {
            return res.writeHead(401, {
              // Disable browser login prompt
              // "WWW-Authenticate": `Basic realm="restricted"`
            }).end("Wrong username or password");
          }
        }

        return next();
      }
    );
  }

  const services = new Serve();

  const possibleIndexFiles = ["index.html"];
  if(possibleIndexFiles.some(f => existsSync(join(requirements.location, f)))) {
    ; // do nothing for now
  } else {
    const hash = "sha256-2LuvFWZpIobHyC7K3oXYCaPsLdxdOBQ39DQ61SP6biY=";
    const base  = join(__dirname, "..");
    const indexHTML = join(base, "./lib/www/index.html");
    const normalizedLocal = (...paths) => join(base, ...paths.map(p => normalize(p)));

    services.pathnameRouter.file.push(
      pathname => {
        if (/^\/(index.html?)?$/.test(pathname))
          return {
            done: true,
            value: indexHTML
          };
        return pathname;
      }
    );

    services.fileResHeadersRouter.CSP.unshift(
      filepath => {
        if(filepath === indexHTML)
          return {
            done: true,
            value: `object-src 'none'; script-src 'self' '${hash}' 'unsafe-inline'; require-trusted-types-for 'script';`
          }
        return filepath;
      }
    );

    services.pathnameRouter.file.push(
      pathname => {
        if (/^\/_lib_\//.test(pathname))
          return {
            done: true,
            value: normalizedLocal("./lib/", pathname.replace(/^\/_lib_\//, ""))
          };
        return { done: false, value: pathname };
      }
    );
  }

  for (const service of services.mount(requirements.location))
    app.use(service);

  /**
   * hacky
   */

  app.once("error", () => 0);

  /**
   * create servers
   */
  const servers = {};
  let protocol = requirements.notTLS !== false ? "http:" : "https:";

  if(protocol === "https:") {
    if(requirements.useSelfSignedCert || !requirements.key || !requirements.cert) {
      if(!["localhost", "127.0.0.1", undefined].includes(requirements.hostname)) {
        console.error("Self signed certificate is only valid for hostnames ['localhost', '127.0.0.1']");
        protocol = "http:";
        onFallback();
      }
    }
  }

  const port = requirements.port || 0;
  const hostname = requirements.hostname || "localhost";
  const requestListener = app.callback();

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
        `File server is running at ${protocol}//${hostname}:${this.address().port}`
      );
    }
  );

  /**
   * log & process
   */

  let logger;
  if(noLogFile_cli) {
    logger = {
      critical() {
        console.error.apply(this, arguments);
      },
      error () {
        console.error.apply(this, arguments);
      },
      access () {
        console.info.apply(this, arguments);
      }
    }
  } else {
    const logPath = requirements.logPath || "./log";
    await (!existsSync(logPath) && fsp.mkdir(logPath));
    logger = new Log(logPath);
  }

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
  };

  process.on("SIGINT", shutdown);
  process.on("SIGQUIT", shutdown);

  process.on('uncaughtExceptionMonitor', err => {
    logger.critical("There was an uncaught error\n".concat(err.stack, true));
  });
})();

function extractArg(matchPattern, offset = 0) {
  for (let i = 0; i < argvs.length; i++) {
    if (matchPattern.test(argvs[i])) {
      const matched = argvs.splice(i, offset + 1);
      return matched.length <= 2 ? matched[offset] : matched.slice(1);
    }
  }
  return false;
}