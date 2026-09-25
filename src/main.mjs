/**
 * PF2e-KR 2.0 native-pack runtime.
 *
 * Translation data is baked into native Compendium packs during the build
 * step. Babele is not used at runtime.
 */

import {
  compareActorArt,
  diagnoseCompendiumArtBridge,
  installCompendiumArtBridge
} from "./compatibility/compendium-art.mjs";
import {
  applyRecommendedBrowserDefaults,
  getBrowserPackPlan,
  getMirrorPackPairs,
  resetBrowserPackSetting,
  showBrowserPackPlan
} from "./compatibility/browser-packs.mjs";
import {
  buildLateLocalizationCache,
  fixConditionGrants,
  installLateLocalization,
  localizeActorItems,
  localizeExistingItems,
  scanWorld
} from "./compatibility/late-localize.mjs";

const MODULE_ID = "PF2e-KR";

Hooks.once("init", () => {
  console.log("PF2e-KR | Native mirror packs initialized (Babele-free)");

  game.settings.register(MODULE_ID, "deactivate-animations-mapping", {
    name: "애니메이션 번역 자동 매핑 비활성화",
    hint: "번역된 아이템의 원문 이름을 사용하는 자동 애니메이션 매핑을 비활성화합니다.",
    scope: "world",
    type: Boolean,
    default: false,
    config: true,
    onChange: foundry.utils.debouncedReload
  });

  game.settings.registerMenu(MODULE_ID, "apply-browser-defaults", {
    name: "컴팬디움 브라우저 기본 팩 설정 적용",
    label: "지금 적용",
    hint: "PF2e 컴팬디움 브라우저(베스티어리/장비 등 탭)에서 PF2e 기본 영문 팩은 끄고, PF2e-KR 한글 미러 팩만 켜지도록 한 번에 설정합니다. 이후에도 브라우저 자체의 설정 탭에서 팩별로 다시 조정할 수 있습니다.",
    icon: "fas fa-language",
    type: ApplyBrowserDefaultsMenu,
    restricted: true
  });

  game.settings.register(MODULE_ID, "worldLocalizedVersion", { scope: "world", config: false, type: String, default: "" });
  game.settings.registerMenu(MODULE_ID, "localize-world", {
    name: "기존 월드 한글화",
    label: "지금 확인하기",
    hint: "이 월드에 이미 들어와 있는 캐릭터·NPC의 주문·아이템·제작 공식과 상태/효과 중 영문으로 남은 것을 찾아 한글판으로 바꿉니다.",
    icon: "fas fa-language",
    type: LocalizeWorldMenu,
    restricted: true
  });

  game.settings.register(MODULE_ID, "enable-compendium-art-bridge", {
    name: "PF2e 원본 토큰/포트레잇 매핑 호환",
    hint: "PF2e-KR의 NPC/Bestiary mirror pack이 동일 ID의 공식 PF2e pack에 등록된 Compendium Art를 사용하도록 합니다. 공식 및 서드파티 토큰 모듈의 Foundry V14 art mapping과 호환하기 위한 기능입니다.",
    scope: "world",
    type: Boolean,
    default: true,
    config: true,
    onChange: foundry.utils.debouncedReload
  });

  hookOnAutoAnimations();
});

// Install before normal play-time Compendium documents are requested. `ready`
// retries once in case the core manager was not yet exposed during setup.
// Conditions/effects PF2e creates from its English packs get Korean names at creation.
installLateLocalization();

Hooks.once("setup", () => {
  if (game.settings.get(MODULE_ID, "enable-compendium-art-bridge")) {
    installCompendiumArtBridge({ moduleId: MODULE_ID });
  }
});

/*
 * Existing worlds: after the module is switched on (or updated), the GM is
 * asked once whether to translate what is already in the world. Nothing is
 * changed without pressing the button.
 */
