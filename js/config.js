// App configuration. No secrets live here: the GitHub token is pasted by the user and kept only in this
// browser's localStorage (key TOKEN_KEY). With no token the app works exactly as before, fully local.
window.GS_CONFIG = Object.assign({
  // The private data repo shared with Lift Studio (Lift uses lift/, Guitar Studio uses guitar/).
  GH_API: 'https://api.github.com',
  GH_OWNER: 'tjmitch4',
  GH_REPO: 'studio-data',
  GH_BRANCH: 'main',
  GH_PREFIX: 'guitar/',

  // localStorage keys
  STORE_KEY: 'guitarStudio.v1',
  // Shared with Lift Studio (same origin, tjmitch4.github.io): paste the token once per browser.
  TOKEN_KEY: 'studioData.githubToken',
  // This app's sync bookkeeping: last-synced path -> blob sha map, last sync time, device id.
  SYNC_KEY: 'guitarStudio.githubSync',
  // A short random id for this browser, used in commit messages ("from iPhone 7k2f").
  DEVICE_KEY: 'guitarStudio.deviceId',
}, window.GS_CONFIG_OVERRIDE || {}); // test pages set GS_CONFIG_OVERRIDE before this file loads
