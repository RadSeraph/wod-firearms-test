// ==========================================
// МОДУЛЬ: WoD Firearms (Test)
// Файл: scripts/main.js (Версия 1.3.3 - Штрафы от ран для WoD v20: прямой штраф системы + совместимость с CONFIG.V20.WOUNDED_LEVELS)
// ==========================================

const MODULE_ID = "wod-firearms-test";

// Уровни ран WoD v20 по русским ярлыкам (включая варианты перевода) -> штраф кубов.
// null = бросок невозможен (При смерти).
const WOUND_TABLE_RU = [
    { labels: ["не ранен", "здоров", "цел", "healthy", "bruise"], penalty: 0 },
    { labels: ["помят", "bruised"], penalty: 0 },
    { labels: ["легко ранен", "lightly wounded"], penalty: -1 },
    { labels: ["ранен", "wounded"], penalty: -1 },
    { labels: ["сильно ранен", "серьезно ранен", "very wounded"], penalty: -2 },
    { labels: ["тяжело ранен", "incapacitated"], penalty: -5 },
    { labels: ["при смерти", "dying"], penalty: null },
];

// Нормализация строк для сравнения ярлыков
function normStr(s) {
    return String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

// Совпадение ярлыка с уровнем: точное или по началу строки ("Ранен (Wounded)" и т.п.)
function labelMatchesLevel(label, levelName) {
    const l = normStr(label), ru = normStr(levelName);
    return l === ru || l.startsWith(ru + " ") || l.startsWith(ru + "(") || l.startsWith(ru + "-");
}

function findInTable(label) {
    const l = normStr(label);
    if (!l) return undefined;
    // Сначала самые длинные (самые специфичные) ярлыки, чтобы "сильно ранен" не схлопнулся в "ранен"
    const flat = [];
    WOUND_TABLE_RU.forEach((row, idx) => row.labels.forEach(lbl => flat.push({ lbl, idx })));
    flat.sort((a, b) => b.lbl.length - a.lbl.length);
    for (const { lbl, idx } of flat) {
        if (labelMatchesLevel(l, lbl) || l.includes(lbl)) return WOUND_TABLE_RU[idx].penalty;
    }
    return undefined;
}

// Источник 1 — прямой числовой штраф из данных актёра (структура v20: system.health.penalty / derived.penalty)
function readNumericPenalty(actor) {
    const candidates = [
        actor.system?.health?.penalty,
        actor.system?.health?.derived?.penalty,
        foundry.utils.getProperty(actor, "system.health.woundPenalty"),
    ];
    for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n) && n !== 0) return Math.min(0, n); // штраф всегда <= 0
    }
    return undefined;
}

// Источник 2 — текстовая метка текущего уровня ран в данных актёра
function readWoundLabelFromActor(actor) {
    const candidates = [
        actor.system?.health?.woundLabel,
        actor.system?.health?.wound,
        foundry.utils.getProperty(actor, "system.health.woundLevel"),
        foundry.utils.getProperty(actor, "system.health.wound_level"),
        foundry.utils.getProperty(actor, "system.health.level"),
    ];
    for (const c of candidates) {
        if (typeof c === "string" && c.trim()) return c.trim();
    }
    return null;
}

// Источник 3 — таблица уровней системы. v20 использует CONFIG.V20.WOUNDED_LEVELS (плюс защита от
// реестров с другим регистром ключа и от формата V5-подобных пар [minDamage, label]).
function getSystemWoundedLevels() {
    const cfg = globalThis.CONFIG || {};
    const section = cfg.V20 || cfg.v20 || cfg.WoD || cfg.WOD || cfg.wod || {};
    return section.WOUNDED_LEVELS || section.wounded_levels;
}

