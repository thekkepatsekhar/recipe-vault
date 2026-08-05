export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Intercept requests to /js/config.js and inject keys securely
    if (url.pathname === '/js/config.js') {
      const js = `(function() {
  const defaults = {
    rv_anthropic_key: '${env.ANTHROPIC_KEY}',
    rv_youtube_key:   '${env.YOUTUBE_KEY}',
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

    // All other requests — serve static files normally
    return env.ASSETS.fetch(request);
  }
};
