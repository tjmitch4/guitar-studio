// App configuration. The Dropbox app key is public (it's a PKCE app with no secret), so it's safe to commit.
// Leave DROPBOX_APP_KEY empty and the app works exactly as before, fully local ("Sync not configured yet").
window.GS_CONFIG = Object.assign({
  // Paste the "App key" from https://www.dropbox.com/developers/apps here to turn on sync.
  DROPBOX_APP_KEY: '',

  // Where the data file lives in TJ's Dropbox (his member folder = the default "home" namespace).
  DATA_DIR: '/TJ/Guitar',
  DATA_PATH: '/TJ/Guitar/guitar-studio-data.json',
  // Recordings and imports upload here when signed in.
  VIDEO_DIR: '/TJ/Guitar/Guitar Studio/Practice Videos',
  // Fallback for Dropbox Business: if DATA_DIR isn't found in the home namespace, retry from the team
  // root namespace with this prefix (the account's home_path from users/get_current_account is tried first).
  TEAM_HOME_PREFIX: '/TJ Mitchell',

  // localStorage keys
  STORE_KEY: 'guitarStudio.v1',
  DROPBOX_KEY: 'guitarStudio.dropbox',
}, window.GS_CONFIG_OVERRIDE || {}); // test pages set GS_CONFIG_OVERRIDE before this file loads
