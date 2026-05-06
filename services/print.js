const { print } = require("pdf-to-printer");

async function printFile(path) {
  await print(path, {
    printer: "\\\\DEPAN\\HP LaserJet Pro M402-M403 n-dne PCL 6", // sesuaikan dengan nama di Windows
  });

  // getPrinters().then((printers) => {
  //   console.log(printers);
  // });

  // await print(path);
}

module.exports = { printFile };
