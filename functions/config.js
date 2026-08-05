export async function onRequest(context) {
  const js = `(function() {
  const defaults = {
    rv_anthropic_key: '${context.env.ANTHROPIC_KEY}',
    rv_youtube_key: '${context.env.YOUTUBE_KEY}',
  };
  Object.entries(defaults).forEach(([key, value]) => {
    if (value && !localStorage.getItem(key)) {
      localStorage.setItem(key, value);
    }
  });
})();`;

  return new Response(js, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-store',
    },
  });
}
