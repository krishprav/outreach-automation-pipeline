import chalk from "chalk";
import ora, { type Ora } from "ora";

type LogLevel = "info" | "success" | "warn" | "error" | "debug";

const PREFIX: Record<LogLevel, string> = {
  info: chalk.blue("ℹ"),
  success: chalk.green("✓"),
  warn: chalk.yellow("⚠"),
  error: chalk.red("✗"),
  debug: chalk.magenta("›"),
};

function formatMessage(level: LogLevel, message: string): string {
  return `${PREFIX[level]} ${message}`;
}

/** True when DEBUG=true in environment. */
export function isDebugEnabled(): boolean {
  return process.env.DEBUG === "true";
}

export const logger = {
  info(message: string): void {
    console.log(formatMessage("info", message));
  },

  success(message: string): void {
    console.log(formatMessage("success", message));
  },

  warn(message: string): void {
    console.warn(formatMessage("warn", message));
  },

  error(message: string): void {
    console.error(formatMessage("error", message));
  },

  /** Verbose diagnostics. Only printed when DEBUG=true. */
  debug(message: string): void {
    if (isDebugEnabled()) {
      console.log(formatMessage("debug", message));
    }
  },

  blank(): void {
    console.log();
  },

  section(title: string): void {
    console.log(chalk.bold.cyan(`\n[ ${title} ]`));
  },
};

export function createSpinner(text: string): Ora {
  return ora({ text, color: "cyan" }).start();
}
