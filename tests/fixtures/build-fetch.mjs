// 固定応答はテスト用ビルドの Node プロセスだけで使い、アプリには分岐を持ち込まない。
const scenario = process.env.TEST_BUILD_SCENARIO;
if (!['success', 'http-error', 'timeout', 'invalid-json', 'no-maxres'].includes(scenario)) {
  throw new Error('固定応答のシナリオが不明');
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input);
  if (url.origin === 'https://www.youtube.com' && url.pathname === '/oembed') {
    if (scenario === 'http-error') return new Response('', { status: 503 });
    if (scenario === 'timeout') {
      return new Promise((_, reject) => {
        init.signal.throwIfAborted();
        const pending = setInterval(() => {}, 1000);
        init.signal.addEventListener('abort', () => { clearInterval(pending); reject(init.signal.reason); }, { once: true });
      });
    }
    if (scenario === 'invalid-json') return new Response('{broken');
    const id = new URL(url.searchParams.get('url')).searchParams.get('v');
    return Response.json({
      title: '固定データの配信スケジュール', author_name: 'テスト用チャンネル', provider_name: 'YouTube',
      thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, thumbnail_width: 480, thumbnail_height: 360,
    });
  }
  if (url.origin === 'https://i.ytimg.com') {
    if (init?.method !== 'HEAD') throw new Error('固定buildで想定外の画像取得');
    return new Response(null, { headers: { 'content-length': scenario === 'no-maxres' ? '1000' : '20000' } });
  }
  return realFetch(input, init);
};
