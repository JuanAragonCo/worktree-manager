import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
  input: "index.js",
  output: {
	file: "dist/bundle.mjs",
	format: "es",
	sourcemap: true
  },
  plugins: [
    resolve({
      exportConditions: ['node'] // This is important to Chalk resolves to the node version insteda of the browser one
    }),
    commonjs(),
    json()
  ],
  external: []
}