async function offerWorldLocalization({ force = false } = {}) {
  if (!game.user.isGM) return;
  const version = game.modules.get(MODULE_ID)?.version ?? "0";
  if (!force && game.settings.get(MODULE_ID, "worldLocalizedVersion") === version) return;
  const scan = scanWorld(MODULE_ID);
  if (!scan.total) {
    await game.settings.set(MODULE_ID, "worldLocalizedVersion", version);
    if (force) ui.notifications.info("PF2e-KR | 이 월드에는 한글화할 것이 없습니다.");
    return;
  }
  const line = (n, label) => (n ? `<li>${label} <b>${n}</b>개</li>` : "");
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "PF2e-KR | 기존 월드 한글화", icon: "fas fa-language" },
    content: `<p>이 월드에 모듈을 켜기 전부터 있던 캐릭터·NPC <b>${scan.actors}</b>명에게 아직 영문인 항목이 있습니다.</p>
      <ul>${line(scan.items, "주문·아이템·능력")}${line(scan.formulas, "제작 공식")}${line(scan.effects, "상태·효과")}${line(scan.grants, "고칠 상태 부여 규칙 (신속 등)")}</ul>
      <p>지금 한글판으로 바꿀까요? 이름·설명만 바뀌고 수치·규칙은 그대로입니다. 설정 → 모듈 설정 → <b>기존 월드 한글화</b>에서 언제든 다시 할 수 있습니다.</p>`,
    buttons: [
      { action: "apply", label: "지금 한글화", icon: "fas fa-check", default: true },
      { action: "later", label: "나중에", icon: "fas fa-clock" },
      { action: "never", label: "이 버전에서는 묻지 않기", icon: "fas fa-ban" }
    ],
    rejectClose: false
  }).catch(() => "later");
  if (choice === "never") return game.settings.set(MODULE_ID, "worldLocalizedVersion", version);
  if (choice !== "apply") return;
  ui.notifications.info("PF2e-KR | 한글화 중입니다… (액터가 많으면 잠시 걸립니다)");
  await fixConditionGrants(MODULE_ID);
  await localizeExistingItems();
  await localizeActorItems("world", MODULE_ID);
  await game.settings.set(MODULE_ID, "worldLocalizedVersion", version);
}

class LocalizeWorldMenu extends foundry.applications.api.ApplicationV2 {
  render() {
    offerWorldLocalization({ force: true });
    return this;
  }
}

Hooks.once("ready", () => {
  if (game.settings.get(MODULE_ID, "enable-compendium-art-bridge")) {
    installCompendiumArtBridge({ moduleId: MODULE_ID, log: false });
  }

  buildLateLocalizationCache(MODULE_ID).then(stats => {
    console.log(`${MODULE_ID} | late localization ready`, stats);
    // Ask about the existing world only once the Korean lookup is loaded.
    offerWorldLocalization();
  });

  game.PF2eKR = {
    moduleId: MODULE_ID,
    localizeExisting: localizeExistingItems,
    localizeActorItems: target => localizeActorItems(target, MODULE_ID),
    fixConditionGrants: () => fixConditionGrants(MODULE_ID),
    localizeWorld: () => offerWorldLocalization({ force: true }),
    resetPackFolders,
    mirrorUuid,
    originalNameOf,
    diagnose: diagnoseMirrors,
    art: {
      diagnose: (log = true) => diagnoseCompendiumArtBridge({ moduleId: MODULE_ID, log }),
      compareActor: (packName, documentId, options = {}) =>
        compareActorArt(packName, documentId, { moduleId: MODULE_ID, ...options })
    },
    browser: {
      pairs: () => getMirrorPackPairs(MODULE_ID),
      plan: () => getBrowserPackPlan(MODULE_ID),
      showPlan: () => showBrowserPackPlan(MODULE_ID),
      // Exposed for console debugging: run this directly to see exactly
      // what it finds/changes without going through the Dialog/reload flow.
      applyDefaults: () => applyRecommendedBrowserDefaults(MODULE_ID),
      // Undo a bad write (e.g. from the older, buggy "write to every tab"
      // version of applyDefaults) by restoring PF2e's own registered default.
      resetPackSetting: () => resetBrowserPackSetting()
    }
  };

  const mirrors = diagnoseMirrors(false);
  const art = diagnoseCompendiumArtBridge({ moduleId: MODULE_ID, log: false });

  console.log(
    `PF2e-KR | ${mirrors.mirrorPacks} native mirror packs available; ` +
    `CompendiumArt bridge ${art.installed ? "active" : "inactive"}.`
  );
});

