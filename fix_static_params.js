const fs = require('fs');
const path = require('path');

const files = [
  { dir: 'src/app/chat/[id]', params: "[{ id: '1' }]" },
  { dir: 'src/app/admin/users/[id]', params: "[{ id: '1' }]" },
  { dir: 'src/app/admin/users/[id]/pair/[characterId]', params: "[{ id: '1', characterId: '1' }]" },
  { dir: 'src/app/mypage/edit-pairname/[id]', params: "[{ id: '1' }]" },
  { dir: 'src/app/mypage/edit-character/[id]', params: "[{ id: '1' }]" },
  { dir: 'src/app/mypage/edit-user/[id]', params: "[{ id: '1' }]" },
  { dir: 'src/app/home-settings/[id]', params: "[{ id: '1' }]" },
  { dir: 'src/app/diary/history/[id]', params: "[{ id: '1' }]" }
];

files.forEach(({ dir, params }) => {
  const layoutPath = path.join(__dirname, dir, 'layout.tsx');
  if (fs.existsSync(layoutPath)) {
    const layoutCode = `export function generateStaticParams() {\n  return ${params};\n}\n\nexport default function Layout({ children }: { children: React.ReactNode }) {\n  return <>{children}</>;\n}\n`;
    fs.writeFileSync(layoutPath, layoutCode, 'utf8');
    console.log(`Updated ${layoutPath}`);
  }
});
