import OpenAI from "openai";
import { z } from "zod";
import { ActionType } from "@dry-run/core";
import type {
  A11yNode,
  ActionEdge,
  AppState,
  PersonaTraitVector,
  TaskDefinition,
} from "@dry-run/core";

// TRD §4 / §5.5 — Reka and Gemini both expose OpenAI-compatible endpoints;
// one adapter, selected by env var, with Heuristic as the zero-network path.
type ProviderConfig = { baseURL: string; apiKey?: string; model: string };

const PROVIDERS: Record<string, ProviderConfig> = {
  reka: {
    baseURL: process.env.REKA_BASE_URL ?? "https://api.reka.ai/v1",
    apiKey: process.env.REKA_API_KEY,
    model: process.env.REKA_MODEL ?? "reka-flash",
  },
  gemini: {
    baseURL:
      process.env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
  },
};

const provider = PROVIDERS[process.env.LLM_PROVIDER ?? "reka"] ?? PROVIDERS.reka;

// No key configured ⇒ client stays null ⇒ evaluateWithLLM is a no-op.
// This is deliberate: it's what makes the offline/no-internet demo path work.
const client = provider.apiKey
  ? new OpenAI({ baseURL: provider.baseURL, apiKey: provider.apiKey })
  : null;

const LlmDecisionSchema = z.discriminatedUnion("giveUp", [
  z.object({ giveUp: z.literal(true), reason: z.string() }),
  z.object({
    giveUp: z.literal(false),
    targetRef: z.string(),
    action: ActionType,
    reasoning: z.string(),
  }),
]);
type LlmDecision = z.infer<typeof LlmDecisionSchema>;

const SYSTEM_PROMPT = `You are role-playing a real user testing a web app's onboarding flow.
You are given your persona traits, the task you're trying to complete, and the current
screen as an accessibility tree (refs, roles, accessible names only — no layout/CSS).

Pick the single element you'd interact with next to make progress toward the task goal,
or give up if nothing on this screen plausibly helps.

Respond with ONLY a JSON object (no markdown, no prose) matching exactly one of these shapes:
{"giveUp": false, "targetRef": "<a ref from the tree>", "action": "click"|"type"|"select"|"navigate"|"wait", "reasoning": "<one sentence, in character>"}
{"giveUp": true, "reason": "<one sentence, in character>"}`;

function buildUserPrompt(
  state: AppState,
  task: TaskDefinition,
  persona: PersonaTraitVector,
): string {
  // Spec: pass only refs/roles/names — no coordinates, no CSS-ish signals.
  const tree = state.a11yTree.map((n: A11yNode) => ({
    ref: n.ref,
    role: n.role,
    name: n.name,
  }));

  return JSON.stringify({
    persona: {
      role: persona.role,
      domainLiteracy: persona.domainLiteracy,
      riskAversion: persona.riskAversion,
      readingDepth: persona.readingDepth,
      priorFamiliarity: persona.priorFamiliarity,
      inputMode: persona.inputMode,
    },
    task: { name: task.name, goal: task.goalPredicate },
    screen: { url: state.url, title: state.title },
    accessibilityTree: tree,
  });
}

/** Looks up ground-truth anchor fields by ref — never trusts the model to echo them back. */
export function hydrateActionEdge(
  state: AppState,
  decision: LlmDecision,
): ActionEdge | null {
  if (decision.giveUp) return null;

  const target = state.a11yTree.find((n) => n.ref === decision.targetRef);
  if (!target) return null; // hallucinated ref — no viable grounded action

  return {
    fromStateId: state.id,
    toStateId: "", // unknown until the action is actually executed and observed
    action: decision.action,
    targetRef: target.ref,
    anchor: {
      role: target.role,
      name: target.name,
      landmark: target.landmark,
      ordinal: target.ordinal,
      dataTestId: target.dataTestId,
    },
  };
}

export function parseLlmResponse(state: AppState, raw: string): ActionEdge | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = LlmDecisionSchema.safeParse(json);
  if (!result.success) return null;

  return hydrateActionEdge(state, result.data);
}

export async function evaluateWithLLM(
  state: AppState,
  task: TaskDefinition,
  persona: PersonaTraitVector,
): Promise<ActionEdge | null> {
  if (!client) return null;

  const completion = await client.chat.completions.create({
    model: provider.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(state, task, persona) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) return null;

  return parseLlmResponse(state, content);
}
