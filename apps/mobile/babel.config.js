module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated/plugin must be listed last (required by stream-chat-expo).
    plugins: ['react-native-reanimated/plugin'],
  };
};
