export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/js/config.js') {
      const js = `(function() {
  const defaults = {
    rv_anthropic_key: '${env.ANTHROPIC_API_KEY}',
    rv_youtube_key:   '${env['YouTube API Key']}',
    rv_deepseek_key:  '${env.DEEPSEEK_KEY}',
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

    return env.ASSETS.fetch(request);
  }
};
