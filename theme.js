// Runs in <head> so the page never flashes the wrong theme. Same contract as
// j4den.com: the 'theme' localStorage key holds 'light' or 'dark', light mode
// is data-theme="light" on <html>, and dark is the default with no attribute.
// With nothing saved it follows the device setting.
(function () {
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light' || (!saved && window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: light)').matches)) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (e) {
    /* private windows refuse localStorage; dark is still the right default */
  }
})();
