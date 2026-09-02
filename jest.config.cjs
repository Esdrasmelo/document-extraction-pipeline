module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  transform: {
    "^.+\\.ts$": [
      "@swc/jest",
      { jsc: { target: "es2022", parser: { syntax: "typescript" } }, module: { type: "commonjs" } },
    ],
  },
  moduleFileExtensions: ["ts", "js"],
  clearMocks: true,
};
