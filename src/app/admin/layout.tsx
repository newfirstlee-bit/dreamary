import { cookies } from 'next/headers';
import Link from 'next/link';
import AdminLogin from './AdminLogin';
import LogoutButton from './LogoutButton';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const isAdmin = cookieStore.get('admin_auth')?.value === 'true';

  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100vh', backgroundColor: '#f5f5f5' }}>
        <AdminLogin />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', width: '100%', height: '100vh', backgroundColor: '#f9f9f9', overflow: 'hidden' }}>
      <aside style={{ width: '250px', backgroundColor: 'white', borderRight: '1px solid #ddd', padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--point-color)', marginBottom: '30px' }}>드리머리 어드민</h1>
        <Link href="/admin" style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'var(--gray-100)', color: 'var(--gray-800)', textDecoration: 'none', fontWeight: 'bold' }}>대시보드</Link>
        <Link href="/admin/topics" style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'var(--gray-100)', color: 'var(--gray-800)', textDecoration: 'none', fontWeight: 'bold' }}>일기 주제 관리</Link>
        <Link href="/admin/users" style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'var(--gray-100)', color: 'var(--gray-800)', textDecoration: 'none', fontWeight: 'bold' }}>사용자 로그</Link>
        <LogoutButton />
      </aside>
      <main style={{ flex: 1, padding: '40px', overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
