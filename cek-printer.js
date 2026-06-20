// cek-printer.js
const print = require('pdf-to-printer');

async function listPrinters() {
    try {
        const printers = await print.getPrinters();
        
        console.log('\n📋 DAFTAR PRINTER TERINSTAL:\n');
        console.log('='.repeat(50));
        
        printers.forEach((p, index) => {
            const isDefault = p.isDefault ? '⭐ DEFAULT' : '';
            console.log(`${index + 1}. ${p.name} ${isDefault}`);
            console.log(`   Status: ${p.status || 'Ready'}`);
            console.log(`   Type: ${p.type || 'Unknown'}`);
            console.log('-'.repeat(30));
        });
        
        // Cari printer default
        const defaultPrinter = printers.find(p => p.isDefault);
        if (defaultPrinter) {
            console.log(`\n✅ Printer Default: ${defaultPrinter.name}`);
        } else {
            console.log('\n⚠️ TIDAK ADA PRINTER DEFAULT!');
        }
        
        console.log(`\n📊 Total printer: ${printers.length}`);
        console.log('='.repeat(50));
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

listPrinters();