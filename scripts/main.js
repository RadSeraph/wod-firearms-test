// ==========================================
// МОДУЛЬ: WoD Firearms (Test)
// Файл: scripts/main.js (Версия 1.4.0 - обработка уровней здоровья и штрафов от ран приведена к материнскому модулю wod-master-panel v2.8: system.health.damage + system.health.penalite)
// ==========================================

const MODULE_ID = "wod-firearms-test";

// Пути к данным здоровья — идентичны материнскому модулю (wod-master-panel).
const HEALTH_CONFIG = {
    healthPath: "system.health.damage",
    healthStatePath: "system.health.penalite"
};

// =========================================
// ШТРАФЫ ОТ РАН (совместимо с wod-master-panel)
// Урон разных типов НЕ конвертируется: каждый тип занимает свои ячейки
// на шкале здоровья и просто смещает состояние вниз по ней.
// Пример: 2 bashing + 2 lethal + 2 aggravated = 6 заполненных ячеек.
// Состояние здоровья берется из материнской системы Foundry (WoD20):
// читаем system.health.penalite — состояние ("Health.Trauma.X"),
// которое система сама вычисляет по суммарному урону актёра.
// Если поле недоступно, состояние определяется по суммарному урону.
//   Помят            0
//   Легко ранен     -1
//   Ранен           -1
//   Серьезно ранен  -2
//   Тяжело ранен    -2
//   Едва жив        -5
//   При смерти — бросать кубики нельзя (действие недопустимо)
// =========================================
const WOUND_PENALTIES = {
    "bruised":      { name: "Помят",         penalty: 0 },
    "battered":     { name: "Легко ранен",   penalty: -1 },
    "injured":      { name: "Ранен",         penalty: -1 },
    "wounded":      { name: "Серьезно ранен",penalty: -2 },
    "disabled":     { name: "Тяжело ранен",  penalty: -2 },
    "dying":        { name: "Едва жив",      penalty: -5 },
    "incapacitated":{ name: "При смерти",    penalty: null } // null => действие недопустимо
};

// Индексы состояний по суммарному количеству урона (фолбэк-таблица)
const WOUND_BY_DAMAGE = ["bruised", "battered", "injured", "wounded", "disabled", "dying", "incapacitated"];

function getWoundInfo(actor) {
    const health = foundry.utils.getProperty(actor, HEALTH_CONFIG.healthPath);
    const totalDamage = health
        ? (Number(health.bashing) || 0) + (Number(health.lethal) || 0) + (Number(health.aggravated) || 0)
        : 0;

    // 1) Пробуем взять состояние из материнской системы Foundry.
    let stateKey = null;
    const rawState = foundry.utils.getProperty(actor, HEALTH_CONFIG.healthStatePath);
    if (typeof rawState === "string") {
        const last = rawState.split(".").pop().toLowerCase(); // "Health.Trauma.Wounded" -> "wounded"
        if (WOUND_PENALTIES[last]) stateKey = last;
    } else if (typeof rawState === "number" && WOUND_BY_DAMAGE[rawState]) {
        stateKey = WOUND_BY_DAMAGE[rawState];
    }

    // 2) Фолбэк: определяем состояние по суммарному количеству заполненных ячеек.
    //    0-1 урона — Помят; 2 — Легко ранен; ... 7+ — При смерти.
    if (!stateKey) {
        stateKey = totalDamage <= 1 ? "bruised" : WOUND_BY_DAMAGE[Math.min(totalDamage - 1, 6)];
    }

    const state = WOUND_PENALTIES[stateKey];
    return {
        dying: state.penalty === null,
        penalty: state.penalty === null ? null : (Number(state.penalty) || 0),
        stateName: state.name
    };
}

// Диагностика: один раз при старте выводим структуру здоровья первого персонажа
Hooks.once("ready", () => {
    try {
        const a = game.actors?.characters?.[0];
        if (!a) return;
        console.log(`[${MODULE_ID}] Диагностика ран (совместимо с wod-master-panel).`,
            `system.health.damage (${a.name}):`, JSON.stringify(foundry.utils.getProperty(a, HEALTH_CONFIG.healthPath)),
            `system.health.penalite:`, JSON.stringify(foundry.utils.getProperty(a, HEALTH_CONFIG.healthStatePath)),
            `-> wound:`, JSON.stringify(getWoundInfo(a)));
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

            // --- ШТРАФ ОТ РАН (состояние берется из материнской системы Foundry, как в wod-master-panel) ---
            // Помят: 0 | Легко ранен/Ранен: -1 | Серьезно/Тяжело ранен: -2 | Едва жив: -5 | При смерти: бросок невозможен
            let woundPenalty = 0;
            let woundStateName = "";
            let isIncapacitated = false;
            if (!ignoreWounds) {
                const wound = getWoundInfo(actor);
                woundStateName = wound.stateName;
                if (wound.dying) {
                    isIncapacitated = true; // При смерти (penalty === null)
                } else {
                    woundPenalty = wound.penalty;
                }
            }

            // Дочерний модуль блокирует действие и закрывает панель (оставлено намеренно, в отличие от родителя)
            if (isIncapacitated) {
                html.closest('.dialog').find('.header-button.close').click();
                const incapData = { speaker: ChatMessage.getSpeaker({ actor: actor }), content: `<p><strong>${actor.name}</strong> находится при смерти (${woundStateName}) и не может совершать действия.</p>` };
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
                pool: `${attrKey} (${attrVal}) + ${abilityKey} (${abilityVal}) ${accuracy ? `+ Acc (${accuracy})` : ''} ${config.bonus ? `+ Режим (${config.bonus})` : ''} ${woundPenalty ? `Штраф ран: ${woundStateName} (${woundPenalty})` : ''} ${manualBonus ? `+ Вручную (${manualBonus})` : ''} = ${finalPool}`,
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
