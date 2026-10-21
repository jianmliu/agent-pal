/**
 * PAL wire protocol — the seam between the graphical PAL client
 * (apps/pal-playground, browser/Capacitor) and the PAL server
 * (apps/pal-server, SharedWorld + STF brains).
 *
 * Transport: WebSocket, one JSON message per text frame. The version is
 * negotiated once in the `hello` frame; every other message rides versionless.
 * The auth secret travels in the first frame, never in the URL (mud-web mode).
 *
 * Plain TS types + hand-written guards (codec.ts) — zero runtime deps so the
 * client bundle stays lean.
 */
import type { NPCCardData } from '../npc-card.js';
import type { AgentCardError } from '../agent-card-schema.js';
export declare const PAL_PROTOCOL_VERSION = 1;
export interface ClientHello {
    type: 'hello';
    v: typeof PAL_PROTOCOL_VERSION;
    /** display identity, e.g. "player:李逍遥" (server may rewrite after auth) */
    playerId: string;
    /** ai.gg SECRET — first frame only, never in the URL */
    secret?: string;
    /** 玩家选择的回话语言;缺省 → 走世界默认(WorldDef.language)。只管 NPC say 输出。 */
    lang?: 'zh' | 'en';
    client: {
        app: string;
        platform: 'web' | 'ios' | 'android';
        version?: string;
    };
}
/** A game-side event the server's NPC brains should perceive. */
export interface ClientPerception {
    type: 'perception';
    kind: 'dialog' | 'approach' | 'leave' | 'scene';
    /** set when the client already attributed the event to an NPC */
    npcId?: string;
    /** PAL event-object id, when the client could not attribute (server may) */
    eventObjectId?: number;
    sceneId?: number;
    /** kind='dialog': the player-triggered dialog line */
    text?: string;
    ts: number;
}
export interface ClientDonate {
    type: 'donate';
    npcId: string;
    gcc: number;
}
export interface ClientPing {
    type: 'ping';
    ts: number;
}
/** sudo-only world-operator control (需 PAL_SUDO_SECRET 握手置 se.sudo)。
 *  cmd='setActions' → 在线开/关行动循环(agent-action-loop),不重启、世界状态保留。 */
export interface ClientAdmin {
    type: 'admin';
    cmd: 'setActions';
    on: boolean;
}
/** Ask for an NPC's 人物档案 — track record + 心得 + 夜记. Answered by ServerProfile. */
export interface ClientProfile {
    type: 'profile';
    npcId: string;
}
/**
 * Author/replace an NPC's persona card (agent-facing write — for creating AIs,
 * not a form). Gated: only the NPC's owner or a sudo session. The server forces
 * card.id === npcId, runs validateAgentCard, persists onchain, and refreshes
 * the live persona. Answered by ServerSetCardResult.
 */
export interface ClientSetCard {
    type: 'setCard';
    npcId: string;
    card: NPCCardData;
}
/**
 * M-Ford 叙事控制台 — agent-facing 叙事写口 (write_narrative)。把"编写叙事"
 * (目标 / 计划步 / 移动 / 一次性世界事件) 变成包装现有引擎原语的 op。Ford 原则
 * 鉴权:sudo 对任意 NPC 全集 op;NPC 的认证 owner 仅对自己 agent 子集 op
 * (seedGoal/injectPlan/goto/place,不含全局 injectEvent);自报 playerId 不信。
 * 每个 op 只包装现有 world/fairRig 原语,不造新经济/物理规则。
 * Answered by ServerNarrateResult (ok:false 带结构化 errors → 机器可自纠)。
 */
