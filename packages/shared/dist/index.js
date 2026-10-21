// packages/shared/src/protocol/messages.ts
var PAL_PROTOCOL_VERSION = 1;

// packages/shared/src/protocol/codec.ts
function serialize(msg) {
  return JSON.stringify(msg);
}
function obj(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed;
}
var isStr = (v) => typeof v === "string";
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
var optStr = (v) => v === void 0 || isStr(v);
var optNum = (v) => v === void 0 || isNum(v);
var optBool = (v) => v === void 0 || typeof v === "boolean";
var PERCEPTION_KINDS = ["dialog", "approach", "leave", "scene"];
var PLATFORMS = ["web", "ios", "android"];
var NARRATE_OPS = ["seedGoal", "injectPlan", "goto", "place", "injectEvent"];
function parseClientMsg(raw) {
  const m = obj(raw);
  if (!m) return null;
  switch (m.type) {
    case "hello": {
      const client = m.client;
      if (m.v !== PAL_PROTOCOL_VERSION) return null;
      if (!isStr(m.playerId) || !m.playerId) return null;
      if (!optStr(m.secret)) return null;
      if (typeof client !== "object" || client === null) return null;
      if (!isStr(client.app) || !PLATFORMS.includes(client.platform) || !optStr(client.version)) return null;
      return m;
    }
    case "perception": {
      if (!PERCEPTION_KINDS.includes(m.kind)) return null;
      if (!optStr(m.npcId) || !optNum(m.eventObjectId) || !optNum(m.sceneId) || !optStr(m.text)) return null;
      if (!isNum(m.ts)) return null;
      return m;
    }
    case "donate": {
      if (!isStr(m.npcId) || !m.npcId) return null;
      if (!isNum(m.gcc) || m.gcc <= 0) return null;
      return m;
    }
    case "ping": {
      if (!isNum(m.ts)) return null;
      return m;
    }
    case "admin": {
      if (m.cmd !== "setActions") return null;
      if (typeof m.on !== "boolean") return null;
      return m;
    }
    case "pitch": {
      if (!isStr(m.npcId) || !m.npcId) return null;
      if (!isNum(m.gcc) || m.gcc <= 0) return null;
      if (!isStr(m.claim) || !m.claim) return null;
      if (!optStr(m.fromId) || !optBool(m.scam)) return null;
      return m;
    }
    case "profile": {
      if (!isStr(m.npcId) || !m.npcId) return null;
      return m;
    }
    case "setCard": {
      if (!isStr(m.npcId) || !m.npcId) return null;
      if (typeof m.card !== "object" || m.card === null || Array.isArray(m.card)) return null;
      return m;
    }
    case "narrate": {
      if (!NARRATE_OPS.includes(m.op)) return null;
      if (!optStr(m.npcId) || !optStr(m.slug) || !optStr(m.text) || !optStr(m.place) || !optStr(m.room)) return null;
      if (m.event !== void 0) {
        const ev = m.event;
        if (typeof ev !== "object" || ev === null) return null;
        if (!["shock", "luck"].includes(ev.kind)) return null;
        if (ev.side !== void 0 && !["buy", "sell"].includes(ev.side)) return null;
        if (!optNum(ev.amount)) return null;
      }
      return m;
    }
    case "passkeyRegister": {
      if (!Array.isArray(m.owners) || !m.owners.length || !m.owners.every(isPasskeyOwner)) return null;
      return m;
    }
    case "donateIntent": {
      if (!isStr(m.npcId) || !m.npcId) return null;
      if (!isNum(m.gcc) || m.gcc <= 0) return null;
      return m;
    }
    case "paymentSign": {
      if (!isStr(m.payId) || !m.payId || !isAssertion(m.assertion)) return null;
      return m;
    }
    default:
      return null;
  }
}
function isPasskeyOwner(v) {
  if (typeof v !== "object" || v === null) return false;
  const o = v;
  if (isStr(o.address) && o.address) return true;
  return isStr(o.x) && !!o.x && isStr(o.y) && !!o.y;
}
function isAssertion(v) {
  if (typeof v !== "object" || v === null) return false;
  const a = v;
  return isStr(a.authenticatorData) && isStr(a.clientDataJSON) && isStr(a.signature);
}
function isNpcDescriptor(v) {
  if (typeof v !== "object" || v === null) return false;
  const d = v;
  if (!isStr(d.id) || !isStr(d.name) || !optStr(d.room)) return false;
  if (!(d.balanceGcc === null || isNum(d.balanceGcc))) return false;
  if (d.balanceSilver !== void 0 && !(d.balanceSilver === null || isNum(d.balanceSilver))) return false;
  if (!optStr(d.tier) || !optBool(d.starving)) return false;
  if (d.pal !== void 0) {
    if (typeof d.pal !== "object" || d.pal === null) return false;
    const p = d.pal;
    if (!optNum(p.sceneId) || !optNum(p.eventId) || !optNum(p.x) || !optNum(p.y) || !optNum(p.spriteNum)) return false;
  }
  return true;
}
var ERROR_CODES = ["auth", "version", "bad-msg", "internal"];
function parseServerMsg(raw) {
  const m = obj(raw);
  if (!m) return null;
  switch (m.type) {
    case "welcome": {
      if (m.v !== PAL_PROTOCOL_VERSION) return null;
      if (!isStr(m.playerId) || !optStr(m.serverVersion)) return null;
      if (m.wallet !== void 0) {
        const w = m.wallet;
        if (typeof w !== "object" || w === null) return null;
        if (!isStr(w.address) || !["guest-pool", "ai.gg"].includes(w.provider)) return null;
        if (w.balanceGcc !== void 0 && !(w.balanceGcc === null || isNum(w.balanceGcc))) return null;
      }
      if (!optBool(m.passkey)) return null;
      if (!Array.isArray(m.npcs) || !m.npcs.every(isNpcDescriptor)) return null;
      return m;
    }
    case "say": {
      if (!isStr(m.npcId) || !isStr(m.text)) return null;
      if (!optStr(m.emotion) || !optStr(m.addressing) || !optBool(m.awaitInput) || !optNum(m.seq)) return null;
      return m;
    }
    case "npcState": {
      if (!isStr(m.npcId)) return null;
      if (!optNum(m.affinity) || !optNum(m.dAffinity) || !optNum(m.balanceGcc) || !optNum(m.balanceSilver) || !optNum(m.costGcc)) return null;
      if (!optStr(m.tier) || !optBool(m.starving)) return null;
      if (m.settlement !== void 0) {
        const s = m.settlement;
        if (typeof s !== "object" || s === null) return null;
        if (!isStr(s.mode) || !optStr(s.receiptId) || typeof s.ok !== "boolean") return null;
      }
      return m;
    }
    case "pitched": {
      if (!isStr(m.npcId) || typeof m.accepted !== "boolean" || typeof m.protected !== "boolean") return null;
      if (!isNum(m.deltaGcc) || !optNum(m.balanceGcc) || !optStr(m.belief)) return null;
      if (m.gate !== void 0) {
        const g = m.gate;
        if (typeof g !== "object" || g === null || !isNum(g.q) || !isNum(g.confidence)) return null;
      }
      return m;
    }
    case "roster": {
      if (!Array.isArray(m.npcs) || !m.npcs.every(isNpcDescriptor)) return null;
      return m;
    }
    case "feed": {
      if (!Array.isArray(m.lines)) return null;
      for (const l of m.lines) {
        if (typeof l !== "object" || l === null) return null;
        if (!isNum(l.ts) || !isStr(l.kind) || !isStr(l.text) || !optNum(l.price)) return null;
      }
      return m;
    }
    case "effect": {
      if (!isStr(m.npcId) || m.effect === void 0) return null;
      return m;
    }
    case "error": {
      if (!ERROR_CODES.includes(m.code) || !isStr(m.message) || !optBool(m.fatal)) return null;
      return m;
    }
    case "pong": {
      if (!isNum(m.ts)) return null;
      return m;
    }
    case "adminResult": {
      if (!isStr(m.cmd) || typeof m.ok !== "boolean") return null;
      if (m.active !== void 0 && typeof m.active !== "boolean") return null;
      if (!optStr(m.detail)) return null;
      return m;
    }
    case "profile": {
      if (!isStr(m.npcId) || !isStr(m.name)) return null;
      if (typeof m.track !== "object" || m.track === null) return null;
      if (!Array.isArray(m.beliefs) || !Array.isArray(m.diary) || !Array.isArray(m.log)) return null;
      return m;
    }
    case "menu": {
      if (!isStr(m.npcId) || !isStr(m.npcName) || !isStr(m.title) || !optStr(m.prompt)) return null;
      if (m.body !== void 0 && !(Array.isArray(m.body) && m.body.every(isStr))) return null;
      if (!Array.isArray(m.actions) || !m.actions.every((a) => {
        const r = a;
        return typeof r === "object" && r !== null && isStr(r.key) && isStr(r.label);
      })) return null;
      return m;
    }
    case "menuResult": {
      if (!isStr(m.npcId) || !optBool(m.exit)) return null;
      if (!Array.isArray(m.output) || !m.output.every(isStr)) return null;
      return m;
    }
    case "passkeyWallet": {
      if (!isStr(m.address) || !m.address) return null;
      return m;
    }
    case "paymentChallenge": {
      if (!isStr(m.payId) || !m.payId || !isStr(m.npcId) || !isStr(m.challenge) || !m.challenge) return null;
      if (!isNum(m.gcc) || m.gcc <= 0) return null;
      return m;
    }
    case "paymentResult": {
      if (!isStr(m.payId) || typeof m.ok !== "boolean") return null;
      if (!optStr(m.receiptId) || !optStr(m.message)) return null;
      return m;
    }
    case "setCardResult": {
      if (!isStr(m.npcId) || typeof m.ok !== "boolean") return null;
      if (m.errors !== void 0) {
        if (!Array.isArray(m.errors)) return null;
        for (const e of m.errors) {
          if (typeof e !== "object" || e === null) return null;
          if (!isStr(e.path) || !isStr(e.reason) || !optStr(e.constraint)) return null;
        }
      }
      return m;
    }
    case "narrateResult": {
      if (!NARRATE_OPS.includes(m.op) || typeof m.ok !== "boolean") return null;
      if (!optStr(m.npcId) || !optStr(m.detail)) return null;
      if (m.errors !== void 0) {
        if (!Array.isArray(m.errors)) return null;
        for (const e of m.errors) {
          if (typeof e !== "object" || e === null) return null;
          if (!isStr(e.path) || !isStr(e.reason) || !optStr(e.constraint)) return null;
        }
      }
      return m;
    }
    case "battle": {
      if (typeof m.attacker !== "object" || m.attacker === null || !isStr(m.attacker.id)) return null;
      if (typeof m.defender !== "object" || m.defender === null) return null;
      if (!Array.isArray(m.rounds) || typeof m.outcome !== "object" || m.outcome === null) return null;
      return m;
    }
    case "artifact": {
      if (!isStr(m.npcId) || !isStr(m.artifactId) || !isStr(m.name) || !isStr(m.engraving) || !isStr(m.kind)) return null;
      if (!optNum(m.seq)) return null;
      return m;
    }
    default:
      return null;
  }
}

