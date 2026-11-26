import type { InferenceUsage } from "./inference-usage";
import { type FixedModelRoute, type InferenceTier, inferenceModel } from "./models";

export interface InferenceOptions {
  system?: string;
  user: string;
  /** Model size; the active route maps it to that provider's model. Default "small". */
  tier?: InferenceTier;
  maxTokens?: number;
  timeout?: number;
  /** JSON schema the reply must match; a reply that doesn't fails with the reason */
  jsonSchema?: Record<string, unknown>;
  /** Opaque label identifying the calling handler — appears in debug logs as caller=X */
  caller?: string;
  /** Session ID the call is associated with — appears in debug logs as sessionId=X */
  sessionId?: string;
  /** Let the model search and read the web, and nothing else; a route that can't fails */
  web?: boolean;
}

export interface InferenceResult {
  success: boolean;
  output?: string;
  /** First line of a failed CLI's error output. */
  error?: string;
  usage?: InferenceUsage;
  /** The model the route ran on, when PAL picked it. */
  model?: string;
}

export function modelFor(route: FixedModelRoute, opts: InferenceOptions): string {
  return inferenceModel(route, opts.tier, opts.caller);
}