// Таблица может быть: объектом {key: label}, массивом строк, массивом [{label, penalty}] или парами [min, label].
// matchedLevelIndex — сколько ступней таблицы «пройдено» текущим вредом (0 = нижняя ступень/здоров).
function resolveFromSystemTable(actor, totalDamage) {
    const levels = getSystemWoundedLevels();
    if (!levels) return undefined;

    // Объект вида { healthy:"Здоров", bruised:"Помят", wounded:"Ранен", ... } — порядок ключей = от лёгкого к тяжёлому.
    // Текущий уровень определяем по индексу, вычисленному из вреда относительно макс. здоровья.
    if (!Array.isArray(levels) && typeof levels === "object") {
        const entries = Object.entries(levels);
        const maxHealth = Number(actor?.system?.health?.max ?? 0);
        let idx = -1;
        if (maxHealth > 0) {
            // Ступени v20: 0..1/3 — нижняя, 1/3..2/3 — следующая и т.д.
            idx = Math.min(entries.length - 1, Math.floor((totalDamage / maxHealth) * entries.length));
        } else {
            idx = totalDamage > 0 ? entries.length - 1 : 0;
        }
        if (idx < 0) return undefined;
        const explicit = Number(entries[idx][1]?.penalty);
        if (Number.isFinite(explicit)) return Math.min(0, explicit);
        return findInTable(entries[idx][1]);
    }

    if (!Array.isArray(levels) || levels.length === 0) return undefined;

    // Массив элементов: строка | {label,...} | [minDamage, label]
    let matchedIdx = -1;
    let matchedLabel = "";
    let hasThresholds = false;
    for (let i = 0; i < levels.length; i++) {
        const e = levels[i];
        const label = typeof e === "string" ? e
            : Array.isArray(e) ? String(e[1] ?? "")
            : String(e?.label ?? e?.name ?? "");
        const min = Array.isArray(e) ? Number(e[0]) : Number(e?.min ?? e?.threshold ?? NaN);
        if (Number.isFinite(min)) {
            hasThresholds = true;
            if (totalDamage >= min) { matchedIdx = i; matchedLabel = label; }
        }
    }

    // Порогов нет — считаем ступень по доле вреда от максимального здоровья
    if (!hasThresholds && levels.length > 0) {
        const maxHealth = Number(actor?.system?.health?.max ?? 0);
        matchedIdx = maxHealth > 0
            ? Math.min(levels.length - 1, Math.floor((totalDamage / maxHealth) * levels.length))
            : (totalDamage > 0 ? levels.length - 1 : 0);
        const e = levels[matchedIdx];
        matchedLabel = typeof e === "string" ? e : String(e?.label ?? e?.name ?? "");
    }

    if (matchedIdx === -1) return undefined;

    const explicitPenalty = Array.isArray(levels[matchedIdx]) ? undefined : Number(levels[matchedIdx]?.penalty);
    if (Number.isFinite(explicitPenalty)) return Math.min(0, explicitPenalty);

    const byLabel = findInTable(matchedLabel);
    if (byLabel !== undefined) return byLabel;

    return undefined; // индекс таблицы системы не сопоставили — пусть решает fallback по ступеням v20
}

// Финальный расчёт: числовой штраф системы -> метка актёра -> таблица CONFIG -> ступени по вреду/здоровью (v20: Penalized/Mangled/Crippled)
function resolveWoundPenalty(actor, totalDamage, maxHealth) {
    const numeric = readNumericPenalty(actor);
    if (numeric !== undefined) return numeric;

    const label = readWoundLabelFromActor(actor);
    if (label) {
        const fromLabel = findInTable(label);
        if (fromLabel !== undefined) return fromLabel;
    }

    const fromTable = resolveFromSystemTable(actor, totalDamage);
    if (fromTable !== undefined) return fromTable;

    // Ступени v20: Penalized (-1) при 1/3+ вреда, Mangled (-2) при половине и более, Crippled/При смерти — дальше не стрелять
    if (!(maxHealth > 0)) return 0;
    if (totalDamage >= maxHealth) return null;        // При смерти
    if (totalDamage * 2 >= maxHealth) return -2;       // Mangled (половина здоровья и ниже)
    if (totalDamage * 3 >= maxHealth) return -1;       // Penalized (треть здоровья)
    return 0;
}

// Получение суммарного вреда и макс. здоровья в формате v20 (health.value/penalty/aggravated/super)
function readHealthData(actor) {
    const h = actor.system?.health || {};
    const maxHealth = Number(h.max ?? h.derived?.max ?? actor.system?.attributes?.stamina?.value ?? 5);
    // В v20 health.value — это ОТНИМАЕМЫЙ урон? Нет: value — текущий уровень здоровья. Вред = max - value.
    // Но в ряде сборок value хранит накопленный вред — сверяемся с both подходами и берём консервативно больший штраф.
    const current = Number(h.value ?? maxHealth);
    const damageFromValue = Math.max(0, maxHealth - current);
    const agg = Number(h.aggravated) || 0;
    const sup = Number(h.super) || 0;
    return { totalDamage: Math.max(damageFromValue, agg + sup), maxHealth };
}

