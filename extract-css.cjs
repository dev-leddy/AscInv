const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\Gaming\\.local\\share\\opencode\\tool-output\\tool_d635097650011oqIJf9R18bvIm', 'utf8');
const match = content.match(/const __vite__css = "(.*)"/s);
if (match) {
  fs.writeFileSync('D:\\dev-led\\AscTome\\asc-tracker\\src\\ascendant.css', match[1]);
  console.log('Done');
}