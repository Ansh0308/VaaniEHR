// The only import of the pathway engine package. A relative path (not the workspace name) keeps `tsc` and the Docker
// build self-contained: the engine source is compiled together with this service (see tsconfig.build.json).
export * from '../../../../packages/rules/src/index.js';
