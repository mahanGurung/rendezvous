import { red } from "ansicolor";
import {
  getManifestFileName,
  main,
  noRemoteData,
  tryParseRemoteDataSettings,
} from "./app";
import { RemoteDataSettings } from "./app.types";
import { version } from "./package.json";
import { resolve } from "path";
import fs, { rmSync } from "fs";
import EventEmitter from "events";
import { createIsolatedTestEnvironment } from "./test.utils";

const isolatedTestEnvPrefix = "rendezvous-test-app-";
const clarinetTomlRemoteData = {
  fullSettings: {
    toml: `
[repl.remote_data]
api_url = 'https://api.hiro.so'
enabled = true
initial_height = 150000
`,
    expected: {
      enabled: true,
      api_url: "https://api.hiro.so",
      initial_height: 150000,
    },
  },
  noInitialHeightSettings: {
    toml: `
[repl.remote_data]
api_url = 'https://api.hiro.so'
enabled = true
`,
    expected: {
      enabled: true,
      api_url: "https://api.hiro.so",
    },
  },
  noRemoteDataSettings: {
    toml: ``,
    expected: noRemoteData,
  },
  enabledFalseSettings: {
    toml: `
[repl.remote_data]
api_url = 'https://api.hiro.so'
enabled = false
initial_height = 595012
`,
    expected: {
      enabled: false,
      api_url: "https://api.hiro.so",
      initial_height: 595012,
    },
  },
  onlyEnabledSettings: {
    toml: `
[repl.remote_data]
enabled = true
`,
    expected: {
      enabled: true,
    },
  },
};

