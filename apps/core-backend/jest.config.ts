import type { Config } from "jest";

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  setupFiles: ["<rootDir>/test/setup.ts"],
  moduleNameMapper: {
    "^@slate/shared$": "<rootDir>/../../packages/shared/src/index",
    "^@slate/shared/(.*)$": "<rootDir>/../../packages/shared/src/$1",
  },
  collectCoverageFrom: ["src/**/*.ts"],
  testEnvironment: "node",
};

export default config;
