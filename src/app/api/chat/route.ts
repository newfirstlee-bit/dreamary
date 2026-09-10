import chatHandler from '../../../../netlify/functions/chat';

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return chatHandler(req);
}

export async function POST(req: Request) {
  return chatHandler(req);
}
