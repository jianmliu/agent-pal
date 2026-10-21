import { defineStruct } from './binary-helper';

const globalScope = globalThis as any;
const globalAny = globalScope;
export const PAL_CLASSIC = !!globalScope.PAL_CLASSIC;

export const Const = globalScope.Const = {
  /**
   * maximum number of players in party
   * @memberof Const
   */
  MAX_PLAYERS_IN_PARTY: 3,
  /**
   * total number of possible player roles
   * @memberof Const
   */
  MAX_PLAYER_ROLES: 6,
  /**
   * totally number of playable player roles
   * @memberof Const
   */
  MAX_PLAYABLE_PLAYER_ROLES: 5,
  /**
   * maximum entries of inventory
   * @memberof Const
   */
  MAX_INVENTORY: 256,
  /**
   * maximum items in a store
   * @memberof Const
   */
  MAX_STORE_ITEM: 9,
  /**
   * total number of magic attributes
   * @memberof Const
   */
  NUM_MAGIC_ELEMENTAL: 5,
  /**
   * maximum number of enemies in a team
   * @memberof Const
   */
  MAX_ENEMIES_IN_TEAM: 5,
  /**
   * maximum number of equipments for a player
   * @memberof Const
   */
  MAX_PLAYER_EQUIPMENTS: 6,
  /**
   * maximum number of magics for a player
   * @memberof Const
   */
  MAX_PLAYER_MAGICS: 32,
  /**
   * maximum number of scenes
   * @memberof Const
   */
  MAX_SCENES: 300,
  /**
   * maximum number of objects
   * @memberof Const
   */
  MAX_OBJECTS: 600,
  /**
   * maximum number of event objects (should be somewhat more than the original,
   * as there are some modified versions which has more)
   * @memberof Const
   */
  MAX_EVENT_OBJECTS: 5500,
  /**
   * maximum number of effective poisons to players
   * @memberof Const
   */
  MAX_POISONS: 16,
  /**
   * maximum number of level
   * @memberof Const
   */
  MAX_LEVELS: 99,

  /**
   * maximum number of action queue items (computed at runtime)
   * @memberof Const
   */
  MAX_ACTIONQUEUE_ITEMS: 0,

  PAL_ADDITIONAL_WORD_FIRST: 10000
};

/**
 * 按键定义
 * @global
 * @enum {number}
 */
export const Key = globalAny.Key = {
  Menu:             1, // (1 << 0),
  Search:           2, // (1 << 1),
  Down:             4, // (1 << 2),
  Left:             8, // (1 << 3),
  Up:              16, // (1 << 4),
  Right:           32, // (1 << 5),
  PageUp:          64, // (1 << 6),
  PageDown:       128, // (1 << 7),
  Repeat:         256, // (1 << 8),
  Auto:           512, // (1 << 9),
  Defend:        1024, // (1 << 10),
  UseItem:       2048, // (1 << 11),
  ThrowItem:     4096, // (1 << 12),
  Flee:          8192, // (1 << 13),
  Status:       16384, // (1 << 14),
  Force:        32768  // (1 << 15)
};

/**
 * 方向定义
 * @global
 * @enum {number}
 */
export const Direction = globalAny.Direction = {
  South:    0,
  West:     1,
  North:    2,
  East:     3,
  Unknown:  4
};

/**
 * 角色状态定义
 * @global
 * @enum {number}
 */
export const PlayerStatus = globalAny.PlayerStatus = {
  /** 狂乱 */
  Confused:      0,          // attack friends r
  /** 瘫痪 PAL_CLASSIC */
  Paralyzed:     1,          // paralyzed
  /** 减速 NOT PAL_CLASSIC*/
  Slow:          1,          // slower
  /** 睡眠 */
  Sleep:         2,          // not allowed to move
  /** 沉默 */
  Silence:       3,          // cannot use magic
  /** for dead players only, continue attacking */
  Puppet:        4,          // for dead players only, continue attacking
  /** 物理ATT up */
  Bravery:       5,          // more power for physical attacks
  /** DEF up */
  Protect:       6,          // more defense value
  /** 加速 */
  Haste:         7,          // faster
  /** 两次攻击 */
  DualAttack:    8,          // dual attack
  /** All... */
  All:           9
};

/**
 * 物体状态定义
 * state of event object, used by the sState field of the EVENTOBJECT struct
 * @global
 * @enum {number}
 */
export const ObjectState = globalAny.ObjectState = {
  Hidden:        0,
  Normal:        1,
  Blocker:       2
};

/**
 * 身体部位定义
 * @global
 * @enum {number}
 */
export const BodyPart = globalAny.BodyPart = {
  Head:          0,
  Body:          1,
  Shoulder:      2,
  Hand:          3,
  Feet:          4,
  Wear:          5,
  Extra:         6,
};

/**
 * 触发模式定义
 * @global
 * @enum {number}
 */
export const TriggerMode = globalAny.TriggerMode = {
  None:          0,
  SearchNear:    1,
  SearchNormal:  2,
  SearchFar:     3,
  TouchNear:     4,
  TouchNormal:   5,
  TouchFar:      6,
  TouchFarther:  7,
  TouchFarthest: 8
};

