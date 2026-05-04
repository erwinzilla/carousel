const axios = require("axios");
const fs = require("fs");

async function downloadFile(url, path) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    headers: {
        'X-APP-KEY': '3501-mantap'
    }
  });
  fs.writeFileSync(path, res.data);
}

module.exports = { downloadFile };