// Диагностика: один раз при старте выводим структуру здоровья первого персонажа
Hooks.once("ready", () => {
    try {
        const a = game.actors?.characters?.[0];
        if (!a) return;
        console.log(`[${MODULE_ID}] Диагностика ран. CONFIG.V20?.WOUNDED_LEVELS:`,
            JSON.stringify(getSystemWoundedLevels() ?? "(нет)"));
        console.log(`[${MODULE_ID}] system.health (${a.name}):`, JSON.stringify(a.system?.health));
    } catch (e) { /* не критично */ }
});

const FIRE_MODES = {
    single: { label: "Одиночный", cost: 1, bonus: 0, diffMod: 0, isBurst: false },
    short:  { label: "Короткая очередь", cost: 3, bonus: 2, diffMod: 1, isBurst: true },
    long:   { label: "Длинная очередь", cost: "ALL", bonus: 10, diffMod: 2, isBurst: true }
};

function createDieHTML(value, resultType) {
    let gradStart, gradEnd, strokeColor;
    if (resultType === 'success') { gradStart = '#2ecc71'; gradEnd = '#145a32'; strokeColor = '#1a7a1a'; }
    else if (resultType === 'fail') { gradStart = '#e74c3c'; gradEnd = '#641e16'; strokeColor = '#c00000'; }
    else if (resultType === 'spec') { gradStart = '#f1c40f'; gradEnd = '#7d6608'; strokeColor = '#d4a017'; }
    else { gradStart = '#7f8c8d'; gradEnd = '#2c3e50'; strokeColor = '#5a5a5a'; }

    return `<span style="display: inline-block; width: 28px; height: 32px; background: linear-gradient(145deg, ${gradStart}, ${gradEnd}); clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); color: white; font-weight: bold; font-size: 16px; line-height: 32px; text-align: center; margin: 2px; box-shadow: 0 2px 4px rgba(0,0,0,0.5); border: 1px solid ${strokeColor};">${value}</span>`;
}

Hooks.on("ready", () => {
    if (document.getElementById("wod-firearms-menu")) return;
    const container = document.createElement("div");
    container.id = "wod-firearms-menu";
    container.style.cssText = "position: fixed; top: 55%; left: 50px; width: 50px; height: 50px; z-index: 10; pointer-events: none;";
    const btn = document.createElement("div");
    btn.innerHTML = `<i class="fas fa-crosshairs"></i>`;
    btn.title = "Стрельба";
    btn.style.cssText = `width: 45px; height: 45px; background: #8b0000; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.6); border: 2px solid #ff4444; transition: all 0.2s ease; z-index: 2; pointer-events: auto;`;
    btn.onmouseenter = () => { btn.style.transform = "scale(1.2)"; btn.style.background = "#a80000"; };
    btn.onmouseleave = () => { btn.style.transform = "scale(1)"; btn.style.background = "#8b0000"; };
    btn.addEventListener("click", () => openFirearmsPanel());
    container.appendChild(btn);
    document.body.appendChild(container);
});

async function openFirearmsPanel() {
    const isGM = game.user.isGM;
    const template = await renderTemplate(`modules/${MODULE_ID}/templates/panel.html`, {});

    new Dialog({
        title: "Стрельба",
        content: template,
        buttons: { close: { label: "Закрыть" } },
        render: (html) => setupFirearmsLogic(html, isGM)
    }, { width: 450, resizable: true }).render(true);
}