describe("Command-line arguments handling", () => {
  const initialArgv = process.argv;

  const helpMessage = `
  rv v${version}
  
  Usage: rv <path-to-clarinet-project> <contract-name> <type> [--seed=<seed>] [--runs=<runs>] [--dial=<path-to-dialers-file>] [--help]

  Positional arguments:
    path-to-clarinet-project - The path to the Clarinet project.
    contract-name - The name of the contract to be fuzzed.
    type - The type to use for exercising the contracts. Possible values: test, invariant.

  Options:
    --seed - The seed to use for the replay functionality.
    --runs - The runs to use for iterating over the tests. Default: 100.
    --bail - Stop after the first failure.
    --dial – The path to a JavaScript file containing custom pre- and post-execution functions (dialers).
    --help - Show the help message.
  `;

  const noManifestMessage = red(
    `\nNo path to Clarinet project provided. Supply it immediately or face the relentless scrutiny of your contract's vulnerabilities.`
  );
  const noContractNameMessage = red(
    `\nNo target contract name provided. Please provide the contract name to be fuzzed.`
  );
  const manifestDirPlaceholder = "isolated-example";

  it.each([
    ["manifest path", ["node", "app.js"]],
    ["target contract name", ["node", "app.js", "./path/to/clarinet/project"]],
    ["--help flag", ["node", "app.js", "--help"]],
  ])(
    "returns undefined when %s is not provided",
    async (_testCase: string, argv: string[]) => {
      process.argv = argv;
      expect(await main()).toBeUndefined();
      process.argv = initialArgv;
    }
  );

  it("logs the help message at the end when --help is specified", async () => {
    // Arrange
    process.argv = ["node", "app.js", "--help"];

    const consoleLogs: string[] = [];
    jest.spyOn(console, "log").mockImplementation((message: string) => {
      consoleLogs.push(message);
    });

    // Act
    await main();

    const actual = consoleLogs[consoleLogs.length - 1];

    // Assert
    const expected = helpMessage;
    expect(actual).toBe(expected);

    process.argv = initialArgv;
    jest.restoreAllMocks();
  });

  it.each([
    ["manifest path", ["node", "app.js"], noManifestMessage],
    [
      "target contract name",
      ["node", "app.js", "./path/to/clarinet/project"],
      noContractNameMessage,
    ],
  ])(
    "logs the info and the help message when the %s is not provided",
    async (_testCase: string, argv: string[], expected: string) => {
      // Arrange
      process.argv = argv;
      const consoleLogs: string[] = [];
      jest.spyOn(console, "log").mockImplementation((message: string) => {
        consoleLogs.push(message);
      });

      // Act
      await main();

      const actualLastLog = consoleLogs[consoleLogs.length - 1];
      const actualSecondToLastLog = consoleLogs[consoleLogs.length - 2];

      // Assert
      const expectedLastLog = helpMessage;

      expect(actualLastLog).toBe(expectedLastLog);
      expect(actualSecondToLastLog).toBe(expected);

      process.argv = initialArgv;
      jest.restoreAllMocks();
    }
  );

  it.each([
    [
      ["no command-line arguments"],
      ["node", "app.js"],
      [noManifestMessage, helpMessage],
    ],
    [
      ["manifest path"],
      ["node", "app.js", manifestDirPlaceholder],
      [noContractNameMessage, helpMessage],
    ],
    [
      ["manifest path", "contract name"],
      ["node", "app.js", manifestDirPlaceholder, "counter"],
      [
        red(
          `\nInvalid type provided. Please provide the type of test to be executed. Possible values: test, invariant.`
        ),
        helpMessage,
      ],
    ],
    [
      ["manifest path", "contract name", "seed", "bail"],
      ["node", "app.js", manifestDirPlaceholder, "counter", "--bail"],
      [
        red(
          `\nInvalid type provided. Please provide the type of test to be executed. Possible values: test, invariant.`
        ),
        helpMessage,
      ],
    ],
    [
      ["manifest path", "contract name", "seed"],
      ["node", "app.js", manifestDirPlaceholder, "counter", "--seed=123"],
      [
        red(
          `\nInvalid type provided. Please provide the type of test to be executed. Possible values: test, invariant.`
        ),
        helpMessage,
      ],
    ],
    [
      ["manifest path", "contract name", "runs"],
      ["node", "app.js", manifestDirPlaceholder, "counter", "--runs=10"],
      [
        red(
          `\nInvalid type provided. Please provide the type of test to be executed. Possible values: test, invariant.`
        ),
        helpMessage,
      ],
    ],
    [
      ["manifest path", "contract name", "seed", "runs"],
      [
        "node",
        "app.js",
        manifestDirPlaceholder,
        "counter",
        "--seed=123",
        "--runs=10",
      ],
      [
        red(
          `\nInvalid type provided. Please provide the type of test to be executed. Possible values: test, invariant.`
        ),
        helpMessage,
      ],
    ],
    [
      ["manifest path", "contract name", "type=invariant"],
      ["node", "app.js", manifestDirPlaceholder, "counter", "invariant"],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `\nStarting invariant testing type for the counter contract...\n`,
      ],
    ],
    [
      ["manifest path", "contract name", "type=InVaRiAnT (case-insensitive)"],
      ["node", "app.js", manifestDirPlaceholder, "counter", "InVaRiAnT"],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `\nStarting invariant testing type for the counter contract...\n`,
      ],
    ],
    [
      ["manifest path", "contract name", "type=invariant", "bail"],
      [
        "node",
        "app.js",
        manifestDirPlaceholder,
        "counter",
        "invariant",
        "--bail",
      ],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `Bailing on first failure.`,
        `\nStarting invariant testing type for the counter contract...\n`,
      ],
    ],
    [
      ["manifest path", "contract name", "type=invariant", "dialers file path"],
      [
        "node",
        "app.js",
        manifestDirPlaceholder,
        "counter",
        "invariant",
        "--dial=example/sip010.cjs",
      ],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `Using dial path: example/sip010.cjs`,
        `\nStarting invariant testing type for the counter contract...\n`,
      ],
    ],
    [
      ["manifest path", "contract name", "type=test"],
      ["node", "app.js", manifestDirPlaceholder, "counter", "test"],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `\nStarting property testing type for the counter contract...\n`,
      ],
    ],
    [
      ["manifest path", "contract name", "type=tESt (case-insensitive)"],
      ["node", "app.js", manifestDirPlaceholder, "counter", "tESt"],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `\nStarting property testing type for the counter contract...\n`,
      ],
    ],
    [
      ["manifest path", "contract name", "type=test", "bail"],
      ["node", "app.js", manifestDirPlaceholder, "counter", "test", "--bail"],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `Bailing on first failure.`,
        `\nStarting property testing type for the counter contract...\n`,
      ],
    ],
    [
      ["manifest path", "contract name", "type=invariant", "seed"],
      [
        "node",
        "app.js",
        manifestDirPlaceholder,
        "counter",
        "invariant",
        "--seed=123",
      ],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `Using seed: 123`,
        `\nStarting invariant testing type for the counter contract...\n`,
      ],
    ],
    [
      [
        "manifest path",
        "contract name",
        "type=invARiaNT (case-insensitive)",
        "seed",
      ],
      [
        "node",
        "app.js",
        manifestDirPlaceholder,
        "counter",
        "invARiaNT",
        "--seed=123",
      ],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `Using seed: 123`,
        `\nStarting invariant testing type for the counter contract...\n`,
      ],
    ],
    [
      ["manifest path", "contract name", "type=test", "seed"],
      [
        "node",
        "app.js",
        manifestDirPlaceholder,
        "counter",
        "test",
        "--seed=123",
      ],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `Using seed: 123`,
        `\nStarting property testing type for the counter contract...\n`,
      ],
    ],
    [
      ["manifest path", "contract name = reverse", "type=test", "seed"],
      [
        "node",
        "app.js",
        manifestDirPlaceholder,
        "reverse",
        "test",
        "--seed=123",
      ],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: reverse`,
        `Using seed: 123`,
        `\nStarting property testing type for the reverse contract...\n`,
      ],
    ],
    [
      ["manifest path", "contract name = slice", "type=test", "seed"],
      ["node", "app.js", manifestDirPlaceholder, "slice", "test", "--seed=123"],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: slice`,
        `Using seed: 123`,
        `\nStarting property testing type for the slice contract...\n`,
      ],
    ],
    [
      [
        "manifest path",
        "contract name",
        "type=teSt (case-insensitive)",
        "seed",
      ],
      [
        "node",
        "app.js",
        manifestDirPlaceholder,
        "counter",
        "teSt",
        "--seed=123",
      ],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `Using seed: 123`,
        `\nStarting property testing type for the counter contract...\n`,
      ],
    ],
    [
      ["manifest path", "contract name", "type=test", "seed", "runs", "bail"],
      [
        "node",
        "app.js",
        manifestDirPlaceholder,
        "counter",
        "test",
        "--seed=123",
        "--runs=10",
        "--bail",
      ],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `Using seed: 123`,
        `Using runs: 10`,
        `Bailing on first failure.`,
        `\nStarting property testing type for the counter contract...\n`,
      ],
    ],
    [
      [
        "manifest path",
        "contract name",
        "type=invariant",
        "seed",
        "runs",
        "bail",
      ],
      [
        "node",
        "app.js",
        manifestDirPlaceholder,
        "counter",
        "invariant",
        "--seed=123",
        "--runs=10",
        "--bail",
      ],
      [
        `Using manifest path: ${manifestDirPlaceholder}/Clarinet.toml`,
        `Target contract: counter`,
        `Using seed: 123`,
        `Using runs: 10`,
        `Bailing on first failure.`,
        `\nStarting invariant testing type for the counter contract...\n`,
      ],
    ],
  ])(
    "prints the correct logs when arguments %p are provided",
    async (_testCase: string[], argv: string[], expectedLogs: string[]) => {
      // Setup
      const tempDir = createIsolatedTestEnvironment(
        resolve(__dirname, "example"),
        isolatedTestEnvPrefix
      );

      // Update argv to use the isolated test environment.
      const updatedArgv = argv.map((arg) =>
        arg === manifestDirPlaceholder ? tempDir : arg
      );
      process.argv = updatedArgv;

      const consoleLogs: string[] = [];
      jest.spyOn(console, "log").mockImplementation((message: string) => {
        consoleLogs.push(message);
      });
      jest.spyOn(console, "error").mockImplementation(() => {});

      // Exercise
      try {
        await main();
      } catch {
        // Do nothing.
      }

      // Verify
      expectedLogs.forEach((expectedLog) => {
        // Update expected log to use the isolated test environment path.
        const updatedExpectedLog = expectedLog.startsWith(
          "Using manifest path:"
        )
          ? expectedLog.replace(manifestDirPlaceholder, tempDir)
          : expectedLog;

        expect(consoleLogs).toContain(updatedExpectedLog);
      });

      // Teardown
      process.argv = initialArgv;
      jest.restoreAllMocks();
      rmSync(tempDir, { recursive: true, force: true });
    }
  );
});

