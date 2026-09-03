/**
 * テスト用の簡易R2モック(Node標準機能のみ、npm依存なし)。
 * /test/mock-r2.js
 *
 * objects: { [r2ObjectKey]: { body: string, contentType: string } }
 * 実際のR2Bucket.get()の戻り値のうち、本APIが使う body / httpMetadata.contentType のみを再現する。
 */
export function createMockR2(objects = {}) {
  return {
    async get(key) {
      const entry = objects[key];
      if (!entry) return null;
      const bytes = new TextEncoder().encode(entry.body || '');
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      return {
        body,
        httpMetadata: { contentType: entry.contentType || 'application/octet-stream' },
      };
    },
    async put() {
      throw new Error('Mock R2: put()(書き込み)はサポートしていません。Public APIはgetのみのはずです。');
    },
    async delete() {
      throw new Error('Mock R2: delete()(削除)はサポートしていません。Public APIはgetのみのはずです。');
    },
  };
}
