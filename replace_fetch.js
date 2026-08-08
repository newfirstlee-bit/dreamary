const fs = require('fs');
const path = require('path');

const files = [
  'src/app/page.tsx',
  'src/app/onboarding/page.tsx',
  'src/app/diary/page.tsx',
  'src/app/(auth)/find-id/page.tsx',
  'src/app/(auth)/reset-password/page.tsx',
  'src/app/(auth)/register/page.tsx',
  'src/app/mypage/page.tsx',
  'src/app/admin/topics/page.tsx',
  'src/app/chat/[id]/page.tsx',
  'src/app/admin/LogoutButton.tsx',
  'src/app/admin/AdminLogin.tsx',
];

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Skip if already imported
  if (!content.includes("import { apiFetch }")) {
    content = `import { apiFetch } from '@/lib/api';\n` + content;
  }
  
  // Replace fetch('/api/
  content = content.replace(/fetch\('\/api\//g, "apiFetch('/api/");
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated ${file}`);
});