// Minimal FormApplication whose only job is to pop a confirmation dialog
// when opened from Settings > Configure Game Settings, then apply (or skip)
// the recommended Compendium Browser pack defaults. This is a deliberate,
// GM-triggered, one-click action rather than something PF2e-KR does
// silently on every load, since it overwrites the GM's current per-pack
// choices in PF2e's own Compendium Browser settings.
class ApplyBrowserDefaultsMenu extends FormApplication {
  render() {
    Dialog.confirm({
      title: "PF2e-KR | 컴팬디움 브라우저 기본값 적용",
      content:
        "<p>PF2e 기본 제공 컴팬디움 팩(영문)은 컴팬디움 브라우저에서 끄고, " +
        "PF2e-KR 한글 미러 팩만 켜도록 설정을 덮어씁니다.</p>" +
        "<p>컴팬디움 브라우저에서 개별적으로 조정해 둔 팩 선택이 있다면 되돌릴 수 없습니다.</p>" +
        "<p>PF2e 컴팬디움 브라우저는 팩 목록을 세션 중 한 번 메모리에 캐시해 두고 재사용하기 때문에, " +
        "브라우저 창을 닫았다 여는 것만으로는 반영되지 않습니다. 적용 후 <strong>클라이언트를 자동으로 새로고침</strong>합니다. 계속할까요?</p>",
      yes: () => {
        const result = applyRecommendedBrowserDefaults(MODULE_ID);
        if (result?.empty) {
          ui.notifications.warn(
            "PF2e-KR | 컴팬디움 브라우저 설정이 아직 비어 있습니다. 먼저 컴팬디움 브라우저를 열고 설정(톱니) " +
            "탭에서 한 번 'Save Changes'를 눌러 초기화한 뒤 다시 시도해주세요."
          );
        } else if (result) {
          ui.notifications.info(
            `PF2e-KR | 컴팬디움 브라우저 설정을 변경했습니다 (탭 ${result.tabsChanged}개, 팩 ${result.packsChanged}건). ` +
            `컴팬디움 브라우저가 캐시를 다시 만들도록 잠시 후 새로고침합니다.`
          );
          // The PF2e Compendium Browser builds and caches its per-tab pack
          // index once (in the `game.pf2e.compendiumBrowser` singleton) and
          // does not re-read `compendiumBrowserPacks` just because its
          // window was closed and reopened. A full client reload is needed
          // for the new pack selection to actually take effect in search
          // results, not just in the settings dialog.
          foundry.utils.debouncedReload();
        } else {
          ui.notifications.warn(
            "PF2e-KR | 컴팬디움 브라우저의 팩 설정을 찾지 못했습니다. 설치된 PF2e 시스템 버전에서 내부 설정 키가 " +
            "바뀌었을 수 있습니다. 이 경우 컴팬디움 브라우저의 설정(톱니바퀴) 탭에서 직접 팩을 꺼주세요."
          );
        }
      }
    });
    return this;
  }
}

/**
 * GM: a world can pin a compendium into its own folder (e.g. an old "PF2e 한국어"
 * folder from the Babele days); that overrides the module's KR • folders.
 * This drops those world-level folder assignments for PF2e-KR packs.
 */
async function resetPackFolders() {
  if (!game.user.isGM) return 0;
  const config = foundry.utils.deepClone(game.settings.get("core", "compendiumConfiguration") ?? {});
  let count = 0;
  for (const [id, entry] of Object.entries(config)) {
    if (id.startsWith(`${MODULE_ID}.`) && entry?.folder) {
      delete entry.folder;
      count++;
    }
  }
  await game.settings.set("core", "compendiumConfiguration", config);
  ui.notifications.info(`PF2e-KR | 월드 폴더에 묶여 있던 팩 ${count}개를 모듈 기본 폴더로 되돌렸습니다. 새로고침(F5)하세요.`);
  return count;
}

function mirrorUuid(uuid) {
  if (typeof uuid !== "string") return uuid;
  const match = /^Compendium\.pf2e\.([A-Za-z0-9_-]+)\.(.+)$/.exec(uuid);
  if (!match) return uuid;
  const [, pack, rest] = match;
  return game.packs.has(`${MODULE_ID}.${pack}`)
    ? `Compendium.${MODULE_ID}.${pack}.${rest}`
    : uuid;
}

function originalNameOf(document) {
  return document?.flags?.[MODULE_ID]?.originalName ?? document?.name ?? null;
}

function diagnoseMirrors(log = true) {
  const mirrorNames = [...game.packs.keys()]
    .filter((collection) => collection.startsWith(`${MODULE_ID}.`));

  const missingOfficialPairs = [];
  for (const collection of mirrorNames) {
    const pack = collection.slice(MODULE_ID.length + 1);
    if (!game.packs.has(`pf2e.${pack}`)) missingOfficialPairs.push(pack);
  }

  const result = {
    mirrorPacks: mirrorNames.length,
    missingOfficialPairs,
    examples: mirrorNames.slice(0, 10)
  };
  if (log) console.table(result);
  return result;
}

function hookOnAutoAnimations() {
  if (!game.modules.has("autoanimations") || game.settings.get(MODULE_ID, "deactivate-animations-mapping")) {
    return;
  }

  Hooks.on("AutomatedAnimations-WorkflowStart", (data, animationData) => {
    if (animationData?.isCustomized) return;

    for (const key of ["item", "ammoItem", "originalItem"]) {
      const item = data[key];
      const originalName = originalNameOf(item);
      if (!item || !originalName || originalName === item.name) continue;

      data.recheckAnimation = true;
      data[key] = createItemNameProxy(item, originalName);
    }
  });
}

function createItemNameProxy(item, name) {
  return new Proxy(item, {
    get(target, prop, receiver) {
      if (prop === "name") return name;
      return Reflect.get(target, prop, receiver);
    }
  });
}
