import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { awsCredentials, parseIni } from "../src/sync/aws-credentials";
import { freshTestDir } from "./lib/test-home";

let env: Record<string, string>;

function write(name: string, text: string) {
  writeFileSync(resolve(env.dir ?? "", name), text);
}

beforeEach(() => {
  const dir = freshTestDir(import.meta.file);
  mkdirSync(dir, { recursive: true });
  env = {
    dir,
    AWS_SHARED_CREDENTIALS_FILE: resolve(dir, "credentials"),
    AWS_CONFIG_FILE: resolve(dir, "config"),
  };
  write(
    "credentials",
    "[default]\naws_access_key_id = DEF\naws_secret_access_key = defsecret\n\n[pal-sync]\naws_access_key_id = PAL\naws_secret_access_key = palsecret\n"
  );
  write("config", "[profile pal-sync]\nregion = eu-central-1\n");
});

describe("AWS credentials", () => {
  test("a named profile takes its key from credentials and its region from config", () => {
    expect(awsCredentials("pal-sync", env)).toEqual({
      accessKeyId: "PAL",
      secretAccessKey: "palsecret",
      sessionToken: undefined,
      region: "eu-central-1",
    });
  });

  test("a named profile wins over keys in the environment", () => {
    const withKeys = { ...env, AWS_ACCESS_KEY_ID: "ENV", AWS_SECRET_ACCESS_KEY: "e" };

    expect(awsCredentials("pal-sync", withKeys).accessKeyId).toBe("PAL");
  });

  test("without a profile, keys in the environment come first", () => {
    const withKeys = {
      ...env,
      AWS_ACCESS_KEY_ID: "ENV",
      AWS_SECRET_ACCESS_KEY: "e",
      AWS_REGION: "us-west-2",
    };

    expect(awsCredentials(undefined, withKeys)).toMatchObject({
      accessKeyId: "ENV",
      region: "us-west-2",
    });
  });

  test("without a profile or keys, AWS_PROFILE names one, else default", () => {
    expect(awsCredentials(undefined, env).accessKeyId).toBe("DEF");
    expect(
      awsCredentials(undefined, { ...env, AWS_PROFILE: "pal-sync" }).accessKeyId
    ).toBe("PAL");
  });

  test("the default profile's region is under [default] in config", () => {
    write("config", "[default]\nregion = ap-south-1\n");

    expect(awsCredentials(undefined, env).region).toBe("ap-south-1");
  });

  test("a profile without a key is refused, naming the profile", () => {
    expect(() => awsCredentials("nobody", env)).toThrow('the AWS profile "nobody"');
  });

  test("a profile with only half a key is refused", () => {
    write("credentials", "[half]\naws_access_key_id = ONLY\n");

    expect(() => awsCredentials("half", env)).toThrow("has no access key");
  });

  test("half a key in the environment falls back to the profile", () => {
    expect(
      awsCredentials(undefined, { ...env, AWS_ACCESS_KEY_ID: "ENV" }).accessKeyId
    ).toBe("DEF");
  });

  test("without file overrides, the files are read from the given home's .aws", () => {
    const home = resolve(env.dir ?? "", "home");
    mkdirSync(resolve(home, ".aws"), { recursive: true });
    writeFileSync(
      resolve(home, ".aws", "credentials"),
      "[home]\naws_access_key_id = HOME\naws_secret_access_key = s\n"
    );
    writeFileSync(
      resolve(home, ".aws", "config"),
      "[profile home]\nregion = eu-west-1\n"
    );

    expect(awsCredentials("home", {}, home)).toMatchObject({
      accessKeyId: "HOME",
      region: "eu-west-1",
    });
  });

  test("missing files read as no profiles", () => {
    const none = {
      AWS_SHARED_CREDENTIALS_FILE: "/nonexistent/c",
      AWS_CONFIG_FILE: "/nonexistent/f",
    };

    expect(() => awsCredentials("pal-sync", none)).toThrow("has no access key");
  });
});

describe("the ini reader", () => {
  test("keeps keys per section, trims spaces, skips comments and lines before a section", () => {
    const text =
      "stray = 1\n[a]\n# note = 1\n; note = 2\nk = v = w\n  x=y;z  \n  [ b ]  \nk=2\r\nnot [c] = 3\n";

    expect(parseIni(text)).toEqual({
      a: { k: "v = w", x: "y;z" },
      b: { k: "2", "not [c]": "3" },
    });
  });
});