/**
 * 物品标识位定义
 * 举个例子，
 * 腌肉：2DH = 1+4+8+32，
 * 所以腌肉可使用，不可装备，可投掷，使用有损耗，需要选择对象，可典当，谁都不可装备
 * 圣灵珠：293H = 1+2+16+128+512，
 * 所以圣灵珠可使用，可装备，不可投掷，使用不损耗，无须选择对象，不可典当，赵灵儿和巫后可装备
 * @global
 * @enum {number}
 */
export const ItemFlag = globalAny.ItemFlag = {
  /** 可使用，在“使用”菜单里亮白显示 */
  Usable:                            1, // (1 << 0),
  /** 可装备，在“装备”菜单里亮白显示 */
  Equipable:                         2, // (1 << 1),
  /** 可投掷，在“投掷”菜单里亮白显示 */
  Throwable:                         4, // (1 << 2),
  /** 使用不损耗，使用后物品不减少 */
  Consuming:                         8, // (1 << 3),
  /** 无须选择对象，在使用和投掷时无须选择对象，一般是全体作用的物品 */
  ApplyToAll:                       16, // (1 << 4),
  /** 可典当 */
  Sellable:                         32, // (1 << 5),
  /** 李逍遥可装备 */
  EquipableByPlayerRole_First:      64, // (1 << 6),
  /** 赵灵儿可装备 */
  EquipableByPlayerRole_Second:    128, // (1 << 7),
  /** 林月如可装备 */
  EquipableByPlayerRole_Thrid:     256, // (1 << 8),
  /** 巫后可装备 */
  EquipableByPlayerRole_Fourth:    512, // (1 << 9),
  /** 阿奴可装备 */
  EquipableByPlayerRole_Fifth:    1024, // (1 << 10),
  /** 盖罗娇可装备？这个没有试过 */
  EquipableByPlayerRole_Sixth:    2048  // (1 << 11)
};

/**
 * 法术标识位定义
 * @global
 * @enum {number}
 */
export const MagicFlag = globalAny.MagicFlag = {
  /** 平时可施放，在地图上可施放 */
  UsableOutsideBattle:         1, // (1 << 0),
  /** 战时可施放，在战场上可施放 */
  UsableInBattle:              2, // (1 << 1),
  /** 未知 */
  Unknown:                     4,
  /** 作用对象是敌方 */
  UsableToEnemy:               8, // (1 << 3),
  /** 无须选择对象，一般是全体作用的仙术 */
  ApplyToAll:                 16  // (1 << 4)
};

/**
 * 法术类型定义
 * @global
 * @enum {number}
 */
export const MagicType = globalAny.MagicType = {
  Normal:            0,
  AttackAll:         1,  // draw the effect on each of the enemies
  AttackWhole:       2,  // draw the effect on the whole enemy team
  AttackField:       3,  // draw the effect on the battle field
  ApplyToPlayer:     4,  // the magic is used on one player
  ApplyToParty:      5,  // the magic is used on the whole party
  Trance:            8,  // trance the player
  Summon:            9   // summon
};

/**
 * 颜色定义（UI用）
 * @global
 * @enum {number}
 */
export const NumColor = globalAny.NumColor = {
  Yellow:  0,
  Blue:    1,
  Cyan:    2
};

/**
 * 对齐定义
 * @global
 * @enum {number}
 */
export const NumAlign = globalAny.NumAlign = {
  Left:   0,
  Mid:    1,
  Right:  2
};

/**
 * 对话框位置定义
 * @global
 * @enum {number}
 */
export const DialogPosition = globalAny.DialogPosition = {
  Upper:        0,
  Center:       1,
  Lower:        2,
  CenterWindow: 3
};

/**
 * 战斗指令
 * @global
 * @enum {number}
 */
globalScope.BattleAction = {
};

/**
 * 战斗状态
 * @global
 * @enum {number}
 */
globalAny.FighterState = {

};

/**
 * 资源加载标识位
 * @global
 * @enum {number}
 */
globalScope.LoadFlag = {
  Scene          : (1 << 0),    // load a scene
  PlayerSprite   : (1 << 1),    // load player sprites
  GlobalData     : (1 << 2)     // load global data
};

export const EventObject = globalScope.EventObject = defineStruct(
  /*
  SHORT        sVanishTime;         // vanish time (?)
  WORD         x;                   // X coordinate on the map
  WORD         y;                   // Y coordinate on the map
  SHORT        sLayer;              // layer value
  WORD         wTriggerScript;      // Trigger script entry
  WORD         wAutoScript;         // Auto script entry
  SHORT        sState;              // state of this object
  WORD         wTriggerMode;        // trigger mode
  WORD         wSpriteNum;          // number of the sprite
  USHORT       nSpriteFrames;       // total number of frames of the sprite
  WORD         wDirection;          // direction
  WORD         wCurrentFrameNum;    // current frame number
  USHORT       nScriptIdleFrame;    // count of idle frames, used by trigger script
  WORD         wSpritePtrOffset;    // FIXME: ???
  USHORT       nSpriteFramesAuto;   // total number of frames of the sprite, used by auto script
  WORD         wScriptIdleFrameCountAuto;     // count of idle frames, used by auto script
  } EVENTOBJECT, *LPEVENTOBJECT;
  */
  'EventObject',
  `vanishTime|SHORT x|WORD y|WORD layer|SHORT triggerScript|WORD
  autoScript|WORD state|SHORT triggerMode|WORD spriteNum|WORD spriteFrames|USHORT
  direction|WORD currentFrameNum|WORD scriptIdleFrame|USHORT spritePtrOffset|WORD spriteFramesAuto|USHORT
  scriptIdleFrameCountAuto|WORD`
);

