const fs = require('fs');
const path = require('path');

const files = [
  'src/app/chat/[id]/page.tsx',
  'src/app/admin/users/[id]/page.tsx',
  'src/app/admin/users/[id]/pair/[characterId]/page.tsx',
  'src/app/mypage/edit-pairname/[id]/page.tsx',
  'src/app/mypage/edit-character/[id]/page.tsx',
  'src/app/mypage/edit-user/[id]/page.tsx',
  'src/app/home-settings/[id]/page.tsx',
  'src/app/diary/history/[id]/page.tsx'
];

const codeToAdd = `\n\nexport function generateStaticParams() {\n  return [];\n}\n`;

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.log(`Not found: ${file}`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('generateStaticParams')) {
    fs.writeFileSync(filePath, content + codeToAdd, 'utf8');
    console.log(`Added to ${file}`);
  }
});
