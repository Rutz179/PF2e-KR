import {CompendiumMapping} from "../babele/script/compendium-mapping.js";

class Translator {
    static get() {
        if (!Translator.instance) {
            Translator.instance = new Translator();
        }
        return Translator.instance;
    }

    // Initialize translator
    async initialize() {
        // Signalize translator is ready
        Hooks.callAll("pf2KO.ready");

        const config = await Promise.all([
            fetch("modules/PF2e-KR/compendium/config.json")
                .then((r) => r.json())
                .catch((_e) => {
                    console.error("PF2e-KR: config 파일을 찾지 못했습니다.");
                }),
        ]);

        this.mappings = config[0]?.mappings ?? {};
    }

    constructor() {
        this.initialize();
    }

    sluggify(label) {
        return label
        .normalize("NFD")                     // 한글 분리 (선택)
        .replace(/[\u0300-\u036f]/g, "")      // 발음 기호 제거 (선택)
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^\p{L}0-9]+/gu, " ")       // 유니코드 문자 유지 (한글 포함)
        .trim()
        .replace(/[-\s]+/g, "-");
    }

    getMapping(mapping, compendium = false) {
        if (compendium) {
            return this.mappings[mapping]
                ? new CompendiumMapping(this.mappings[mapping].entryType, this.mappings[mapping].mappingEntries)
                : {};
        }
        return this.mappings[mapping];
    }

    dynamicMerge(sourceObject, translation, mapping) {
        if (translation) {
            foundry.utils.mergeObject(sourceObject, mapping.map(sourceObject, translation ?? {}), { overwrite: true });
        }
        return sourceObject;
    }

    dynamicObjectListMerge(sourceObjectList, translations, mapping) {
        if (translations) {
            const mergedObjectList = {};
            Object.keys(sourceObjectList).forEach((entry) => {
                Object.assign(mergedObjectList, {
                    [entry]: this.dynamicMerge(sourceObjectList[entry], translations[entry], mapping),
                });
            });
        }
    }

    dynamicArrayMerge(sourceArray, translation, mapping) {
        if(!translation) {
            return sourceArray;
        }
        // Loop through array, merge available objects
        const mappedObjectArray = [];
        for (let i = 0; i < sourceArray.length; i++) {
            if (translation[i]) {
                mappedObjectArray.push(this.dynamicMerge(sourceArray[i], translation[i], mapping));
            } else {
                mappedObjectArray.push(sourceArray[i]);
            }
        }
        return mappedObjectArray;
    }

    translateActorItems(data, translation) {
        data.forEach((entry, index, arr) => {
            let specificTranslation = translation ? translation[entry["_id"]] : undefined;
            const originalName = entry.name;
            if (entry._stats?.compendiumSource
                && entry._stats.compendiumSource.startsWith("Compendium")
                && !entry._stats.compendiumSource.includes(".Actor.")
                && entry._stats.compendiumSource !== "Compendium.pf2e.spells-srd.Item.o0l57UfBm9ScEUMW"
                && entry._stats.compendiumSource !== "Compendium.pf2e.spells-srd.Item.6dDtGIUerazSHIOu") {
                const itemCompendium = entry._stats.compendiumSource.slice(
                    entry._stats.compendiumSource.indexOf(".") + 1,
                    entry._stats.compendiumSource.lastIndexOf(".Item.")
                );
                const originalName = fromUuidSync(entry._stats.compendiumSource, {'strict': false})?.flags?.babele?.originalName;
                if (originalName) {
                    entry.name = originalName;
                    const compendium = game.babele.packs.get(itemCompendium);
                    if (compendium) {
                        arr[index] = compendium.translate(entry);
                    }
                }
            }

            if (specificTranslation) {
                // Merge specific translation into Compendium translation
                this.dynamicMerge(arr[index], specificTranslation, this.getMapping("item", true))
                // Add Babele standard translated fields
                foundry.utils.mergeObject(arr[index], {
                    translated: true,
                    hasTranslation: true,
                    originalName: originalName,
                    flags: {
                        babele: {
                            translated: true,
                            hasTranslation: true,
                            originalName: originalName
                        }
                    }
                });
            }

            // Add the item slug if not already included
            if (!arr[index].system.slug || arr[index].system.slug === "") {
                arr[index].system.slug = this.sluggify(originalName);
            }
        });

        return data;
    }

    translateEquipmentName(data, translation, dataObject) {

            return translation;
        }
    }