export const Scene = globalScope.Scene = defineStruct(
  /*
  WORD         wMapNum;         // number of the map
  WORD         wScriptOnEnter;  // when entering this scene, execute script from here
  WORD         wScriptOnTeleport;  // when teleporting out of this scene, execute script from here
  WORD         wEventObjectIndex;  // event objects in this scene begins from number wEventObjectIndex + 1
  */
  'Scene',
  'mapNum|WORD scriptOnEnter|WORD scriptOnTeleport|WORD eventObjectIndex|WORD'
);

globalScope.PlayerObject = defineStruct(
  /*
  WORD         wReserved[2];    // always zero
  WORD         wScriptOnFriendDeath; // when friends in party dies, execute script from here
  WORD         wScriptOnDying;  // when dying, execute script from here
  */
  'PlayerObject',
  'reserved|WORD*2 scriptOnFriendDeath|WORD scriptOnDying|WORD'
);

globalScope.ItemObject = defineStruct(
  /*
  WORD         wBitmap;         // bitmap number in BALL.MKF
  WORD         wPrice;          // price
  WORD         wScriptOnUse;    // script executed when using this item
  WORD         wScriptOnEquip;  // script executed when equipping this item
  WORD         wScriptOnThrow;  // script executed when throwing this item to enemy
  WORD         wFlags;          // flags
  */
  'ItemObject',
  'bitmap|WORD price|WORD scriptOnUse|WORD scriptOnEquip|WORD scriptOnThrow|WORD flags|WORD'
);

globalScope.MagicObject = defineStruct(
  /*
  WORD         wMagicNumber;      // magic number, according to DATA.MKF #3
  WORD         wReserved1;        // always zero
  WORD         wScriptOnSuccess;  // when magic succeed, execute script from here
  WORD         wScriptOnUse;      // when use this magic, execute script from here
  WORD         wReserved2;        // always zero
  WORD         wFlags;            // flags
  */
  'MagicObject',
  'magicNumber|WORD reserved1|WORD scriptOnSuccess|WORD scriptOnUse|WORD reserved2|WORD flags|WORD'
);

globalScope.EnemyObject = defineStruct(
  /*
  WORD         wEnemyID;              // ID of the enemy, according to DATA.MKF #1.
                                      // Also indicates the bitmap number in ABC.MKF.
  WORD         wResistanceToSorcery;  // resistance to sorcery and poison (0 min, 10 max)
  WORD         wScriptOnTurnStart;    // script executed when turn starts
  WORD         wScriptOnBattleEnd;    // script executed when battle ends
  WORD         wScriptOnReady;        // script executed when the enemy is ready
  */
  'EnemyObject',
  'enemyID|WORD resistanceToSorcery|WORD scriptOnTurnStart|WORD scriptOnBattleEnd|WORD scriptOnReady|WORD'
);

globalScope.PoisonObject = defineStruct(
  /*
  WORD         wPoisonLevel;    // level of the poison
  WORD         wColor;          // color of avatars
  WORD         wPlayerScript;   // script executed when player has this poison (per round)
  WORD         wReserved;       // always zero
  WORD         wEnemyScript;    // script executed when enemy has this poison (per round)
  */
  'PoisonObject',
  'poisonLevel|WORD color|WORD playerScript|WORD reserved|WORD enemyScript|WORD'
);

export const ObjectUnion = globalScope.ObjectUnion = defineStruct(
  'ObjectUnion',
  'data|WORD*6'
);

'PlayerObject ItemObject MagicObject EnemyObject PoisonObject'.split(' ').forEach(function(type){
  var name = type.toLowerCase().substr(0, type.length - 6);
  var key = '__' + name + '__';
  Object.defineProperty(ObjectUnion.prototype, name, {
    get: function(){
      var ret = (this as any)[key];
      if (!ret){
        ret = new globalScope[type]((this as any).data);
        (this as any)[key] = ret;
      }
      return ret;
    }
  });
});

export const ScriptEntry = globalScope.ScriptEntry = defineStruct(
  /*
  WORD          wOperation;     // operation code
  WORD          rgwOperand[3];  // operands
  */
  'ScriptEntry',
  'operation|WORD operand|WORD*3'
);

export const Inventory = globalScope.Inventory = defineStruct(
  /*
  WORD          wItem;             // item object code
  USHORT        nAmount;           // amount of this item
  USHORT        nAmountInUse;      // in-use amount of this item
  */
  'Inventory',
  'item|WORD amount|USHORT amountInUse|SHORT'
);

export const Store = globalScope.Store = defineStruct(
  /*
  WORD          rgwItems[MAX_STORE_ITEM];
  */
  'Store',
  'items|WORD*'+Const.MAX_STORE_ITEM
);

