const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

/**
 * Gives AppTheme the splash colour as its window background. Without it the window behind
 * the React root falls back to the DayNight default (white or black) for any frame between
 * the system splash and the first painted screen. `expo-splash-screen` writes this colour
 * resource, so this plugin must be listed after it in app.json.
 */
module.exports = function withAndroidWindowBackground(config) {
  return withAndroidStyles(config, (cfg) => {
    cfg.modResults = AndroidConfig.Styles.assignStylesValue(cfg.modResults, {
      add: true,
      parent: { name: 'AppTheme' },
      name: 'android:windowBackground',
      value: '@color/splashscreen_background',
    });
    return cfg;
  });
};
