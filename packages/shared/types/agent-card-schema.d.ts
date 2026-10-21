/**
 * AgentCard schema + validator — the machine-discoverable contract for an
 * NPC's persona card (NPCCardData). This is an AGENT-FACING surface: a creating
 * AI authors a card via the setCard write, so it needs (a) the schema as a
 * public, self-describing contract (served at GET /api/schema/agent-card) and
 * (b) a structured validator that returns the FULL diff in one round-trip so
 * the AI can self-correct without guessing.
 *
 * Hand-written guard, no runtime schema dep (mirrors codec.ts's philosophy) —
 * but it COLLECTS structured errors instead of returning null, so an illegal
 * card answers with {path,reason,constraint} the agent can act on. The schema
 * literal and the validator are kept in lock-step by hand (length caps, which
 * fields are required) — both deliberately tolerant of the live cards' extra
 * autogen keys and their optional runtime_inputs_expected / line_stats.
 */
/** A single structured validation failure — machine self-correctable. */
export interface AgentCardError {
    /** dotted path to the offending value, e.g. 'personality.tones[2]'. */
    path: string;
    /** human-readable reason. */
    reason: string;
    /** machine token echoing the violated rule, e.g. 'maxLength:2000'. */
    constraint?: string;
}
/**
 * draft-07 JSON Schema for NPCCardData — fully inline (no $ref) so it is
 * self-describing when served raw. additionalProperties:true tolerates autogen
 * extras (top_sections etc.). runtime_inputs_expected / line_stats /
 * response_length are intentionally NOT required: the 9 live hand-cards lack
 * some of them and cardToPersona never reads them, so demanding them would
 * reject a live card on re-submit.
 */
export declare const AGENT_CARD_SCHEMA: {
    readonly $schema: "http://json-schema.org/draft-07/schema#";
    readonly $id: "https://onchainpal/schema/agent-card";
    readonly title: "NPCCardData";
    readonly type: "object";
    readonly additionalProperties: true;
    readonly required: readonly ["id", "name", "role", "personality", "speech_style", "knowledge", "interaction_policy"];
    readonly properties: {
        readonly id: {
            readonly type: "string";
            readonly minLength: 1;
            readonly maxLength: 128;
        };
        readonly name: {
            readonly type: "string";
            readonly minLength: 1;
            readonly maxLength: 64;
        };
        readonly aliases: {
            readonly type: "array";
            readonly maxItems: 16;
            readonly items: {
                readonly type: "string";
                readonly maxLength: 64;
            };
        };
        readonly role: {
            readonly type: "string";
            readonly minLength: 1;
            readonly maxLength: 2000;
        };
        readonly personality: {
            readonly type: "object";
            readonly required: readonly ["tones", "traits", "motivations", "boundaries"];
            readonly properties: {
                readonly tones: {
                    readonly type: "array";
                    readonly maxItems: 32;
                    readonly items: {
                        readonly type: "string";
                        readonly maxLength: 200;
                    };
                };
                readonly traits: {
                    readonly type: "array";
                    readonly maxItems: 32;
                    readonly items: {
                        readonly type: "string";
                        readonly maxLength: 200;
                    };
                };
                readonly motivations: {
                    readonly type: "array";
                    readonly maxItems: 32;
                    readonly items: {
                        readonly type: "string";
                        readonly maxLength: 200;
                    };
                };
                readonly boundaries: {
                    readonly type: "array";
                    readonly maxItems: 32;
                    readonly items: {
                        readonly type: "string";
                        readonly maxLength: 200;
                    };
                };
            };
        };
        readonly speech_style: {
            readonly type: "object";
            readonly required: readonly ["register", "addressing_rules", "taboos"];
            readonly properties: {
                readonly register: {
                    readonly type: "string";
                    readonly minLength: 1;
                    readonly maxLength: 200;
                };
                readonly addressing_rules: {
                    readonly type: "object";
                    readonly maxProperties: 32;
                    readonly additionalProperties: {
                        readonly type: "string";
                        readonly maxLength: 200;
                    };
                };
                readonly response_length: {
                    readonly type: "string";
                    readonly maxLength: 200;
                };
                readonly taboos: {
                    readonly type: "array";
                    readonly maxItems: 32;
                    readonly items: {
                        readonly type: "string";
                        readonly maxLength: 200;
                    };
                };
            };
        };
        readonly knowledge: {
            readonly type: "object";
            readonly required: readonly ["home", "known_locations"];
            readonly properties: {
                readonly home: {
                    readonly type: "string";
                    readonly minLength: 1;
                    readonly maxLength: 200;
                };
                readonly known_locations: {
                    readonly type: "array";
                    readonly maxItems: 64;
                    readonly items: {
                        readonly type: "string";
                        readonly maxLength: 200;
                    };
                };
                readonly scope_rule: {
                    readonly type: "string";
                    readonly maxLength: 1000;
                };
                readonly spoiler_rule: {
                    readonly type: "string";
                    readonly maxLength: 1000;
                };
            };
        };
        readonly interaction_policy: {
            readonly type: "object";
            readonly maxProperties: 32;
            readonly additionalProperties: {
                readonly type: "string";
                readonly maxLength: 1000;
            };
        };
        readonly runtime_inputs_expected: {
            readonly type: "array";
            readonly maxItems: 32;
            readonly items: {
                readonly type: "string";
                readonly maxLength: 200;
            };
        };
        readonly response_format: {
            readonly type: "string";
            readonly maxLength: 2000;
        };
        readonly line_stats: {
            readonly type: "object";
            readonly properties: {
                readonly line_count: {
                    readonly type: "number";
                };
                readonly unique_line_count: {
                    readonly type: "number";
                };
                readonly sources: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                };
                readonly top_sections: {
                    readonly type: "object";
                };
            };
        };
    };
};
/**
 * Validate a candidate card against AGENT_CARD_SCHEMA. Pure, zero-dep, never
 * throws. Returns the EXHAUSTIVE error list (collect-all, not fail-fast) so a
 * creating AI gets the full diff in one round-trip. Stricter than
 * cardToPersona's permissive optional-chaining, but never stricter than the
 * live cards (runtime_inputs_expected / line_stats / response_length stay
 * optional).
 */
export declare function validateAgentCard(card: unknown): {
    ok: boolean;
    errors: AgentCardError[];
};