export const Enemy = globalScope.Enemy = defineStruct(
  /*
  WORD        wIdleFrames;         // total number of frames when idle
  WORD        wMagicFrames;        // total number of frames when using magics
  WORD        wAttackFrames;       // total number of frames when doing normal attack
  WORD        wIdleAnimSpeed;      // speed of the animation when idle
  WORD        wActWaitFrames;      // FIXME: ???
  WORD        wYPosOffset;
  WORD        wAttackSound;        // sound played when this enemy uses normal attack
  WORD        wActionSound;        // FIXME: ???
  WORD        wMagicSound;         // sound played when this enemy uses magic
  WORD        wDeathSound;         // sound played when this enemy dies
  WORD        wCallSound;          // sound played when entering the battle
  WORD        wHealth;             // total HP of the enemy
  WORD        wExp;                // How many EXPs we'll get for beating this enemy
  WORD        wCash;               // how many cashes we'll get for beating this enemy
  WORD        wLevel;              // this enemy's level
  WORD        wMagic;              // this enemy's magic number
  WORD        wMagicRate;          // chance for this enemy to use magic
  WORD        wAttackEquivItem;    // equivalence item of this enemy's normal attack
  WORD        wAttackEquivItemRate;// chance for equivalence item
  WORD        wStealItem;          // which item we'll get when stealing from this enemy
  USHORT      nStealItem;          // total amount of the items which can be stolen
  WORD        wAttackStrength;     // normal attack strength
  WORD        wMagicStrength;      // magical attack strength
  WORD        wDefense;            // resistance to all kinds of attacking
  WORD        wDexterity;          // dexterity
  WORD        wFleeRate;           // chance for successful fleeing
  WORD        wPoisonResistance;   // resistance to poison

  WORD        wElemResistance[NUM_MAGIC_ELEMENTAL]; // resistance to elemental magics

  WORD        wPhysicalResistance; // resistance to physical attack
  WORD        wDualMove;           // whether this enemy can do dual move or not
  WORD        wCollectValue;       // value for collecting this enemy for items
  */
  'Enemy',
  'idleFrames|WORD magicFrames|WORD attackFrames|WORD idleAnimSpeed|WORD actWaitFrames|WORD ' +
  'yPosOffset|WORD attackSound|WORD actionSound|WORD magicSound|WORD deathSound|WORD ' +
  'callSound|WORD health|WORD exp|WORD cash|WORD level|WORD ' +
  'magic|WORD magicRate|WORD attackEquivItem|WORD attackEquivItemRate|WORD stealItem|WORD ' +
  'stealItemNum|USHORT attackStrength|WORD magicStrength|WORD defense|WORD dexterity|WORD ' +
  'fleeRate|WORD poisonResistance|WORD ' +
  'elemResistance|WORD*'+Const.NUM_MAGIC_ELEMENTAL+' ' +
  'physicalResistance|WORD dualMove|WORD collectValue|WORD'
);

export const EnemyTeam = globalScope.EnemyTeam = defineStruct(
  /*
  WORD        rgwEnemy[MAX_ENEMIES_IN_TEAM];
  */
  'EnemyTeam',
  'enemy|WORD*' + Const.MAX_ENEMIES_IN_TEAM
);

