import diaryHandler from '../../../../netlify/functions/diary';

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return diaryHandler(req);
}

export async function POST(req: Request) {
  return diaryHandler(req);
}
