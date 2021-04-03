import { deepStrictEqual } from "assert";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

class EncryptedJSON {
  encryptedIdentifier = Buffer.from("---ENCRYPTED---\n");

  set (obj, password) {
    const iv = randomBytes(16);

    const key = createHash('sha1').update(password).digest().slice(0, 16);
    const cipher = createCipheriv("aes-128-gcm", key, iv);

    return {
      id: this.encryptedIdentifier,
      iv: iv,
      key: key,
      body: Buffer.concat([
        cipher.update(Buffer.from(JSON.stringify(obj))),
        cipher.final()
      ]),
      tag: cipher.getAuthTag().slice(0, 12)
    }
  }

  get (rawChunk, password, debugObj) {
    if(
      Buffer.compare(
        rawChunk.slice(0, this.encryptedIdentifier.length),
        this.encryptedIdentifier
      ) === 0
    ) {
      let offset = this.encryptedIdentifier.length;
      const iv = rawChunk.slice(offset, offset += 16);
      const tag = rawChunk.slice(offset, offset += 12);
      const encrypted = rawChunk.slice(offset);
      const key = createHash('sha1').update(password).digest().slice(0, 16);

      deepStrictEqual(debugObj.iv, iv);
      deepStrictEqual(debugObj.body, encrypted);
      deepStrictEqual(debugObj.key, key);

      const decipher = createDecipheriv("aes-128-gcm", key, iv);
      decipher.setAuthTag(tag);
      const jsonData = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]).toString("utf8");

      return JSON.parse(jsonData);
    }
  }
}

const e = new EncryptedJSON();
const obj = {
  "location": "./",
  "hostname": "localhost",
  "port": 12345,
  "logPath": "./",
  "useSelfSignedCert": true,
  "isAuthEnabled": false
};
const password = "1242534";

const result = e.set(obj, password);

deepStrictEqual(
  e.get(
    Buffer.concat([
      result.id,
      result.iv,
      result.tag,
      result.body
    ]),
    password,
    result
  ),
  obj
);

console.info("Valid")