export const PlayerRoles = globalScope.PlayerRoles = defineStruct(
  // typedef WORD PLAYERS[MAX_PLAYER_ROLES];
  /*
  PLAYERS            rgwAvatar;             // avatar (shown in status view)
  PLAYERS            rgwSpriteNumInBattle;  // sprite displayed in battle (in F.MKF)
  PLAYERS            rgwSpriteNum;          // sprite displayed in normal scene (in MGO.MKF)
  PLAYERS            rgwName;               // name of player class (in WORD.DAT)
  PLAYERS            rgwAttackAll;          // whether player can attack everyone in a bulk or not
  PLAYERS            rgwUnknown1;           // FIXME: ???
  PLAYERS            rgwLevel;              // level
  PLAYERS            rgwMaxHP;              // maximum HP
  PLAYERS            rgwMaxMP;              // maximum MP
  PLAYERS            rgwHP;                 // current HP
  PLAYERS            rgwMP;                 // current MP
  WORD               rgwEquipment[MAX_PLAYER_EQUIPMENTS][MAX_PLAYER_ROLES]; // equipments
  PLAYERS            rgwAttackStrength;     // normal attack strength
  PLAYERS            rgwMagicStrength;      // magical attack strength
  PLAYERS            rgwDefense;            // resistance to all kinds of attacking
  PLAYERS            rgwDexterity;          // dexterity
  PLAYERS            rgwFleeRate;           // chance of successful fleeing
  PLAYERS            rgwPoisonResistance;   // resistance to poison
  WORD               rgwElementalResistance[NUM_MAGIC_ELEMENTAL][MAX_PLAYER_ROLES]; // resistance to elemental magics
  PLAYERS            rgwUnknown2;           // FIXME: ???
  PLAYERS            rgwUnknown3;           // FIXME: ???
  PLAYERS            rgwUnknown4;           // FIXME: ???
  PLAYERS            rgwCoveredBy;          // who will cover me when I am low of HP or not sane
  WORD               rgwMagic[MAX_PLAYER_MAGICS][MAX_PLAYER_ROLES]; // magics
  PLAYERS            rgwWalkFrames;         // walk frame (???)
  PLAYERS            rgwCooperativeMagic;   // cooperative magic
  PLAYERS            rgwUnknown5;           // FIXME: ???
  PLAYERS            rgwUnknown6;           // FIXME: ???
  PLAYERS            rgwDeathSound;         // sound played when player dies
  PLAYERS            rgwAttackSound;        // sound played when player attacks
  PLAYERS            rgwWeaponSound;        // weapon sound (???)
  PLAYERS            rgwCriticalSound;      // sound played when player make critical hits
  PLAYERS            rgwMagicSound;         // sound played when player is casting a magic
  PLAYERS            rgwCoverSound;         // sound played when player cover others
  PLAYERS            rgwDyingSound;         // sound played when player is dying
  */
  'PlayerRoles',
  ['avatar|WORD*' + Const.MAX_PLAYER_ROLES,
   'spriteNumInBattle|WORD*' + Const.MAX_PLAYER_ROLES,
   'spriteNum|WORD*' + Const.MAX_PLAYER_ROLES,
   'name|WORD*' + Const.MAX_PLAYER_ROLES,
   'attackAll|WORD*' + Const.MAX_PLAYER_ROLES,
   'unknown1|WORD*' + Const.MAX_PLAYER_ROLES,
   'level|WORD*' + Const.MAX_PLAYER_ROLES,
   'maxHP|WORD*' + Const.MAX_PLAYER_ROLES,
   'maxMP|WORD*' + Const.MAX_PLAYER_ROLES,
   'HP|WORD*' + Const.MAX_PLAYER_ROLES,
   'MP|WORD*' + Const.MAX_PLAYER_ROLES,
   'equipment|WORD*' + Const.MAX_PLAYER_EQUIPMENTS + '*' + Const.MAX_PLAYER_ROLES,
   'attackStrength|WORD*' + Const.MAX_PLAYER_ROLES,
   'magicStrength|WORD*' + Const.MAX_PLAYER_ROLES,
   'defense|WORD*' + Const.MAX_PLAYER_ROLES,
   'dexterity|WORD*' + Const.MAX_PLAYER_ROLES,
   'fleeRate|WORD*' + Const.MAX_PLAYER_ROLES,
   'poisonResistance|WORD*' + Const.MAX_PLAYER_ROLES,
   'elementalResistance|WORD*' + Const.NUM_MAGIC_ELEMENTAL + '*' + Const.MAX_PLAYER_ROLES,
   'unknownWORD|WORD*' + Const.MAX_PLAYER_ROLES,
   'unknown3|WORD*' + Const.MAX_PLAYER_ROLES,
   'unknown4|WORD*' + Const.MAX_PLAYER_ROLES,
   'coveredBy|WORD*' + Const.MAX_PLAYER_ROLES,
   'magic|WORD*' + Const.MAX_PLAYER_MAGICS + '*' + Const.MAX_PLAYER_ROLES,
   'walkFrames|WORD*' + Const.MAX_PLAYER_ROLES,
   'cooperativeMagic|WORD*' + Const.MAX_PLAYER_ROLES,
   'unknown5|WORD*' + Const.MAX_PLAYER_ROLES,
   'unknown6|WORD*' + Const.MAX_PLAYER_ROLES,
   'deathSound|WORD*' + Const.MAX_PLAYER_ROLES,
   'attackSound|WORD*' + Const.MAX_PLAYER_ROLES,
   'weaponSound|WORD*' + Const.MAX_PLAYER_ROLES,
   'criticalSound|WORD*' + Const.MAX_PLAYER_ROLES,
   'magicSound|WORD*' + Const.MAX_PLAYER_ROLES,
   'coverSound|WORD*' + Const.MAX_PLAYER_ROLES,
   'dyingSound|WORD*' + Const.MAX_PLAYER_ROLES].join('\n')
);

export const Magic = globalScope.Magic = defineStruct(
  /*
  WORD               wEffect;               // effect sprite
  WORD               wType;                 // type of this magic
  WORD               wXOffset;
  WORD               wYOffset;
  WORD               wSummonEffect;         // summon effect sprite (in F.MKF)
  WORD               wSpeed;                // speed of the effect
  WORD               wKeepEffect;           // FIXME: ???
  WORD               wSoundDelay;           // delay of the SFX
  WORD               wEffectTimes;          // total times of effect
  WORD               wShake;                // shake screen
  WORD               wWave;                 // wave screen
  WORD               wUnknown;              // FIXME: ???
  WORD               wCostMP;               // MP cost
  WORD               wBaseDamage;           // base damage
  WORD               wElemental;            // elemental (0 = No Elemental, last = poison)
  WORD               wSound;                // sound played when using this magic
  */
  'Magic',
  `effect|WORD type|WORD offsetX|WORD offsetY|WORD summonEffect|WORD
  speed|WORD keepEffect|WORD soundDelay|WORD effectTimes|WORD shake|WORD
  wave|WORD unknown|WORD costMP|WORD baseDamage|WORD elemental|WORD
  sound|WORD`
);