Hooks.once("init", () => {
    game.langKOPf2e = Translator.get();

    game.settings.register("PF2e-KR", "name-display", {
        name: "이름 표시 방식",
        hint: "여기에서 컴펜디엄에서 불러온 액터, 아이템, 저널 등의 이름을 어떻게 번역해 표시할지를 선택할 수 있습니다.",
        scope: "world",
        type: String,
        choices: {
            "ko": "한글만",
            "en": "영어만",
            "ko-en": "한글-영어",

        },
        default: "ko-en",
        config: true,
        onChange: foundry.utils.debouncedReload
    });

    game.settings.register("PF2e-KR", "item-name-generation", {
        name: "무기 이름 자동 생성 사용",
        hint: "재질과 룬 등의 특성에 따라 무기 및 방어구 이름을 자동으로 생성합니다. 이 기능은 번역된 이름이 있을 때만 올바르게 작동하며, 원문 이름만 사용하는 경우와는 호환되지 않습니다.",
        scope: "world",
        type: Boolean,
        default: false,
        config: true,
        onChange: foundry.utils.debouncedReload
    });

    game.settings.register("PF2e-KR", "deactivate-animations-mapping", {
        name: "애니메이션 번역 자동 매핑 비활성화",
        hint: "PF2E Animations 모듈은 컴펜디엄의 주문이나 무기 사용 시 자동으로 애니메이션을 재생합니다. 이 한글화 모듈은 번역된 이름에 대해서도 자동 매핑을 수행합니다. 만약 수동으로 애니메이션 매핑을 설정한 경우, 충돌을 피하기 위해 이 옵션을 체크해 자동 번역 매핑을 끌 수 있습니다.",
        scope: "world",
        type: Boolean,
        default: false,
        config: true,
        onChange: foundry.utils.debouncedReload
    });

    if (typeof game.babele !== "undefined") {
        game.babele.register({
            module: "PF2e-KR",
            lang: 'ko',
            dir: "compendium/"+game.settings.get('PF2e-KR', 'name-display')
        });

        game.babele.registerConverters({
            "translateActorItems": (data, translation) => {
                return game.langKOPf2e.translateActorItems(data, translation);
            },
            "translateEquipmentName": (data, translation, dataObject) => {
                return game.langKOPf2e.translateEquipmentName(data, translation, dataObject);
            },
            "translateHeightening": (data, translation) => {
                  if (!translation) return data;

                      // translation.heightening이 없으면 기본 설명만 반환
                      if (!translation.heightening) {
                          return data;
                      }

                return game.langKOPf2e.dynamicObjectListMerge(
                  data, 
                  translation, 
                  game.langKOPf2e.getMapping("heightening", true)
                );
            },
            "translateSpellVariant": (data, translation) => {
                  if (!translation) return data;
                return game.langKOPf2e.dynamicObjectListMerge(data, translation, game.langKOPf2e.getMapping("item", true));
            },
            "translateRules": (data, translation) => {
                  if (!translation) return data;
                return game.langKOPf2e.dynamicArrayMerge(data, translation, game.langKOPf2e.getMapping("rules", true));
            },
            "translateSkillVariants": (data, translation) => {
                  if (!translation) return data;
                return game.langKOPf2e.dynamicObjectListMerge(data, translation, game.langKOPf2e.getMapping("skillSpecial", true));
            }
        });
    }

    hookOnAutoAnimations();
});

Hooks.once("babele.ready", () => {
    game.pf2e.ConditionManager.initialize();

    if (game.modules.get("lang-fr-pf2e")?.active){
        ui.notifications.error("Le package \"Système PF2 Français\" est encore installé sur cette partie ; il n'est plus utile et peut donc être désinstallé.")
    }
});

/**
 * Credits to n1xx1 for suggesting this compatibility script for translated items
 */
function hookOnAutoAnimations() {
    if (!game.modules.has("autoanimations") || game.settings.get('PF2e-KR', 'deactivate-animations-mapping')) {
        return;
    }

    Hooks.on("AutomatedAnimations-WorkflowStart", (data, animationData) => {
        if (animationData && animationData.isCustomized) return;

        if (data.item?.flags?.babele?.originalName) {
            data.recheckAnimation = true;
            data.item = AACreateItemNameProxy(data.item, data.item.flags.babele.originalName);
        }

        if (data.ammoItem?.flags?.babele?.originalName) {
            data.recheckAnimation = true;
            data.ammoItem = AACreateItemNameProxy(data.ammoItem, data.ammoItem.flags.babele.originalName);
        }

        if (data.originalItem?.flags?.babele?.originalName) {
            data.recheckAnimation = true;
            data.originalItem = AACreateItemNameProxy(data.originalItem, data.originalItem.flags.babele.originalName);
        }
    });
}

function AACreateItemNameProxy(item, realName) {
    return new Proxy(item, {
        get(target, p, receiver) {
            return ("name" === p) ? realName : Reflect.get(target, p, receiver);
        },
    });
}
