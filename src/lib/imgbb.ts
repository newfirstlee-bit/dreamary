export async function uploadImageToImgbb(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('image', file);

  // You need an API key from imgbb (https://api.imgbb.com/)
  // Using a generic/temporary one if not provided in env, but it's recommended to add NEXT_PUBLIC_IMGBB_API_KEY
  const apiKey = process.env.NEXT_PUBLIC_IMGBB_API_KEY || '';
  if (!apiKey) {
    throw new Error('IMGBB API Key is missing. Please set NEXT_PUBLIC_IMGBB_API_KEY.');
  }

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Failed to upload image');
  }

  const data = await response.json();
  return data.data.url;
}