export const BattleField = globalScope.BattleField = defineStruct(
  /*
  WORD               wScreenWave;                      // level of screen waving
  SHORT              rgsMagicEffect[NUM_MAGIC_ELEMENTAL]; // effect of attributed magics
  */
  'BattleField',
  'screenWave|WORD magicEffect|SHORT*' + Const.NUM_MAGIC_ELEMENTAL
);

// magics learned when level up
globalScope.LevelUpMagic = defineStruct(
  /*
  WORD               wLevel;    // level reached
  WORD               wMagic;    // magic learned
  */
  'LevelUpMagic',
  'level|WORD magic|WORD'
);

export const LevelUpMagicAll = globalScope.LevelUpMagicAll = defineStruct(
  /*
  LEVELUPMAGIC       m[MAX_PLAYABLE_PLAYER_ROLES];
  */
  'LevelUpMagicAll',
  'm|@LevelUpMagic*' + Const.MAX_PLAYABLE_PLAYER_ROLES
);

globalScope.EnemyPosUnit = defineStruct(
  'EnemyPosUnit',
  'x|WORD y|WORD'
);
export const EnemyPos = globalScope.EnemyPos = defineStruct(
  /*
  typedef struct tagENEMYPOS
{
   struct {
      WORD      x;
      WORD      y;
   } pos[MAX_ENEMIES_IN_TEAM][MAX_ENEMIES_IN_TEAM];
} ENEMYPOS, *LPENEMYPOS;
   */
  'EnemyPos',
  'pos|@EnemyPosUnit*' + Const.MAX_ENEMIES_IN_TEAM + '*' + Const.MAX_ENEMIES_IN_TEAM
);

// player party
export const Party = globalScope.Party = defineStruct(
  /*
  WORD             wPlayerRole;         // player role
  SHORT            x, y;                // position
  WORD             wFrame;              // current frame number
  WORD             wImageOffset;        // FIXME: ???
  */
  'Party',
  'playerRole|WORD x|SHORT y|SHORT frame|WORD imageOffset|WORD'
);

// player trail, used for other party members to follow the main party member
export const Trail = globalScope.Trail = defineStruct(
  /*
  WORD             x, y;          // position
  WORD             wDirection;    // direction
  */
  'Trail',
  'x|WORD y|WORD direction|WORD'
);

globalScope.Experience = defineStruct(
  /*
  WORD         wExp;                // current experience points
  WORD         wReserved;
  WORD         wLevel;              // current level
  WORD         wCount;
  */
  'Experience',
  'exp|WORD reserved|WORD level|WORD count|WORD'
);

var experienceTypes = 'primaryExp healthExp magicExp attackExp magicPowerExp defenseExp dexterityExp fleeExp'.split(' ');
export const AllExperience = globalScope.AllExperience = defineStruct(
  /*
  typedef struct tagALLEXPERIENCE
{
   EXPERIENCE        rgPrimaryExp[MAX_PLAYER_ROLES];
   EXPERIENCE        rgHealthExp[MAX_PLAYER_ROLES];
   EXPERIENCE        rgMagicExp[MAX_PLAYER_ROLES];
   EXPERIENCE        rgAttackExp[MAX_PLAYER_ROLES];
   EXPERIENCE        rgMagicPowerExp[MAX_PLAYER_ROLES];
   EXPERIENCE        rgDefenseExp[MAX_PLAYER_ROLES];
   EXPERIENCE        rgDexterityExp[MAX_PLAYER_ROLES];
   EXPERIENCE        rgFleeExp[MAX_PLAYER_ROLES];
} ALLEXPERIENCE, *LPALLEXPERIENCE;
   */
  'AllExperience',
  experienceTypes.map(function(exp){
    return exp + '|@Experience*' + Const.MAX_PLAYER_ROLES
  }).join(' ')
);
globalScope.AllExperience.types = experienceTypes;

export const PoisonStatus = globalAny.PoisonStatus = defineStruct(
  /*
  WORD              wPoisonID;       // kind of the poison
  WORD              wPoisonScript;   // script entry
  */
  'PoisonStatus',
  'poisonID|WORD poisonScript|WORD'
);

