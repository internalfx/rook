module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true,
    node: true,
  },
  extends: [
    `standard`,
  ],
  parserOptions: {
    ecmaVersion: `latest`,
  },
  plugins: [
  ],
  rules: {
    'comma-dangle': [`error`, `always-multiline`],
    'object-shorthand': [`off`, `always`],
    quotes: [1, `backtick`],
  },
}
