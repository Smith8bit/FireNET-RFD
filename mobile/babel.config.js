module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // jsxImportSource lets NativeWind transform className on RN components.
      // React Compiler stays enabled via the `reactCompiler` experiment in app.json.
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
