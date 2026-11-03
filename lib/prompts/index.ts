export * from "./classify";
export * from "./leading";
export * from "./synthesize";
export * from "./script";

export const PROMPT_VERSIONS = {
  classify: "classify@1.0.0",
  leading: "leading@1.0.0",
  synthesize: "synthesize@1.0.0",
  script: "script@1.0.0",
} as const;
