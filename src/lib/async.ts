export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 10000,
  message = '데이터 요청 시간이 초과되었습니다.'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);

    promise.then(
      value => {
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}