export const SaveData = globalScope.SaveData = defineStruct(
/*
   WORD             wSavedTimes;             // saved times
   WORD             wViewportX, wViewportY;  // viewport location
   WORD             nPartyMember;            // number of members in party
   WORD             wNumScene;               // scene number
   WORD             wPaletteOffset;
   WORD             wPartyDirection;         // party direction
   WORD             wNumMusic;               // music number
   WORD             wNumBattleMusic;         // battle music number
   WORD             wNumBattleField;         // battle field number
   WORD             wScreenWave;             // level of screen waving
   WORD             wBattleSpeed;            // battle speed
   WORD             wCollectValue;           // value of "collected" items
   WORD             wLayer;
   WORD             wChaseRange;
   WORD             wChasespeedChangeCycles;
   WORD             nFollower;
   WORD             rgwReserved2[3];         // unused
   DWORD            dwCash;                  // amount of cash
   PARTY            rgParty[MAX_PLAYABLE_PLAYER_ROLES];       // player party
   TRAIL            rgTrail[MAX_PLAYABLE_PLAYER_ROLES];       // player trail
   ALLEXPERIENCE    Exp;                     // experience data
   PLAYERROLES      PlayerRoles;
   POISONSTATUS     rgPoisonStatus[MAX_POISONS][MAX_PLAYABLE_PLAYER_ROLES]; // poison status
   INVENTORY        rgInventory[MAX_INVENTORY];               // inventory status
   SCENE            rgScene[MAX_SCENES];
   OBJECT           rgObject[MAX_OBJECTS];
   EVENTOBJECT      rgEventObject[MAX_EVENT_OBJECTS];
   */
  'SaveData',
  ['savedTimes|WORD',
   'viewportX|WORD',
   'viewportY|WORD',
   'numPartyMember|WORD',
   'numScene|WORD',
   'paletteOffset|WORD',
   'partyDirection|WORD',
   'numMusic|WORD',
   'numBattleMusic|WORD',
   'numBattleField|WORD',
   'screenWave|WORD',
   'battleSpeed|WORD',
   'collectValue|WORD',
   'layer|WORD',
   'chaseRange|WORD',
   'chaseSpeedChangeCycles|WORD',
   'numFollower|WORD',
   'reserved2|WORD*3',
   'cash|DWORD',
   'party|@Party*' + Const.MAX_PLAYABLE_PLAYER_ROLES,
   'trail|@Trail*' + Const.MAX_PLAYABLE_PLAYER_ROLES,
   'exp|@AllExperience',
   'playerRoles|@PlayerRoles',
   'poisonStatus|@PoisonStatus*' + Const.MAX_POISONS + '*' + Const.MAX_PLAYABLE_PLAYER_ROLES,
   'inventory|@Inventory*' + Const.MAX_INVENTORY,
   'scene|@Scene*' + Const.MAX_SCENES,
   'object|@ObjectUnion*' + Const.MAX_OBJECTS,
   'eventObject|@EventObject*' + Const.MAX_EVENT_OBJECTS].join('\n')
);

var GlobalVars = defineStruct(
  /*
  typedef struct tagGLOBALVARS
{
   FILES            f;
   GAMEDATA         g;

   BYTE             bCurrentSaveSlot;    // current save slot (1-5)
   int              iCurMainMenuItem;    // current main menu item number
   int              iCurSystemMenuItem;  // current system menu item number
   int              iCurInvMenuItem;     // current inventory menu item number
   int              iCurPlayingRNG;      // current playing RNG animation
   BOOL             fGameStart;          // TRUE if the has just started
   BOOL             fEnteringScene;      // TRUE if entering a new scene
   BOOL             fNeedToFadeIn;       // TRUE if need to fade in when drawing scene
   BOOL             fInBattle;           // TRUE if in battle
   BOOL             fAutoBattle;         // TRUE if auto-battle
#ifndef PAL_CLASSIC
   BYTE             bBattleSpeed;        // Battle Speed (1 = Fastest, 5 = Slowest)
#endif
   WORD             wLastUnequippedItem; // last unequipped item

   PLAYERROLES      rgEquipmentEffect[MAX_PLAYER_EQUIPMENTS + 1]; // equipment effects
   WORD             rgPlayerStatus[MAX_PLAYER_ROLES][kStatusAll]; // player status

   PAL_POS          viewport;            // viewport coordination
   PAL_POS          partyoffset;
   WORD             wLayer;
   WORD             wMaxPartyMemberIndex;// max index of members in party (0 to MAX_PLAYERS_IN_PARTY - 1)
   PARTY            rgParty[MAX_PLAYABLE_PLAYER_ROLES]; // player party
   TRAIL            rgTrail[MAX_PLAYABLE_PLAYER_ROLES]; // player trail
   WORD             wPartyDirection;     // direction of the party
   WORD             wNumScene;           // current scene number
   WORD             wNumPalette;         // current palette number
   BOOL             fNightPalette;       // TRUE if use the darker night palette
   WORD             wNumMusic;           // current music number
   WORD             wNumBattleMusic;     // current music number in battle
   WORD             wNumBattleField;     // current battle field number
   WORD             wCollectValue;       // value of "collected" items
   WORD             wScreenWave;         // level of screen waving
   SHORT            sWaveProgression;
   WORD             wChaseRange;
   WORD             wChasespeedChangeCycles;
   USHORT           nFollower;

   DWORD            dwCash;              // amount of cash

   ALLEXPERIENCE    Exp;                 // experience status
   POISONSTATUS     rgPoisonStatus[MAX_POISONS][MAX_PLAYABLE_PLAYER_ROLES]; // poison status
   INVENTORY        rgInventory[MAX_INVENTORY];  // inventory status

   LPOBJECTDESC     lpObjectDesc;

   DWORD            dwFrameNum;
} GLOBALVARS, *LPGLOBALVARS;
   */
  'GlobalVars',
  ['currentSaveSlot|BYTE',
   'curMainMenuItem|INT',
   'curSystemMenuItem|INT',
   'curInvMenuItem|INT',
   'curPlayingRNG|INT',
   //'gameStart|BOOL',
   //'enteringScene|BOOL',
   //'needToFadeIn|BOOL',
   //'inBattle|BOOL',
   //'autoBattle|BOOL',
   (PAL_CLASSIC ? 'battleSpeed|BYTE' : ''),
   'lastUnequippedItem|WORD',
   'equipmentEffect|@PlayerRoles*' + (Const.MAX_PLAYER_EQUIPMENTS + 1),
   'playerStatus|WORD*' + Const.MAX_PLAYER_ROLES + '*' + globalAny.PlayerStatus.All,
   //'viewport|DWORD',
   //'partyOffset|DWORD',
   'layer|WORD',
   'maxPartyMemberIndex|WORD',
   'party|@Party*' + Const.MAX_PLAYABLE_PLAYER_ROLES,
   'trail|@Trail*' + Const.MAX_PLAYABLE_PLAYER_ROLES,
   'partyDirection|WORD',
   'numScene|WORD',
   'numPalette|WORD',
   //'nightPalette|BOOL',
   'numMusic|WORD',
   'numBattleMusic|WORD',
   'numBattleField|WORD',
   'collectValue|WORD',
   'screenWave|WORD',
   'waveProgression|SHORT',
   'chaseRange|WORD',
   'chaseSpeedChangeCycles|WORD',
   'numFollower|USHORT',
   'cash|DWORD',
   'exp|@AllExperience',
   'poisonStatus|@PoisonStatus*' + Const.MAX_POISONS + '*' + Const.MAX_PLAYABLE_PLAYER_ROLES,
   'inventory|@Inventory*' + Const.MAX_INVENTORY].join(' ')
);
Object.defineProperties(GlobalVars.prototype, {
});