export type NarrateOp = 'seedGoal' | 'injectPlan' | 'goto' | 'place' | 'injectEvent';
export interface ClientNarrate {
    type: 'narrate';
    op: NarrateOp;
    /** 目标 NPC。injectEvent 可省(全局),其余 op 必填 — 深校验在 server 层。 */
    npcId?: string;
    /** seedGoal: 目标 slug(server 侧 rememberGoal 会清洗非法字符)。 */
    slug?: string;
    /** seedGoal: 目标文本(非空)。 */
    text?: string;
    /** injectPlan/goto: 入队的地名/人名。 */
    place?: string;
    /** place: 瞬移目标房间(须 world.rooms 合法)。 */
    room?: string;
    /** injectEvent: 一次性世界事件 — 包装 world AMM 原语(非 fairRig 通道)。
     *  kind='shock' → world.tradeRice(side+amount 价格冲击);kind='luck' → world.grantRice。 */
    event?: {
        kind: 'shock' | 'luck';
        side?: 'buy' | 'sell';
        amount?: number;
    };
}
/**
 * A paid "deal" pitched TO an NPC (余杭小镇 cognition loop). The NPC decides
 * deterministically BY its memory (discernment gate): a verified wary belief
 * about this counterpart/claim → declines and keeps its GCC; otherwise it is
 * taken in and loses `gcc` — the loss episode that (rich tier) Dreams into a
 * belief, so the NPC refuses the same pitch later. fromId defaults to the
 * session player; pass an NPC id for NPC↔NPC pitches (钱塘大集).
 */
export interface ClientPitch {
    type: 'pitch';
    npcId: string;
    /** GCC (银两) the deal asks for */
    gcc: number;
    /** the claim being pitched, e.g. "此丹与仙灵岛仙丹同源，包治老毛病" */
    claim: string;
    /** pitcher identity (default: session playerId) */
    fromId?: string;
    /** outcome of accepting (default true = the claim is hollow, GCC is lost) */
    scam?: boolean;
}
/** a passkey owner (P-256 pubkey) or an EOA owner of the player's CSW. */
export type PasskeyOwner = {
    x: string;
    y: string;
} | {
    address: string;
};
/** a WebAuthn assertion from the authenticator (hex-encoded fields). */
export interface WebAuthnAssertionWire {
    authenticatorData: string;
    clientDataJSON: string;
    /** DER-encoded ECDSA P-256 signature. */
    signature: string;
}
export interface ClientPasskeyRegister {
    type: 'passkeyRegister';
    owners: PasskeyOwner[];
}
export interface ClientDonateIntent {
    type: 'donateIntent';
    npcId: string;
    gcc: number;
}
export interface ClientPaymentSign {
    type: 'paymentSign';
    payId: string;
    assertion: WebAuthnAssertionWire;
}
export type ClientMsg = ClientHello | ClientPerception | ClientDonate | ClientPing | ClientPitch | ClientProfile | ClientSetCard | ClientNarrate | ClientPasskeyRegister | ClientDonateIntent | ClientPaymentSign | ClientAdmin;
/**
 * PAL rendering anchors — where the client should pin the NPC's sprite.
 * Two forms:
 *   { sceneId, eventId }        — a CANONICAL NPC: its real event object
 *                                 already renders; eventId drives dialog
 *                                 attribution (byEvent map).
 *   { sceneId, x, y, spriteNum } — an OVERLAY visitor (no event object in
 *                                 this scene): the client spawns the sprite
 *                                 itself (npc-overlay), SSS.MKF untouched.
 */
