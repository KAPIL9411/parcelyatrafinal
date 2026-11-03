const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Aggressive bundle optimization for smallest possible APK
config.transformer = {
  ...config.transformer,
  minifierConfig: {
    keep_classnames: false,  // Remove class names
    keep_fnames: false,      // Remove function names  
    mangle: {
      toplevel: true,        // Mangle top-level names
    },
    compress: {
      drop_console: true,    // Remove ALL console.* calls
      drop_debugger: true,   // Remove debugger statements
      pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn'],
      reduce_vars: true,     // Optimize variable usage
      unused: true,          // Remove unused code
      dead_code: true,       // Remove dead code
      passes: 3,             // Multiple optimization passes
    },
    output: {
      comments: false,       // Remove ALL comments
      ascii_only: true,      // ASCII-only output (smaller)
    },
  },
};

module.exports = config;