var Global = globalAny.Global = new GlobalVars();
//var Global = global.Global = {};

var DEFAULT_MAX_SPRITE_TO_DRAW = 2048;
var MAX_SPRITE_STATE_KEY = 'MAX_SPRITE_TO_DRAW';
var LEGACY_SPRITE_LIMIT_KEY = '__PAL_LEGACY_MAX_SPRITE__';

var legacyMaxSpriteLimit = DEFAULT_MAX_SPRITE_TO_DRAW;
var legacyStore = (globalAny && globalAny.Global) ? globalAny.Global : null;
if (legacyStore && typeof legacyStore[MAX_SPRITE_STATE_KEY] === 'number' && Number.isFinite(legacyStore[MAX_SPRITE_STATE_KEY])) {
  legacyMaxSpriteLimit = Math.trunc(legacyStore[MAX_SPRITE_STATE_KEY]);
}
if (typeof globalThis !== 'undefined') {
  (globalThis as any)[LEGACY_SPRITE_LIMIT_KEY] = legacyMaxSpriteLimit;
}

function resolveWorldService() {
  if (typeof globalThis !== 'undefined' && (globalThis as any).services && (globalThis as any).services.world) {
    return (globalThis as any).services.world;
  }
  if (typeof globalScope !== 'undefined' && globalScope.services && globalScope.services.world) {
    return globalScope.services.world;
  }
  return null;
}

Object.defineProperty(Global, 'MAX_SPRITE_TO_DRAW', {
  configurable: true,
  enumerable: true,
  get: function() {
    var world = resolveWorldService();
    if (world && typeof world.getMaxSpriteDrawLimit === 'function') {
      return world.getMaxSpriteDrawLimit();
    }
    if (typeof globalThis !== 'undefined' && typeof (globalThis as any)[LEGACY_SPRITE_LIMIT_KEY] === 'number') {
      return (globalThis as any)[LEGACY_SPRITE_LIMIT_KEY];
    }
    return legacyMaxSpriteLimit;
  },
  set: function(nextValue) {
    var normalized = Number.isFinite(nextValue) ? Math.trunc(nextValue) : DEFAULT_MAX_SPRITE_TO_DRAW;
    var world = resolveWorldService();
    if (world && typeof world.setMaxSpriteDrawLimit === 'function') {
      world.setMaxSpriteDrawLimit(normalized);
    } else {
      legacyMaxSpriteLimit = normalized;
      if (typeof globalThis !== 'undefined') {
        (globalThis as any)[LEGACY_SPRITE_LIMIT_KEY] = normalized;
      }
    }
  }
});

// game data which is available in data files.
export const GameData = globalAny.GameData = {};
export const Files: any = globalAny.Files = globalAny.Files || {};

export const LoadFlag = globalAny.LoadFlag = {
  Scene: 1,
  PlayerSprite: 2,
  GlobalData: 4
};

export function PAL_XY(x: number, y: number) {
  return (y << 16) | (x & 0xffff);
}
// SDLPAL: #define PAL_X(xy) (SHORT)((xy) & 0xFFFF) —— 有符号 16 位。写成无符号时,坐标一减到负数就
// 绕成 65xxx:敌人逃跑(0x0069)动画「滑出左边界才停」永远停不下来,剧情战卡死。
export function PAL_X(xy: number) {
  return (xy << 16) >> 16;
}
export function PAL_Y(xy: number) {
  return xy >> 16;
}

export default Global;
