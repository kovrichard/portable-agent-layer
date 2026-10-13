/**
 * How each agent's model calls are paid for: a subscription, an API key, or
 * unknown. Each reader takes the few fields that say so and nothing else from
 * files that also hold the agent's credentials.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { platform } from "../../../hooks/lib/paths";

export interface Billing {
  billing: "subscription" | "api" | "unknown";
  plan: string | null;
  extraUsage: boolean | null;
}

export const UNKNOWN: Billing = { billing: "unknown", plan: null, extraUsage: null };
const API: Billing = { billing: "api", plan: null, extraUsage: null };
const SUBSCRIPTION: Billing = { billing: "subscription", plan: null, extraUsage: null };

type Json = Record<string, unknown>;

function readJson(path: string): Json {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
  } catch {
    return {};
  }
}

function stringField(record: unknown, name: string): string | null {
  const value = (record as Json | undefined)?.[name];
  return typeof value === "string" ? value : null;
}

function booleanField(record: unknown, name: string): boolean | null {
  const value = (record as Json | undefined)?.[name];
  return typeof value === "boolean" ? value : null;
}

interface ClaudeSubscription {
  plan: string | null;
  extraUsage: boolean | null;
  since: number;
}

function claudeSubscriptionOf(config: Json): ClaudeSubscription | null {
  const account = config.oauthAccount;
  if (!stringField(account, "billingType")) return null;
  return {
    plan:
      stringField(account, "organizationRateLimitTier") ??
      stringField(account, "organizationType"),
    extraUsage: booleanField(account, "hasExtraUsageEnabled"),
    since: Date.parse(stringField(account, "subscriptionCreatedAt") ?? ""),
  };
}

export function claudeConfigFile(): string {
  return resolve(dirname(platform.claudeDir()), ".claude.json");
}

/** Billing for a call at `at`; a call older than the subscription is unknown. */
export function claudeBilling(configPath: string): (at: string) => Billing {
  const config = readJson(configPath);
  const subscription = claudeSubscriptionOf(config);
  const apiKeyLogin = "primaryApiKey" in config;
  return (at) => {
    if (!subscription) return apiKeyLogin ? API : UNKNOWN;
    if (Date.parse(at) < subscription.since) return UNKNOWN;
    return {
      billing: "subscription",
      plan: subscription.plan,
      extraUsage: subscription.extraUsage,
    };
  };
}

const CODEX_AUTH_MODES: Record<string, Billing> = { apikey: API, chatgpt: SUBSCRIPTION };

export function codexBilling(authPath: string): Billing {
  return CODEX_AUTH_MODES[stringField(readJson(authPath), "auth_mode") ?? ""] ?? UNKNOWN;
}

const OPENCODE_AUTH_TYPES: Record<string, Billing> = {
  oauth: SUBSCRIPTION,
  api: API,
  wellknown: API,
};

/** Billing per provider, from the type of the login opencode holds for it. */
export function opencodeBilling(
  authPath: string
): (provider: string | undefined) => Billing {
  const logins = readJson(authPath);
  const billingOf = new Map(
    Object.entries(logins).map(([provider, login]) => [
      provider,
      OPENCODE_AUTH_TYPES[stringField(login, "type") ?? ""] ?? UNKNOWN,
    ])
  );
  return (provider) => (provider && billingOf.get(provider)) || UNKNOWN;
}

export const COPILOT_BILLING = SUBSCRIPTION;
