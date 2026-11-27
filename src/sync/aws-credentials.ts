/**
 * The AWS credentials an S3 store signs with, read where the AWS tools keep
 * them, each time the store opens. PAL never copies them into its own files.
 * Bun's S3 client reads only the environment, so the shared files are read here.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: string;
}

type Env = Record<string, string | undefined>;
type Ini = Record<string, Record<string, string>>;

export class AwsCredentialsError extends Error {}

export function parseIni(text: string): Ini {
  const sections: Ini = {};
  let current: Record<string, string> | undefined;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[\s*(.+?)\s*\]$/.exec(line);

    if (header?.[1]) {
      current = sections[header[1]] ??= {};
    } else if (current && line.includes("=") && !/^[#;]/.test(line)) {
      const at = line.indexOf("=");
      current[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }

  return sections;
}

function readIni(path: string): Ini {
  return existsSync(path) ? parseIni(readFileSync(path, "utf-8")) : {};
}

const awsFile = (env: Env, variable: string, name: string) =>
  env[variable] ?? resolve(homedir(), ".aws", name);

function profileSettings(env: Env, profile: string): Record<string, string> {
  const config = readIni(awsFile(env, "AWS_CONFIG_FILE", "config"));
  const configSection = profile === "default" ? "default" : `profile ${profile}`;
  const credentials = readIni(awsFile(env, "AWS_SHARED_CREDENTIALS_FILE", "credentials"));

  return { ...config[configSection], ...credentials[profile] };
}

function fromProfile(env: Env, profile: string): AwsCredentials {
  const settings = profileSettings(env, profile);
  const accessKeyId = settings.aws_access_key_id;
  const secretAccessKey = settings.aws_secret_access_key;
  if (!accessKeyId || !secretAccessKey)
    throw new AwsCredentialsError(
      `the AWS profile "${profile}" has no access key: add it to ~/.aws/credentials`
    );

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: settings.aws_session_token,
    region: settings.region ?? env.AWS_REGION,
  };
}

function fromEnvironment(env: Env): AwsCredentials | null {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return null;

  return {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
    region: env.AWS_REGION,
  };
}

/** A named profile wins; without one, the environment, then AWS_PROFILE or "default". */
export function awsCredentials(
  profile: string | undefined,
  env: Env = process.env
): AwsCredentials {
  if (profile) return fromProfile(env, profile);

  return fromEnvironment(env) ?? fromProfile(env, env.AWS_PROFILE ?? "default");
}
