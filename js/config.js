// Local/static fallback for Cloudflare environment injection
(function() {
  if (typeof window !== 'undefined') {
    const savedKey = localStorage.getItem('rv_deepseek_key');
    if (!savedKey) {
      console.log('Recipe Vault config loaded.');
    }
  }
})();
