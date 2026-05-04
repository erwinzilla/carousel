const { print } = require("pdf-to-printer");

async function printFile(path) {
  await print(path, {
    printer: "HP LaserJet M402", // sesuaikan dengan nama di Windows
  });
}

module.exports = { printFile };
