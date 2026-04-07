const fs = require('fs');
const content = fs.readFileSync('D:\\dev-led\\AscTome\\asc-tracker\\src\\ascendant.css', 'utf8');
const decoded = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
fs.writeFileSync('D:\\dev-led\\AscTome\\asc-tracker\\src\\ascendant-decoded.css', decoded);
console.log('Done');