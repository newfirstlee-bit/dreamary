interface ImageCompressionOptions {
  enabled?: boolean;
  maxDimension?: number;
  quality?: number;
  minBytes?: number;
}

interface UploadImageOptions {
  signal?: AbortSignal;
  compression?: ImageCompressionOptions | false;
}

const IMAGE_VERIFY_TIMEOUT_MS = 10000;

const DEFAULT_COMPRESSION: Required<ImageCompressionOptions> = {
  enabled: true,
  maxDimension: 1920,
  quality: 0.82,
  minBytes: 700 * 1024,
};

/** Profile avatars need fewer pixels than full-screen backgrounds. GIFs retain animation. */
export function uploadProfileImageToImgbb(file: File): Promise<string> {
  return uploadImageToImgbb(file, { compression: { maxDimension: 512, quality: 0.82, minBytes: 100 * 1024 } });
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽지 못했습니다.'));
    };
    image.src = url;
  });
}

async function compressImageFile(
  file: File,
  options: ImageCompressionOptions | false | undefined
): Promise<File> {
  if (options === false || typeof window === 'undefined') return file;
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;

  const compression = { ...DEFAULT_COMPRESSION, ...(options || {}) };
  if (!compression.enabled) return file;

  try {
    const image = await loadBitmap(file);
    const width = image.width;
    const height = image.height;
    const maxSide = Math.max(width, height);

    if (maxSide <= compression.maxDimension && file.size <= compression.minBytes) {
      if ('close' in image) image.close();
      return file;
    }

    const scale = Math.min(1, compression.maxDimension / maxSide);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if ('close' in image) image.close();
      return file;
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    if ('close' in image) image.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', compression.quality);
    });

    if (!blob || blob.size >= file.size) return file;

    const compressedName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], compressedName, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch (error) {
    console.warn('Image compression skipped:', error);
    return file;
  }
}

async function createDeduplicationSafeImage(file: File): Promise<File> {
  if (typeof window === 'undefined' || file.type === 'image/gif') return file;

  const image = await loadBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // ImgBB가 동일 파일을 삭제된 기존 URL로 중복 처리하는 경우를 피합니다.
    // 우측 하단 2px만 육안으로 구분되지 않는 범위에서 변경합니다.
    const size = Math.min(2, canvas.width, canvas.height);
    const x = Math.max(0, canvas.width - size);
    const y = Math.max(0, canvas.height - size);
    const pixels = ctx.getImageData(x, y, size, size);
    const nonce = (Date.now() % 7) + 1;
    for (let index = 0; index < pixels.data.length; index += 4) {
      pixels.data[index] = (pixels.data[index] + nonce) % 256;
    }
    ctx.putImageData(pixels, x, y);

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.82);
    });
    if (!blob) return file;

    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-${Date.now()}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    if ('close' in image) image.close();
  }
}

function verifyUploadedImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeoutId = window.setTimeout(() => {
      image.src = '';
      reject(new Error('Uploaded image verification timed out'));
    }, IMAGE_VERIFY_TIMEOUT_MS);

    image.onload = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error('ImgBB returned an unavailable image URL'));
    };
    const separator = url.includes('?') ? '&' : '?';
    image.src = `${url}${separator}dreamary_verify=${Date.now()}`;
  });
}

async function uploadFileToImgbb(file: File, apiKey: string, signal?: AbortSignal): Promise<string> {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: 'POST',
    body: formData,
    signal,
  });

  if (!response.ok) throw new Error('Failed to upload image');
  const data = await response.json();
  const url = data?.data?.url;
  if (typeof url !== 'string' || !url) throw new Error('ImgBB returned an invalid image URL');
  return url;
}

export async function uploadImageToImgbb(
  file: File,
  options: UploadImageOptions = {}
): Promise<string> {
  const uploadFile = await compressImageFile(file, options.compression);

  // You need an API key from imgbb (https://api.imgbb.com/)
  // Using a generic/temporary one if not provided in env, but it's recommended to add NEXT_PUBLIC_IMGBB_API_KEY
  const apiKey = process.env.NEXT_PUBLIC_IMG_BB_API_KEY || process.env.NEXT_PUBLIC_IMGBB_API_KEY || '';
  if (!apiKey) {
    throw new Error('IMGBB API Key is missing. Please set NEXT_PUBLIC_IMG_BB_API_KEY.');
  }

  const firstUrl = await uploadFileToImgbb(uploadFile, apiKey, options.signal);
  try {
    await verifyUploadedImage(firstUrl);
    return firstUrl;
  } catch (firstError) {
    console.warn('ImgBB returned an unavailable URL; retrying with a unique image payload.', firstError);
  }

  const uniqueFile = await createDeduplicationSafeImage(uploadFile);
  const retryUrl = await uploadFileToImgbb(uniqueFile, apiKey, options.signal);
  await verifyUploadedImage(retryUrl);
  return retryUrl;
}
