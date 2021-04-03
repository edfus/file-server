import { readFile } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const map = new Map();

readFile(join(__dirname, "./path-map.json"), "utf8", (err, data) => {
  if(err) {
    switch (err.code) {
      case "ENOENT":
        return ;
      default:
        return complain(err.stack);
    }
  }

  let entries;
  try {
    entries = JSON.parse(data);
  } catch (err) {
    return complain(err.stack);
  }

  for (let i = 0; i < entries.length; i += 2) {
    map.set(
      format(entries[i]),
      format(entries[i + 1])
    );
  }
});

export default map;

function format (path) {
  if(!path.startsWith("/")) {
    return "/".concat(path);
  }
  return path;
}

function complain (message) {
  console.error(
    `File-server: Reading ${join(__dirname, "./path-map.json")} errored: ${message}`
  );
}