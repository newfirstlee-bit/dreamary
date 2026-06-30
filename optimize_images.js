const fs = require('fs');
const glob = require('glob');

const files = [
  'src/app/onboarding/page.tsx',
  'src/app/page.tsx',
  'src/app/diary/page.tsx',
  'src/app/mypage/page.tsx',
  'src/app/chat/page.tsx',
  'src/app/chat/[id]/page.tsx',
  'src/app/mypage/edit-character/[id]/page.tsx',
  'src/app/mypage/edit-user/[id]/page.tsx',
  'src/app/diary/history/[id]/page.tsx'
];

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf-8');
  
  let modified = false;
  
  if (content.includes('<img ')) {
    // Add import Image from 'next/image';
    if (!content.includes("import Image from 'next/image'")) {
      content = content.replace(/(import .*;\n)/, "$1import Image from 'next/image';\n");
    }
    
    // Replace <img src={...} ... style={{... width: '100%', height: '100%', objectFit: 'cover' ...}} />
    // with <Image src={...} ... fill style={{ objectFit: 'cover' }} />
    content = content.replace(/<img (.*?)style={{(.*?)(width:\s*'100%',\s*height:\s*'100%',\s*objectFit:\s*'cover'|width:\s*'100%',\s*height:\s*'100%')([^}]*)}}(.*?)\/>/g, (match, p1, p2, p3, p4, p5) => {
      let newStyle = p2 + "objectFit: 'cover'" + p4;
      // remove trailing comma if present easily
      return `<Image ${p1}fill style={{${newStyle}}}${p5}/>`;
    });
    // Replace objectFit inside style
    content = content.replace(/<img(.*?)>/g, (match) => {
      return match.replace('<img', '<Image fill').replace("width: '100%', height: '100%', ", "");
    });
    modified = true;
  }
  
  // Also we need to add position: 'relative' to the parent div of these Images.
  // This regex finds divs that have overflow: 'hidden' and don't have position relative, 
  // and adds position: 'relative' to them.
  content = content.replace(/(<div[^>]*style={{[^}]*)(overflow:\s*'hidden')([^}]*}})/g, (match, p1, p2, p3) => {
    if (!match.includes('position:')) {
      return `${p1}${p2}, position: 'relative'${p3}`;
    }
    return match;
  });

  if (modified) {
    fs.writeFileSync(file, content, 'utf-8');
    console.log(`Updated ${file}`);
  }
});