function setupFirearmsLogic(html, isGM) {
    if (isGM) {
        let npcOptions = `<option value="">Не выбрано</option>`;
        game.actors.filter(a => a.type === "Vampire" || a.type === "Mortal").sort((a,b) => a.name.localeCompare(b.name)).forEach(n => npcOptions += `<option value="${n.id}">${n.name}</option>`);
        html.find('#firearms-npc-select').html(npcOptions);
        html.find('#firearms-npc-block').show();
    } else {
        const actor = game.user.character;
        if (actor) html.find('#firearms-actor-select').html(`<option value="${actor.id}">${actor.name}</option>`);
    }

    let diffBtnsHTML = "";
    for (let i = 3; i <= 10; i++) diffBtnsHTML += `<button type="button" class="wod-diff-btn" data-val="${i}" style="flex:1; padding:5px 0; background:#1f5c73; color:white; border:1px solid #333; border-radius:4px; font-size:13px; font-weight:bold; cursor:pointer;">${i}</button>`;
    html.find('.wod-diff-container').html(diffBtnsHTML);
    html.find(`.wod-diff-btn[data-val="6"]`).css({background: '#10b981', borderColor: '#34d399'});
    html.find('.wod-diff-input').val(6);

    const updateWeapons = () => {
        const actorId = isGM ? html.find('#firearms-npc-select').val() : game.user.character?.id;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        const weapons = actor.items.filter(i => i.type === "Ranged Weapon");
        let options = `<option value="">Не выбрано</option>`;
        weapons.forEach(w => options += `<option value="${w.id}">${w.name}</option>`);
        html.find('#firearms-weapon-select').html(options);
        html.find('#firearms-mode-buttons').empty();
        updateAmmoInfo(actor, null);
    };

    const updateAmmoInfo = (actor, weapon) => {
        if (!weapon) return html.find('#firearms-ammo-info').text("В магазине: 0 / 0");
        const clip = weapon.system.clip || { value: 0, max: 0 };
        html.find('#firearms-ammo-info').text(`В магазине: ${clip.value} / ${clip.max}`);
    };

    const renderModeButtons = (weapon) => {
        const container = html.find('#firearms-mode-buttons');
        container.empty();
        if (!weapon) return;

        const modeObj = weapon.system.mode || {};
        const hasBurst = modeObj.hasburst || false;
        const hasFullAuto = modeObj.hasfullauto || false;
        const weaponDiff = parseInt(weapon.system.difficulty || 6);

        Object.entries(FIRE_MODES).forEach(([key, mode]) => {
            let isDisabled = (key === "short" && !hasBurst) || (key === "long" && !hasFullAuto);
            const btn = $(`<button type="button" class="wod-mode-btn ${key === 'single' ? 'active' : ''}" data-mode="${key}" ${isDisabled ? 'disabled' : ''} style="padding:6px; background:${key === 'single' ? '#2c6b81' : 'rgba(0,0,0,0.05)'}; color:${key === 'single' ? '#fff' : '#333'}; border:1px solid ${key === 'single' ? '#5bb9d6' : '#999'}; border-radius:4px; cursor:pointer; text-align:left; font-weight:bold; font-size:13px;">${mode.label}</button>`);

            btn.click(function() {
                if ($(this).prop('disabled')) return;
                container.find('.wod-mode-btn').removeClass('active').css({background: 'rgba(0,0,0,0.05)', color: '#333', borderColor: '#999'});
                $(this).addClass('active').css({background: '#2c6b81', color: '#fff', borderColor: '#5bb9d6'});

                const newDiff = weaponDiff + mode.diffMod;
                html.find('.wod-diff-btn').removeClass('active').css({background: '#1f5c73', borderColor: '#333'});
                html.find(`.wod-diff-btn[data-val="${newDiff}"]`).addClass('active').css({background: '#10b981', borderColor: '#34d399'});
                html.find('.wod-diff-input').val(newDiff);
            });
            container.append(btn);
        });
    };

    if (isGM) html.find('#firearms-npc-select').change(updateWeapons);
    html.find('#firearms-weapon-select').change(function() {
        const actorId = isGM ? html.find('#firearms-npc-select').val() : game.user.character?.id;
        const actor = game.actors.get(actorId);
        const weapon = actor?.items.get($(this).val());
        updateAmmoInfo(actor, weapon);
        renderModeButtons(weapon);
    });

    html.find('.wod-diff-btn').click(function() {
        html.find('.wod-diff-btn').removeClass('active').css({background: '#1f5c73', borderColor: '#333'});
        $(this).addClass('active').css({background: '#10b981', borderColor: '#34d399'});
        html.find('.wod-diff-input').val($(this).data('val'));
    });

    html.find('.wod-dmg-type-btn').click(function() {
        html.find('.wod-dmg-type-btn').removeClass('active').css({background: '', color: '', borderColor: '#999'});
        $(this).addClass('active').css({background: '#2c6b81', color: 'white', borderColor: '#999'});
    });

    html.find('#firearms-fire-btn').off('click').on('click', async () => {
        try {
            const actorId = isGM ? html.find('#firearms-npc-select').val() : game.user.character?.id;
            const actor = game.actors.get(actorId);
            if (!actor) return ui.notifications.error("Выберите персонажа!");
            const weaponId = html.find('#firearms-weapon-select').val();
            const weapon = actor.items.get(weaponId);
            if (!weapon) return ui.notifications.error("Выберите оружие!");

            const mode = html.find('.wod-mode-btn.active').data('mode') || "single";
            const config = FIRE_MODES[mode];
            const clip = weapon.system.clip || { value: 0, max: 0 };

            if (mode === "long" && clip.value <= clip.max / 2) return ui.notifications.error(`Слишком мало патронов для длинной очереди!`);
            if (mode !== "long" && clip.value < config.cost) return ui.notifications.error(`Недостаточно патронов!`);

            const useWill = html.find('.wod-use-will').is(':checked');
            const isBlind = html.find('.wod-blind-roll').is(':checked');
            const ignoreWounds = html.find('.wod-ignore-wounds').is(':checked');
            const manualBonus = Number(html.find('.wod-manual-bonus').val()) || 0;
            const finalDiff = Number(html.find('.wod-diff-input').val());
            const damageType = html.find('.wod-dmg-type-btn.active').data('val');

            // --- ПРОВЕРКА ВОЛИ ---
            if (useWill) {
                const curWP = Number(foundry.utils.getProperty(actor, "system.advantages.willpower.temporary")) || 0;
                if (curWP <= 0) return ui.notifications.error(`${actor.name}: недостаточно Воли!`);
            }

            const attrKey = weapon.system.attack?.attribute || "dexterity";
            const abilityKey = weapon.system.attack?.ability || "firearms";
            const attrObj = actor.system.attributes?.[attrKey] || {};
            const attrVal = attrObj.total ?? attrObj.value ?? 0;
            const abilityVal = actor.system.abilities?.[abilityKey]?.value || 0;
            const accuracy = weapon.system.attack?.accuracy || 0;
            const specialty = actor.system.abilities?.[abilityKey]?.speciality || "";

            // --- ШТРАФ ОТ РАН (WoD v20) ---
            // Здоров: 0 | Penalized: -1 | Mangled: -2 | Crippled/При смерти: бросок невозможен
            let woundPenalty = 0;
            let isIncapacitated = false;
            if (!ignoreWounds) {
                const { totalDamage, maxHealth } = readHealthData(actor);
                const resolved = resolveWoundPenalty(actor, totalDamage, maxHealth);
                if (resolved === null) {
                    isIncapacitated = true; // При смерти
                } else {
                    woundPenalty = Number(resolved) || 0;
                }
            }

            if (isIncapacitated) {
                html.closest('.dialog').find('.header-button.close').click();
                const incapData = { speaker: ChatMessage.getSpeaker({ actor: actor }), content: `<p><strong>${actor.name}</strong> находится при смерти и не может совершать действия.</p>` };
                await ChatMessage.create(incapData);
                return;
            }

            const basePool = attrVal + abilityVal + accuracy + config.bonus + woundPenalty;
            const finalPool = Math.max(0, Math.floor(basePool + manualBonus));

            html.closest('.dialog').find('.header-button.close').click();

            if (finalPool <= 0) {
                const failData = { speaker: ChatMessage.getSpeaker({ actor: actor }), content: `<p><strong>${actor.name}</strong> пытается выстрелить из ${weapon.name}, но пул кубов равен 0${ignoreWounds ? '' : ` (Штраф от ран: ${woundPenalty})`}. Действие провалено.</p>` };
                if (isBlind) { failData.blind = true; failData.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id); }
                await ChatMessage.create(failData);
                return;
            }

            let newClipValue = clip.value - (config.cost === "ALL" ? clip.value : config.cost);
            if (newClipValue < 0) newClipValue = 0;
            await weapon.update({ "system.clip.value": newClipValue });

            if (game.audio) foundry.audio.AudioHelper.play({ src: "sounds/dice.wav", volume: 0.8, autoplay: true, loop: false }, true);

            const roll = new Roll(`${finalPool}d10`);
            await roll.evaluate();
            if (game.dice3d && !isBlind) await game.dice3d.showForRoll(roll, game.user, true, null, false);

            let rawSucc = 0, ones = 0, diceHTML = "";
            for (let die of roll.dice[0].results) {
                let isSucc = die.result >= finalDiff;
                let isOne = die.result === 1;
                let isSpec = (die.result === 10 && specialty);
                if (isSucc) rawSucc += isSpec ? 2 : 1;
                if (isOne) ones++;
                diceHTML += createDieHTML(die.result, isSucc ? (isSpec ? 'spec' : 'success') : (isOne ? 'fail' : 'neutral'));
            }

            let netSucc = Math.max(0, rawSucc - ones);
            let willText = "";

            if (useWill) {
                if (rawSucc === 0) {
                    willText = `<div style="color: #2c6b81; font-weight: bold; margin-top: 5px; font-style: italic;">Лишь сильная воля помогает преодолеть трудности!</div>`;
                }
                netSucc += 1;
                const curWP = Number(foundry.utils.getProperty(actor, "system.advantages.willpower.temporary")) || 0;
                await actor.update({ "system.advantages.willpower.temporary": Math.max(0, curWP - 1) });
            }

            let resultText = "";
            if (rawSucc === 0 && ones > 0 && !useWill) resultText = `<div style="color: #d32f2f; font-weight: bold; margin-top: 5px;">ПРОВАЛ (Ботч)</div>`;
            else if (netSucc === 0) resultText = `<div style="color: #7f8c8d; font-weight: bold; margin-top: 5px;">ПРОМАХ</div>`;
            else resultText = `<div style="color: #2e6b4e; font-weight: bold; margin-top: 5px;">Успехи: ${netSucc}</div>`;

            const attackHtml = await renderTemplate(`modules/${MODULE_ID}/templates/chat-attack.html`, {
                actorName: actor.name,
                weaponName: weapon.name,
                pool: `${attrKey} (${attrVal}) + ${abilityKey} (${abilityVal}) ${accuracy ? `+ Acc (${accuracy})` : ''} ${config.bonus ? `+ Режим (${config.bonus})` : ''} ${woundPenalty ? `Штраф ран (${woundPenalty})` : ''} ${manualBonus ? `+ Вручную (${manualBonus})` : ''} = ${finalPool}`,
                difficulty: finalDiff,
                diceHTML: diceHTML + resultText + willText
            });

            const chatData = { speaker: ChatMessage.getSpeaker({ actor: actor }), content: attackHtml };
            if (isBlind) { chatData.blind = true; chatData.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id); }
            await ChatMessage.create(chatData);

            if (netSucc > 0) {
                setTimeout(() => {
                    openDamageDialog(actor, weapon, netSucc, damageType, isBlind);
                }, 600);
            }

        } catch(e) {
            console.error("WoD Firearms | Ошибка:", e);
            ui.notifications.error("Ошибка: " + e.message);
        }
    });

    updateWeapons();
}

