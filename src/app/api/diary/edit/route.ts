import diaryEditHandler from '../../../../../netlify/functions/diary-edit';

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return diaryEditHandler(req);
}

export async function POST(req: Request) {
  return diaryEditHandler(req);
}
