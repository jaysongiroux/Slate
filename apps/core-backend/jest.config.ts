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
    "^adminjs$": "<rootDir>/test/helpers/adminjs-stub.ts",
    "^@adminjs/fastify$": "<rootDir>/test/helpers/adminjs-stub.ts",
    "^@adminjs/prisma$": "<rootDir>/test/helpers/adminjs-stub.ts",
    "^@adminjs/design-system$": "<rootDir>/test/helpers/adminjs-stub.ts",
    "^@adminjs/design-system/styled-components$": "<rootDir>/test/helpers/adminjs-stub.ts",
  },
  collectCoverageFrom: ["src/**/*.ts"],
  testEnvironment: "node",
};

export default config;