export interface PalNpcMeta {
    sceneId?: number;
    eventId?: number;
    x?: number;
    y?: number;
    spriteNum?: number;
}
export interface NpcDescriptor {
    id: string;
    name: string;
    /** SharedWorld room, e.g. "scene:4" or "scene:aigg" */
    room?: string;
    balanceGcc: number | null;
    /** 银两(off-chain 游戏货币)余额 —— 可选,向后兼容旧客户端;HUD 显「银两」条。 */
    balanceSilver?: number | null;
    tier?: string;
    starving?: boolean;
    pal?: PalNpcMeta;
}
export interface ServerWelcome {
    type: 'welcome';
    v: typeof PAL_PROTOCOL_VERSION;
    serverVersion?: string;
    /** authoritative player id (post-auth) */
    playerId: string;
    /** the player's on-chain wallet, when identity/wallet rails are configured.
     *  balanceGcc 仅在 ai.gg 真账号握手成功时带(/agents/me 的 gcc_balance);
     *  guest-pool / 未知时省略 —— 账号面板据此显示「已登录 0x…(ai.gg) / GCC …」或「游客」。 */
    wallet?: {
        address: string;
        provider: 'guest-pool' | 'ai.gg';
        balanceGcc?: number | null;
    };
    /** true when the server can take passkey self-custody payments (CSW + facilitator rails). */
    passkey?: boolean;
    /** the world this server hosts — name + room display table, so a world-agnostic
     *  skin (rogue/TUI) themes itself per世界 (余杭/岩心堡/…) without hardcoding. */
    world?: {
        name: string;
        rooms: Array<{
            id: string;
            name: string;
        }>;
        language?: 'zh' | 'en';
    };
    npcs: NpcDescriptor[];
}
/** An NPC line for the client's dialog renderer. */
export interface ServerSay {
    type: 'say';
    npcId: string;
    text: string;
    emotion?: string;
    /** affinity-tier title the NPC uses for this player, e.g. "大哥哥" */
    addressing?: string;
    awaitInput?: boolean;
    seq?: number;
}
/** Post-turn NPC state mirror (TalkResult fields) — feeds the HUD. */
export interface ServerNpcState {
    type: 'npcState';
    npcId: string;
    affinity?: number;
    dAffinity?: number;
    balanceGcc?: number;
    /** 银两(off-chain 游戏货币)余额 —— 可选,向后兼容;tradeRice/赌注后 HUD 镜像。 */
    balanceSilver?: number;
    tier?: string;
    starving?: boolean;
    costGcc?: number;
    settlement?: {
        mode: string;
        receiptId?: string;
        ok: boolean;
    };
    /** AI provenance — the oracle's signed attestation (model+prompt+response), when the server runs an attesting oracle. */
    attestation?: unknown;
}
/** 一场战斗的可回放 log(私斗/狩猎共用);客户端阶段 2 据此回放战斗界面,阶段 1 紧凑过场。 */
export interface ServerBattle {
    type: 'battle';
    room?: string;
    attacker: {
        id: string;
        name: string;
    };
    defender: {
        kind: 'npc';
        id: string;
        name: string;
    } | {
        kind: 'monster';
        species: string;
        name: string;
    };
    rounds: Array<{
        actorId: string;
        targetId: string;
        kind: 'attack' | 'skill';
        skill?: string;
        element?: string;
        damage: number;
        targetHpAfter: number;
    }>;
    outcome: {
        winnerId: string;
        loserId: string;
        wounded: boolean;
    };
    say?: string;
    seq?: number;
}
/** A forged strange-mood artifact announcement (dwarf §4.4). */
export interface ServerArtifact {
    type: 'artifact';
    npcId: string;
    artifactId: string;
    name: string;
    engraving: string;
    kind: 'statue' | 'amulet' | 'relief' | 'weapon' | 'door';
    seq?: number;
}
/**
 * Result of a pitch — whether the NPC was taken in (lost GCC) or saw through
 * it (a verified belief gated the decision). belief = the心得 the Dream just
 * synthesized from this loss, when one formed.
 */
export interface ServerPitched {
    type: 'pitched';
    npcId: string;
    accepted: boolean;
    /** true = a verified wary belief blocked the deal (识破) */
    protected: boolean;
    deltaGcc: number;
    balanceGcc?: number;
    belief?: string;
    /** the discernment gate, when it fired: q=relevance, confidence=verified */
    gate?: {
        q: number;
        confidence: number;
    };
}
/**
 * A live world-feed line (broadcast to every session) — the fair heartbeat
 * made visible: pitches, street talk, trades, the rice price breathing.
 */
export interface FeedLine {
    ts: number;
    kind: 'pitch' | 'gossip' | 'trade' | 'price' | 'info';
    text: string;
    /** spot 米价 after this event, when it moved */
    price?: number;
}
export interface ServerFeed {
    type: 'feed';
    lines: FeedLine[];
}
/**
 * A roster refresh (broadcast) — NPCs moved (routes/plans), tiers changed.
 * Same descriptor shape as welcome; clients re-anchor overlays and 附近 lists.
 */