async function openDamageDialog(actor, weapon, attackSuccesses, damageType, isBlindAttack) {
    const baseDamage = weapon.system.damage?.bonus || 0;

    let diffBtnsHTML = "";
    for (let i = 3; i <= 10; i++) diffBtnsHTML += `<button type="button" class="wod-diff-btn ${i === 6 ? 'active' : ''}" data-val="${i}" style="flex:1; padding:5px 0; background:${i === 6 ? '#10b981' : '#1f5c73'}; color:white; border:1px solid ${i === 6 ? '#34d399' : '#333'}; border-radius:4px; font-size:13px; font-weight:bold; cursor:pointer;">${i}</button>`;

    const dialogContent = `
        <div style="font-family: 'Signika', sans-serif; padding: 5px;">
            <h3 style="margin-top: 0; color: #8b0000; border-bottom: 1px solid #ccc; padding-bottom: 5px;">${weapon.name}</h3>

            <div style="margin-bottom: 10px; font-size: 0.95em;">
                <strong>Базовый урон:</strong> ${baseDamage} (${damageType})<br>
                <strong>Успехи атаки:</strong> ${attackSuccesses}
            </div>

            <div style="margin-bottom: 10px; padding: 8px; background: rgba(139,0,0,0.1); border-radius: 4px; border: 1px solid #ccc;">
                <label style="font-weight: bold; font-size: 13px; color: #8b0000;">Успехи защиты (Уклонение/Парирование):</label>
                <input type="number" class="wod-defense-succ" value="0" min="0" style="width: 100%; padding: 4px; border: 1px solid #999; border-radius: 4px; margin-top: 4px;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; font-size: 13px;">Сложность урона:</label>
                <div class="wod-dmg-diff-container" style="display: flex; gap: 4px; margin-top: 4px;">${diffBtnsHTML}</div>
                <input type="hidden" class="wod-dmg-diff-input" value="6">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="font-weight: bold; font-size: 13px;">Бонус/Штраф кубов:</label>
                <input type="number" class="wod-dmg-manual-bonus" value="0" style="width: 100%; padding: 4px; border: 1px solid #999; border-radius: 4px; margin-top: 4px;">
            </div>

            <div style="display: flex; gap: 10px; justify-content: center; margin-top: 15px;">
                <button type="button" class="wod-roll-dmg-btn" style="background: #8b0000; color: white; padding: 6px 15px; border: 1px solid #5c0000; cursor: pointer; font-weight: bold; border-radius:4px;">Бросок урона</button>
                <button type="button" class="wod-cancel-dmg-btn" style="background: #444; color: white; padding: 6px 15px; border: 1px solid #222; cursor: pointer; font-weight: bold; border-radius:4px;">Отмена</button>
            </div>
        </div>
    `;

    new Dialog({
        title: `${weapon.name}`,
        content: dialogContent,
        buttons: {},
        render: (html) => {
            html.find('.wod-diff-btn').click(function() {
                html.find('.wod-diff-btn').removeClass('active').css({background: '#1f5c73', borderColor: '#333'});
                $(this).addClass('active').css({background: '#10b981', borderColor: '#34d399'});
                html.find('.wod-dmg-diff-input').val($(this).data('val'));
            });

            html.find('.wod-cancel-dmg-btn').click(() => html.closest('.dialog').find('.header-button.close').click());

            html.find('.wod-roll-dmg-btn').click(async () => {
                try {
                    const defenseSucc = Number(html.find('.wod-defense-succ').val()) || 0;
                    const finalDiff = Number(html.find('.wod-dmg-diff-input').val());
                    const dmgManualBonus = Number(html.find('.wod-dmg-manual-bonus').val()) || 0;

                    html.closest('.dialog').find('.header-button.close').click();

                    const netAttackSucc = attackSuccesses - defenseSucc;
                    if (netAttackSucc <= 0) {
                        const missData = { speaker: ChatMessage.getSpeaker({ actor: actor }), content: `<p><strong>${actor.name}</strong> промахивается! Цель успешно защитилась (Защита: ${defenseSucc} >= Атака: ${attackSuccesses}).</p>` };
                        if (isBlindAttack) { missData.blind = true; missData.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id); }
                        return ChatMessage.create(missData);
                    }

                    const bonusDice = Math.max(0, netAttackSucc - 1);

                    // Сначала бонусы, потом штрафы, защита минимума 1
                    let totalPool = baseDamage + bonusDice + dmgManualBonus;
                    const finalDmgPool = Math.max(1, Math.floor(totalPool));

                    const dmgRoll = new Roll(`${finalDmgPool}d10`);
                    await dmgRoll.evaluate();
                    if (game.dice3d && !isBlindAttack) await game.dice3d.showForRoll(dmgRoll, game.user, true, null, false);

                    let dmgSucc = 0, dmgDiceHTML = "";
                    for (let die of dmgRoll.dice[0].results) {
                        let isSucc = die.result >= finalDiff;
                        if (isSucc) dmgSucc++;
                        dmgDiceHTML += createDieHTML(die.result, isSucc ? 'success' : 'neutral');
                    }

                    dmgSucc = Math.max(1, dmgSucc);

                    const damageHtml = await renderTemplate(`modules/${MODULE_ID}/templates/chat-damage.html`, {
                        actorName: actor.name,
                        weaponName: weapon.name,
                        pool: `Базовый (${baseDamage}) + Успехи (${bonusDice}) ${dmgManualBonus ? `${dmgManualBonus > 0 ? '+' : ''}${dmgManualBonus} (Вручную)` : ''} = ${finalDmgPool}`,
                        difficulty: finalDiff,
                        diceHTML: dmgDiceHTML,
                        damageTotal: dmgSucc,
                        damageType: damageType
                    });

                    const dmgChatData = { speaker: ChatMessage.getSpeaker({ actor: actor }), content: damageHtml };
                    if (isBlindAttack) { dmgChatData.blind = true; dmgChatData.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id); }
                    await ChatMessage.create(dmgChatData);

                } catch(e) {
                    console.error("WoD Firearms | Ошибка урона:", e);
                    ui.notifications.error("Ошибка урона: " + e.message);
                }
            });
        }
    }, { width: 400, resizable: false }).render(true);
}
