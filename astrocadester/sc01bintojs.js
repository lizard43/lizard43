// convert.js (Run via: node convert.js)
const fs = require('fs');

const buffer = fs.readFileSync('sc01a.bin');
// The MAME source reads it as Little-Endian 64-bit chunks
const u64Array = new BigUint64Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 8);

let output = 'const VOTRAX_ROM = [\n';
u64Array.forEach((val, i) => {
    output += `    0x${val.toString(16).padStart(16, '0')}n, // Phoneme Index ${i}\n`;
});
output += '];';

console.log(output);

