import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { password } = await req.json();
    if (password === process.env.ADMIN_PASSWORD) {
      const res = NextResponse.json({ success: true });
      res.cookies.set('admin_auth', 'true', { path: '/', maxAge: 60 * 60 * 24 * 7, httpOnly: true });
      return res;
    }
    return NextResponse.json({ success: false, error: '비밀번호가 일치하지 않습니다.' }, { status: 401 });
  } catch (err) {
    return NextResponse.json({ success: false, error: 'Server Error' }, { status: 500 });
  }
}