// packages/shared/src/agent-card-schema.ts
var AGENT_CARD_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://onchainpal/schema/agent-card",
  title: "NPCCardData",
  type: "object",
  additionalProperties: true,
  required: ["id", "name", "role", "personality", "speech_style", "knowledge", "interaction_policy"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 128 },
    name: { type: "string", minLength: 1, maxLength: 64 },
    aliases: { type: "array", maxItems: 16, items: { type: "string", maxLength: 64 } },
    role: { type: "string", minLength: 1, maxLength: 2e3 },
    personality: {
      type: "object",
      required: ["tones", "traits", "motivations", "boundaries"],
      properties: {
        tones: { type: "array", maxItems: 32, items: { type: "string", maxLength: 200 } },
        traits: { type: "array", maxItems: 32, items: { type: "string", maxLength: 200 } },
        motivations: { type: "array", maxItems: 32, items: { type: "string", maxLength: 200 } },
        boundaries: { type: "array", maxItems: 32, items: { type: "string", maxLength: 200 } }
      }
    },
    speech_style: {
      type: "object",
      required: ["register", "addressing_rules", "taboos"],
      properties: {
        register: { type: "string", minLength: 1, maxLength: 200 },
        addressing_rules: { type: "object", maxProperties: 32, additionalProperties: { type: "string", maxLength: 200 } },
        response_length: { type: "string", maxLength: 200 },
        taboos: { type: "array", maxItems: 32, items: { type: "string", maxLength: 200 } }
      }
    },
    knowledge: {
      type: "object",
      required: ["home", "known_locations"],
      properties: {
        home: { type: "string", minLength: 1, maxLength: 200 },
        known_locations: { type: "array", maxItems: 64, items: { type: "string", maxLength: 200 } },
        scope_rule: { type: "string", maxLength: 1e3 },
        spoiler_rule: { type: "string", maxLength: 1e3 }
      }
    },
    interaction_policy: { type: "object", maxProperties: 32, additionalProperties: { type: "string", maxLength: 1e3 } },
    runtime_inputs_expected: { type: "array", maxItems: 32, items: { type: "string", maxLength: 200 } },
    response_format: { type: "string", maxLength: 2e3 },
    line_stats: {
      type: "object",
      properties: {
        line_count: { type: "number" },
        unique_line_count: { type: "number" },
        sources: { type: "array", items: { type: "string" } },
        top_sections: { type: "object" }
      }
    }
  }
};
var isStr2 = (v) => typeof v === "string";
var isNum2 = (v) => typeof v === "number";
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var push = (errs, path, reason, constraint) => {
  errs.push(constraint !== void 0 ? { path, reason, constraint } : { path, reason });
};
function reqStr(errs, obj2, base, key, opts) {
  const path = base ? `${base}.${key}` : key;
  const v = obj2[key];
  if (v === void 0) {
    push(errs, path, `${key} is required`, "required");
    return;
  }
  if (!isStr2(v)) {
    push(errs, path, `${key} must be a string`, "type:string");
    return;
  }
  const min = opts.min ?? 1;
  if (min > 0 && v.length < min) push(errs, path, `${key} must be at least ${min} char(s)`, `minLength:${min}`);
  if (v.length > opts.max) push(errs, path, `${key} exceeds ${opts.max} chars`, `maxLength:${opts.max}`);
}
function optStr2(errs, val, path, max) {
  if (val === void 0) return;
  if (!isStr2(val)) {
    push(errs, path, `${path} must be a string`, "type:string");
    return;
  }
  if (val.length > max) push(errs, path, `${path} exceeds ${max} chars`, `maxLength:${max}`);
}
function strArray(errs, val, path, opts) {
  if (!Array.isArray(val)) {
    push(errs, path, `${path} must be an array of strings`, "type:array");
    return;
  }
  if (val.length > opts.maxItems) push(errs, path, `${path} has more than ${opts.maxItems} items`, `maxItems:${opts.maxItems}`);
  val.forEach((item, i) => {
    if (!isStr2(item)) {
      push(errs, `${path}[${i}]`, "item must be a string", "items.type:string");
      return;
    }
    if (item.length > opts.maxLen) push(errs, `${path}[${i}]`, `item exceeds ${opts.maxLen} chars`, `items.maxLength:${opts.maxLen}`);
  });
}
function strMap(errs, val, path, opts) {
  if (!isObj(val)) {
    push(errs, path, `${path} must be an object`, "type:object");
    return;
  }
  const keys = Object.keys(val);
  if (keys.length > opts.maxProps) push(errs, path, `${path} has more than ${opts.maxProps} properties`, `maxProperties:${opts.maxProps}`);
  for (const k of keys) {
    const v = val[k];
    if (!isStr2(v)) {
      push(errs, `${path}.${k}`, "value must be a string", "additionalProperties.type:string");
      continue;
    }
    if (v.length > opts.maxLen) push(errs, `${path}.${k}`, `value exceeds ${opts.maxLen} chars`, `additionalProperties.maxLength:${opts.maxLen}`);
  }
}
function validateAgentCard(card) {
  const errors = [];
  if (!isObj(card)) {
    push(errors, "", "card must be an object", "type:object");
    return { ok: false, errors };
  }
  reqStr(errors, card, "", "id", { max: 128 });
  reqStr(errors, card, "", "name", { max: 64 });
  reqStr(errors, card, "", "role", { max: 2e3 });
  if (card.aliases !== void 0) strArray(errors, card.aliases, "aliases", { maxItems: 16, maxLen: 64 });
  if (card.personality === void 0) {
    push(errors, "personality", "personality is required", "required");
  } else if (!isObj(card.personality)) {
    push(errors, "personality", "personality must be an object", "type:object");
  } else {
    for (const key of ["tones", "traits", "motivations", "boundaries"]) {
      const v = card.personality[key];
      if (v === void 0) push(errors, `personality.${key}`, `${key} is required`, "required");
      else strArray(errors, v, `personality.${key}`, { maxItems: 32, maxLen: 200 });
    }
  }
  if (card.speech_style === void 0) {
    push(errors, "speech_style", "speech_style is required", "required");
  } else if (!isObj(card.speech_style)) {
    push(errors, "speech_style", "speech_style must be an object", "type:object");
  } else {
    const ss = card.speech_style;
    reqStr(errors, ss, "speech_style", "register", { max: 200 });
    if (ss.addressing_rules === void 0) push(errors, "speech_style.addressing_rules", "addressing_rules is required", "required");
    else strMap(errors, ss.addressing_rules, "speech_style.addressing_rules", { maxProps: 32, maxLen: 200 });
    if (ss.taboos === void 0) push(errors, "speech_style.taboos", "taboos is required", "required");
    else strArray(errors, ss.taboos, "speech_style.taboos", { maxItems: 32, maxLen: 200 });
    optStr2(errors, ss.response_length, "speech_style.response_length", 200);
  }
  if (card.knowledge === void 0) {
    push(errors, "knowledge", "knowledge is required", "required");
  } else if (!isObj(card.knowledge)) {
    push(errors, "knowledge", "knowledge must be an object", "type:object");
  } else {
    const kn = card.knowledge;
    reqStr(errors, kn, "knowledge", "home", { max: 200 });
    if (kn.known_locations === void 0) push(errors, "knowledge.known_locations", "known_locations is required", "required");
    else strArray(errors, kn.known_locations, "knowledge.known_locations", { maxItems: 64, maxLen: 200 });
    optStr2(errors, kn.scope_rule, "knowledge.scope_rule", 1e3);
    optStr2(errors, kn.spoiler_rule, "knowledge.spoiler_rule", 1e3);
  }
  if (card.interaction_policy === void 0) {
    push(errors, "interaction_policy", "interaction_policy is required", "required");
  } else {
    strMap(errors, card.interaction_policy, "interaction_policy", { maxProps: 32, maxLen: 1e3 });
  }
  if (card.runtime_inputs_expected !== void 0) {
    strArray(errors, card.runtime_inputs_expected, "runtime_inputs_expected", { maxItems: 32, maxLen: 200 });
  }
  optStr2(errors, card.response_format, "response_format", 2e3);
  if (card.line_stats !== void 0) {
    if (!isObj(card.line_stats)) {
      push(errors, "line_stats", "line_stats must be an object", "type:object");
    } else {
      const ls = card.line_stats;
      if (ls.line_count !== void 0 && !isNum2(ls.line_count)) push(errors, "line_stats.line_count", "line_count must be a number", "type:number");
      if (ls.unique_line_count !== void 0 && !isNum2(ls.unique_line_count)) push(errors, "line_stats.unique_line_count", "unique_line_count must be a number", "type:number");
    }
  }
  return { ok: errors.length === 0, errors };
}
export {
  AGENT_CARD_SCHEMA,
  PAL_PROTOCOL_VERSION,
  parseClientMsg,
  parseServerMsg,
  serialize,
  validateAgentCard
};