describe("Custom manifest detection", () => {
  it("returns the default manifest file name for the example project", () => {
    // Arrange
    const manifestDir = "example";
    const targetContractName = "counter";

    // Act
    const actual = getManifestFileName(manifestDir, targetContractName);

    // Assert
    expect(actual).toBe("Clarinet.toml");
  });

  it("returns the custom manifest file name when it exists", () => {
    // Setup
    const manifestDir = "d290f1ee-6c54-4b01-90e6-d701748f0851";
    const targetContractName = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

    const expected = `Clarinet-${targetContractName}.toml`;
    const expectedPath = resolve(manifestDir, expected);

    jest
      .spyOn(fs, "existsSync")
      .mockImplementation((p: fs.PathLike) => p.toString() === expectedPath);

    // Exercise
    const actual = getManifestFileName(manifestDir, targetContractName);

    // Verify
    expect(actual).toBe(expected);

    // Teardown
    jest.restoreAllMocks();
  });
});

describe("Remote data settings parsing", () => {
  it.each([
    [
      "correctly returns no remote data settings when the remote data settings are not provided",
      clarinetTomlRemoteData.noRemoteDataSettings.toml,
      clarinetTomlRemoteData.noRemoteDataSettings.expected,
    ],
    [
      "correctly parses the remote data settings when they are provided",
      clarinetTomlRemoteData.fullSettings.toml,
      clarinetTomlRemoteData.fullSettings.expected,
    ],
    [
      "correctly returns remote data settings as-is when enabled is false",
      clarinetTomlRemoteData.enabledFalseSettings.toml,
      clarinetTomlRemoteData.enabledFalseSettings.expected,
    ],
    [
      "correctly returns remote data settings as-is when initial_height is not provided",
      clarinetTomlRemoteData.noInitialHeightSettings.toml,
      clarinetTomlRemoteData.noInitialHeightSettings.expected,
    ],
    [
      "correctly returns remote data settings as-is when only enabled is provided",
      clarinetTomlRemoteData.onlyEnabledSettings.toml,
      clarinetTomlRemoteData.onlyEnabledSettings.expected,
    ],
  ])(
    "%s",
    (
      _testCase: string,
      tomlContent: string,
      processedRemoteDataSettings: RemoteDataSettings
    ) => {
      // Setup
      const anyPath = `${Date.now()}.toml`;

      jest
        .spyOn(fs, "readFileSync")
        .mockImplementation((path: fs.PathOrFileDescriptor) => {
          expect(path).toBe(resolve(anyPath));
          return tomlContent;
        });

      // Exercise
      const actual = tryParseRemoteDataSettings(anyPath, new EventEmitter());

      // Verify
      expect(actual).toEqual(processedRemoteDataSettings);

      // Teardown
      jest.restoreAllMocks();
    }
  );
});