export interface ServerRoster {
    type: 'roster';
    npcs: NpcDescriptor[];
}
/** Escape hatch for effects the client must apply (host-side semantics). */
export interface ServerEffect {
    type: 'effect';
    npcId: string;
    effect: unknown;
}
export interface ServerError {
    type: 'error';
    code: 'auth' | 'version' | 'bad-msg' | 'internal';
    message: string;
    /** fatal=true: the server closes the connection after this frame */
    fatal?: boolean;
}
export interface ServerPong {
    type: 'pong';
    ts: number;
}
/** ack for ClientAdmin —— ok=false 多为非 sudo 或开关能力未就位;active=行动循环现是否真跑。 */
export interface ServerAdminResult {
    type: 'adminResult';
    cmd: string;
    ok: boolean;
    active?: boolean;
    detail?: string;
}
/**
 * An NPC's 人物档案 (answer to ClientProfile): its track record (how much it
 * has lived / learned / written), the 心得 (active beliefs it formed), and the
 * 夜记 (first-person diary the Dream wrote each night). The client renders the
 * standalone character-profile page from this.
 */
export interface ServerProfile {
    type: 'profile';
    npcId: string;
    name: string;
    /** spriteNum for the portrait, when known */
    spriteNum?: number;
    track: {
        beliefs: number;
        journals: number;
        episodes: number;
        skill: number;
    };
    /** belief unit names — the NPC's 心得 */
    beliefs: string[];
    /** first-person diary entries (newest last) */
    diary: Array<{
        date?: string;
        text: string;
    }>;
    /** third-person system log — say/move/pitch/gossip/dream, in order (debug) */
    log: Array<{
        ts: number;
        kind: string;
        text: string;
    }>;
}
/**
 * Result of a setCard. ok:false carries structured, machine-self-correctable
 * errors (the same {path,reason,constraint} the public agent-card schema
 * implies) so the creating AI gets the full diff in one round-trip.
 */
export interface ServerSetCardResult {
    type: 'setCardResult';
    npcId: string;
    ok: boolean;
    errors?: AgentCardError[];
}
/** 结构化错误(照搬 setCardResult 的 {path,reason,constraint} 形)— agent 可据此自纠。 */
export interface NarrateError {
    path: string;
    reason: string;
    constraint?: string;
}
/**
 * narrate 的结果。ok:false 永远带 errors(校验失败 / room 非法 / 原语抛错),
 * 不回 error{bad-msg} drop —— 这正是让契约"机器可自纠"的关键。detail = 成功时的
 * 人类可读回执(如 "placed npc:bo → scene:4")。鉴权失败仍走 error{code:'auth'}
 * (与 setCard 一致:auth 是会话级拒绝,不是入参可纠错)。
 */
export interface ServerNarrateResult {
    type: 'narrateResult';
    op: NarrateOp;
    npcId?: string;
    ok: boolean;
    detail?: string;
    errors?: NarrateError[];
}
/**
 * A menu NPC's interaction surface (zero-LLM platform NPCs: 碧玄子 pricing,
 * 秦薇 merchant). The client renders title/body/actions; the player's choice
 * goes back as a dialog perception whose text is the action key (or free
 * input when `prompt` is set). Sending '0' exits.
 */
export interface ServerMenu {
    type: 'menu';
    npcId: string;
    npcName: string;
    title: string;
    body?: string[];
    actions: Array<{
        key: string;
        label: string;
    }>;
    /** free-text input mode (e.g. cost calculator) — show this prompt */
    prompt?: string;
}
/** Output lines produced by a menu action; exit=true closes the menu. */
export interface ServerMenuResult {
    type: 'menuResult';
    npcId: string;
    output: string[];
    exit?: boolean;
}
/** the player's CSW counterfactual address (after passkeyRegister). */
export interface ServerPasskeyWallet {
    type: 'passkeyWallet';
    address: string;
}
/** sign this challenge with the passkey on-device, answer with paymentSign. */
export interface ServerPaymentChallenge {
    type: 'paymentChallenge';
    payId: string;
    npcId: string;
    gcc: number;
    /** hex digest the WebAuthn authenticator signs (EIP-712 typed-data hash). */
    challenge: string;
}
export interface ServerPaymentResult {
    type: 'paymentResult';
    payId: string;
    ok: boolean;
    receiptId?: string;
    message?: string;
}
export type ServerMsg = ServerWelcome | ServerSay | ServerNpcState | ServerPitched | ServerFeed | ServerRoster | ServerEffect | ServerError | ServerPong | ServerProfile | ServerSetCardResult | ServerNarrateResult | ServerMenu | ServerMenuResult | ServerPasskeyWallet | ServerPaymentChallenge | ServerPaymentResult | ServerAdminResult | ServerBattle | ServerArtifact;
