import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Only apply to admin routes
  if (request.nextUrl.pathname.startsWith('/admin') || request.nextUrl.pathname.startsWith('/api/admin')) {
    // Get client IP address (handles Vercel/Netlify proxy headers)
    const ip = request.ip || request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip');
    
    // Allowed IPs
    const allowedIps = ['175.193.50.137'];
    
    // Allow localhost during local development
    const isDev = process.env.NODE_ENV === 'development';
    
    if (isDev && (!ip || ip === '::1' || ip === '127.0.0.1')) {
      return NextResponse.next();
    }

    // Check if current IP is in allowed list
    let clientIp = ip ? ip.split(',')[0].trim() : '';
    
    if (!clientIp || !allowedIps.includes(clientIp)) {
      // If IP is not allowed, return 403 Forbidden
      return new NextResponse(`Forbidden: Access denied for IP: ${clientIp || 'Unknown'}`, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
