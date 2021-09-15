const composerIcon =
  "https://getcomposer.org/img/logo-composer-transparent5.png";

interface ComposerArgument {
  name: string;
  is_required: boolean;
  is_array: boolean;
  description: string;
  default: null | string | Array<string>;
}

interface ComposerOption {
  name: string;
  shortcut: string;
  accept_value: boolean;
  is_value_required: boolean;
  is_multiple: boolean; // not supported by fig
  description: string;
  default: null | boolean; // not supported by fig
}

interface ComposerCommandDefinition {
  arguments: Record<string, ComposerArgument>;
  options: Record<string, ComposerOption>;
}

interface ComposerCommand {
  name: string;
  usage: string[]; // this is actually generated by fig
  description: string;
  help: string; //
  definition: ComposerCommandDefinition;
}

interface ComposerListOutput {
  commands: ComposerCommand[];
}

const PACKAGE_REGEXP = new RegExp("^.*/.*$");

const searchGenerator: Fig.Generator = {
  script: function (context) {
    if (context[context.length - 1] === "") return "";
    const searchTerm = context[context.length - 1];
    return `curl -s -H "Accept: application/json" "https://packagist.org/search.json?q=${searchTerm}&per_page=20"`;
  },
  postProcess: function (out) {
    try {
      return JSON.parse(out).results.map(
        (item) =>
          ({
            name: item.name,
            description: item.description,
            icon: "📦",
          } as Fig.Suggestion)
      ) as Fig.Suggestion[];
    } catch (e) {
      return [];
    }
  },
};

// generate package list from composer.json file
const packagesGenerator: Fig.Generator = {
  script: "cat composer.json",
  postProcess: function (out) {
    if (out.trim() == "") {
      return [];
    }

    try {
      const packageContent = JSON.parse(out);
      const dependencies = packageContent["require"] || {};
      const devDependencies = packageContent["require-dev"] || {};

      return filterRealDependencies(
        Object.assign(dependencies, devDependencies)
      ).map((dependencyName) => ({
        name: dependencyName,
        icon: "📦",
      }));
    } catch (e) {
      console.log(e);
    }

    return [];
  },
};

function filterRealDependencies(dependencies) {
  return Object.keys(dependencies).filter((dependency) =>
    dependency.match(PACKAGE_REGEXP)
  );
}

const completionSpec: Fig.Spec = {
  name: "composer",
  description: "Composer Command",

  generateSpec: async (tokens, executeShellCommand) => {
    const jsonList = await executeShellCommand("composer list --format=json");
    const symfonyLock = await executeShellCommand(`file symfony.lock`);

    const subcommands: Fig.Subcommand[] = [];

    try {
      const data: ComposerListOutput = JSON.parse(jsonList);
      const packagesGeneratorTriggersCommands = ["update", "remove"];

      for (const command of data.commands) {
        subcommands.push({
          name: command.name,
          description: command.description,
          icon: composerIcon,

          args: Object.keys(command.definition.arguments).map((argKey) => {
            const arg = command.definition.arguments[argKey];
            const argDefault = arg.default
              ? Array.isArray(arg.default)
                ? arg.default[0]
                : arg.default
              : undefined;

            return {
              name: arg.name,
              description: arg.description,
              isOptional: !arg.is_required,
              default: argDefault,
              isVariadic: arg.is_array,
              generators:
                command.name === "require"
                  ? searchGenerator
                  : packagesGeneratorTriggersCommands.includes(command.name)
                  ? packagesGenerator
                  : [],
            };
          }),

          options: Object.keys(command.definition.options).map((optionKey) => {
            const option = command.definition.options[optionKey];
            const names = [option.name];

            const shortCut = option.shortcut;
            if (shortCut.trim().length > 0) {
              names.push(shortCut);
            }

            return {
              name: names,
              description: option.description,
              isRequired: option.is_value_required,
              args: option.accept_value ? {} : undefined,
            };
          }),
        });
      }

      const recipesCommonOptions: Fig.Option[] = [
        { name: ["-h", "--help"], description: "Display this help message" },
        { name: ["-q", "--quiet"], description: "Do not output any message" },
        {
          name: ["-V", "--version"],
          description: "Display this application version",
        },
        {
          name: "--ansi",
          description: "Force ANSI output",
          exclusiveOn: ["--no-ansi"],
        },
        {
          name: "--no-ansi",
          description: "Disable ANSI output",
          exclusiveOn: ["--ansi"],
        },
        {
          name: ["-n", "--no-interaction"],
          description: "Do not ask any interactive question",
        },
        {
          name: "--profile",
          description: "Display timing and memory usage information",
        },
        { name: "--no-plugins", description: "Whether to disable plugins" },
        {
          name: ["-d", "--working-dir"],
          description:
            "If specified, use the given directory as working directory",
          args: {
            name: "dir",
            template: "folders",
          },
        },
        { name: "--no-cache", description: "Prevent use of the cache" },
        {
          name: ["-v", "--verbose"],
          description: "Verbosity of messages: 1 for normal output",
        },
        {
          name: "-vv",
          description: "Verbosity of messages: 2 for more verbose output",
        },
        {
          name: "-vvv",
          description: "Verbosity of messages: 3 for debug",
        },
      ];

      const symfonyLockExists = !symfonyLock.endsWith(
        "(No such file or directory)"
      );
      if (symfonyLockExists) {
        subcommands.push({
          name: ["recipes", "symfony:recipes"],
          description: "Shows information about all available recipes",
          icon: composerIcon,
          args: {
            name: "package",
            description: "Package to inspect, if not provided all packages are",
            isOptional: true,
            isVariadic: false,
          },
          options: [
            {
              name: ["-o", "--outdated"],
              description: "Show only recipes that are outdated",
            },
            ...recipesCommonOptions,
          ],
        });

        subcommands.push({
          name: [
            "recipes:install",
            "symfony:recipes:install",
            "symfony:sync-recipes",
            "sync-recipes",
            "fix-recipes",
          ],
          description:
            "Installs or reinstalls recipes for already installed packages",
          icon: composerIcon,
          args: {
            name: "packages",
            description: "Recipes that should be installed",
            isVariadic: true,
          },
          options: [
            {
              name: "--force",
              description:
                "Overwrite existing files when a new version of a recipe is available",
              isDangerous: true,
            },
            ...recipesCommonOptions,
          ],
        });
      }
    } catch (err) {
      console.error(err);
    }

    return {
      name: "composer",
      subcommands,
    };
  },
};

export default completionSpec;
