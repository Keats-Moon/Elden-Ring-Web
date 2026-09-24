import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/steam/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  await clearSessionCookie();
  return NextResponse.redirect(new URL('/', req.url));
}
