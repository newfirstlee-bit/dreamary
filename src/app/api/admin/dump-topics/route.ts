import { NextResponse } from 'next/server';
import { getTopics } from '@/lib/db';

export async function GET() {
  const topics = await getTopics();
  return NextResponse.json(topics);
}
