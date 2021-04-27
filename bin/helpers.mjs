import { inspect } from "util";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createWriteStream, existsSync, promises as fsp } from "fs";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const local = path => join(__dirname, path);

class JSONCache {
  encryptedIdentifier = Buffer.from("---ENCRYPTED---\n");

  constructor (path) {
    this.path = path;
  }

  set (cachename, obj) {
    const cache = createWriteStream(join(this.path, cachename));
  
    if(obj.password) {
      randomBytes(16, (err, iv) => {
        if(err) return console.error(err);
        const key = createHash("sha1").update(obj.password).digest().slice(0, 16);
        const cipher = createCipheriv("aes-128-gcm", key, iv);

        const body = Buffer.concat([
          cipher.update(Buffer.from(JSON.stringify(obj))),
          cipher.final()
        ]);

        cache.end(Buffer.concat([
          this.encryptedIdentifier,
          iv,
          cipher.getAuthTag().slice(0, 16),
          body
        ]));
      });
    } else {
      cache.end(JSON.stringify(obj));
    }
  }

  has (cachename) {
    return existsSync(join(this.path, cachename));
  }

  async get (cachename, passwordCallback) {
    if(!this.has(cachename))
      return false;

    const rawData = await fsp.readFile(join(this.path, cachename));
    const mightbeId = rawData.slice(0, this.encryptedIdentifier.length);

    if (Buffer.compare(mightbeId, this.encryptedIdentifier) === 0) {
      let offset = this.encryptedIdentifier.length;

      const iv = rawData.slice(offset, offset += 16);
      const tag = rawData.slice(offset, offset += 16);
      const encrypted = rawData.slice(offset);

      const password = await passwordCallback();
      if(!password || !password.length) 
        return false;

      const key = createHash("sha1").update(password).digest().slice(0, 16);
      const decipher = createDecipheriv("aes-128-gcm", key, iv).setAuthTag(tag);

      const jsonData = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]).toString("utf8");

      return JSON.parse(jsonData);
    } else {
      return rawData.length ? JSON.parse(rawData) : {};
    }
  }
}

class Log {
  constructor (outputDir) {
    this.outputDir = outputDir || "./";
  }
  critical(entry, silent) {
    if(!this._critical)
      this._critical = createWriteStream(join(this.outputDir, "./critical.log"), { flags: "a" });
    !silent && console.error(entry);
    this._critical.write(
      String(entry).concat("\n")
    );
  }
  
  access(info) {
    if(!this._info)
      this._info = createWriteStream(join(this.outputDir, "./access.log"), { flags: "a" });
    console.info(info);
    this._info.write(
      info.concat("\n")
    );
  }

  error(err, req) {
    if(!this._error)
      this._error = createWriteStream(join(this.outputDir, "./error.log"), { flags: "a" });
    this._error.write(
      [
        req && req.url,
        req && inspect(req.headers),
        inspect(err)
      ].join("\n").concat("\n\n")
    );
    console.error(err);
  }
}

/**
 * export
 */

export { JSONCache, Log, local, __dirname };

export const removableValidations = ["location", "cert", "key"];
let passwd_tmp;
export const questions = [
  {
    type: "text",
    name: "location",
    initial: "./",
    message: "Enter the root folder for serving files",
    validate (path) {
      if(existsSync(path)) {
        return true;
      } else {
        return `${path} DO NOT exist`;
      }
    }
  },
  {
    type: "text",
    name: "hostname",
    initial: "localhost",
    message: "Enter the hostname"
  },
  {
    type: "number",
    name: "port",
    initial: 12345,
    min: 0,
    max: 65565,
    message: "Enter the port to be listened"
  },
  {
    type: "toggle",
    name: "disableFileLog",
    initial: false,
    active: "No",
    inactive: "Yes",
    message: "Enable file-logging?"
  },
  {
    type: disableFileLog => !disableFileLog && "text",
    name: "logPath",
    initial: "./",
    message: "Enter the output folder of logs"
  },
  {
    type: "toggle",
    name: "notTLS",
    message: "HTTP or HTTPS?",
    initial: true, // HTTP
    active: "HTTP",
    inactive: "HTTPS"
  },
  {
    type: notTLS => !notTLS && "toggle",
    name: "useSelfSignedCert",
    message: "Use localhost certificate? (self signed)",
    initial: true,
    active: "Yes",
    inactive: "No"
  },
  {
    type: prev => prev !== true && "text",
    name: "cert",
    message: "Enter the certificate path",
    validate (path) {
      if(existsSync(path)) {
        return true;
      } else {
        return `${path} DO NOT exist`;
      }
    },
    initial: "./server.crt"
  },
  {
    type: prev => prev !== true && "text",
    name: "key",
    message: "Enter the private key path",
    validate (path) {
      if(existsSync(path)) {
        return true;
      } else {
        return `${path} DO NOT exist`;
      }
    },
    initial: "./server.key"
  },
  {
    type: "toggle",
    name: "isAuthEnabled",
    message: "Enable authorization?",
    initial: true,
    active: "Yes",
    inactive: "No"
  },
  {
    type: prev => prev && "text",
    name: "username",
    message: "Username"
  },
  {
    type: prev => prev && "password",
    name: "password",
    message: "Password",
    validate: function stashPassword (passwd) {
      passwd_tmp = passwd;
      return true;
    }
  },
  {
    type: prev => prev && "password",
    name: "comfirmed_password",
    validate (value) {
      if(this.initial && value === this.initial)
        return true;
      if(value === passwd_tmp)
        return true;
      return "Passwords don't match (Ctrl + C for an abortion)";
    },
    message: "Confirm password"
  },
  {
    type: prev => prev !== false && "multiselect",
    name: "auth",
    message: "Restricted realms where login is required",
    hint: true,
    choices: [
      { title: "Upload files", value: "action=upload" },
      { title: "Browse files in folder", value: "action=(list|get-list)" },
      { title: "All", value: ".*" }
    ]
  }
];