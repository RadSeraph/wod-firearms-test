// ==========================================
// МОДУЛЬ: WoD Firearms (Test)
// Файл: scripts/main.js (Версия 1.1.2 - Фикс)
// ==========================================

const MODULE_ID = "wod-firearms-test";

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
    try {
        const isGM = game.user.isGM;
        const template = await renderTemplate(`modules/${MODULE_ID}/templates/panel.html`, {});
        new Dialog({
            title: "Стрельба",
            content: template,
            buttons: { close: { label: "Закрыть" } },
            render: (html) => setupFirearmsLogic(html, isGM)
        }, { width: 400, height: 550, resizable: true }).render(true);
    } catch (e) {
        console.error("WoD Firearms | Ошибка открытия панели:", e);
        ui.notifications.error("Ошибка открытия панели стрельбы (см. консоль F12).");
    }
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
        
        // Защита от отсутствия mode
        const modeObj = weapon.system.mode || {};
        const hasBurst = modeObj.hasburst || false;
        const hasFullAuto = modeObj.hasfullauto || false;

        Object.entries(FIRE_MODES).forEach(([key, mode]) => {
            let isDisabled = (key === "short" && !hasBurst) || (key === "long" && !hasFullAuto);
            const btn = $(`<button type="button" class="wod-mode-btn ${key === 'single' ? 'active' : ''}" data-mode="${key}" ${isDisabled ? 'disabled' : ''}>${mode.label}</button>`);
            btn.click(function() {
                if ($(this).prop('disabled')) return;
                container.find('.wod-mode-btn').removeClass('active');
                $(this).addClass('active');
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

    // ВАЖНО: Обработчик кнопки Огонь
    html.find('#firearms-fire-btn').off('click').on('click', async () => {
        try {
            const actorId = isGM ? html.find('#firearms-npc-select').val() : game.user.character?.id;
            const actor = game.actors.get(actorId);
            if (!actor) return ui.notifications.error("Выберите персонажа!");
            const weaponId = html.find('#firearms-weapon-select').val();
            const weapon = actor.items.get(weaponId);
            if (!weapon) return ui.notifications.error("Выберите оружие!");
            const mode = html.find('.wod-mode-btn.active').data('mode') || "single";
            openAttackDialog(actor, weapon, mode, html);
        } catch(e) {
            console.error("WoD Firearms | Ошибка при клике на Огонь:", e);
            ui.notifications.error("Ошибка: " + e.message);
        }
    });

    updateWeapons();
}

async function openAttackDialog(actor, weapon, mode, panelHtml) {
    try {
        const config = FIRE_MODES[mode];
        // Защита от отсутствия clip
        const clip = weapon.system.clip || { value: 0, max: 0 };
        
        if (mode === "long" && clip.value <= clip.max / 2) return ui.notifications.error(`Слишком мало патронов для длинной очереди!`);
        if (mode !== "long" && clip.value < config.cost) return ui.notifications.error(`Недостаточно патронов!`);

        const attrKey = weapon.system.attack?.attribute || "dexterity";
        const abilityKey = weapon.system.attack?.ability || "firearms";
        const attrObj = actor.system.attributes?.[attrKey] || {};
        const attrVal = attrObj.total ?? attrObj.value ?? 0; 
        const abilityVal = actor.system.abilities?.[abilityKey]?.value || 0;
        const accuracy = weapon.system.attack?.accuracy || 0;
        const specialty = actor.system.abilities?.[abilityKey]?.speciality || "";
        
        const basePool = Math.max(1, attrVal + abilityVal + accuracy + config.bonus);
        
        let currentDiff = parseInt(weapon.system.difficulty || 6) + config.diffMod;
        let currentDamageType = weapon.system.damage?.type || "lethal";

        let diffBtnsHTML = "";
        for (let i = 3; i <= 10; i++) diffBtnsHTML += `<button type="button" class="wod-diff-btn ${i === currentDiff ? 'active' : ''}" data-val="${i}">${i}</button>`;

        const dialogContent = `
            <div style="font-family: 'Signika', sans-serif; padding: 5px;">
                <h3 style="margin-top: 0; color: #8b0000; border-bottom: 1px solid #ccc; padding-bottom: 5px;">Атака: ${weapon.name}</h3>
                
                <div style="margin-bottom: 10px; font-size: 0.95em;">
                    <strong>Пул:</strong> ${attrKey} (${attrVal}) + ${abilityKey} (${abilityVal}) ${accuracy ? `+ Acc (${accuracy})` : ''} ${config.bonus ? `+ Режим (${config.bonus})` : ''}
                </div>

                <div style="margin-bottom: 10px;">
                    <label style="font-weight: bold; font-size: 13px;">Тип урона:</label>
                    <div style="display: flex; gap: 4px; margin-top: 4px;">
                        <button type="button" class="wod-dmg-type-btn ${currentDamageType === 'bashing' ? 'active' : ''}" data-val="bashing" style="flex:1; padding:4px; font-size:12px; cursor:pointer; border:1px solid #999; border-radius:4px; ${currentDamageType === 'bashing' ? 'background:#2c6b81; color:white;' : ''}">Ударный</button>
                        <button type="button" class="wod-dmg-type-btn ${currentDamageType === 'lethal' ? 'active' : ''}" data-val="lethal" style="flex:1; padding:4px; font-size:12px; cursor:pointer; border:1px solid #999; border-radius:4px; ${currentDamageType === 'lethal' ? 'background:#2c6b81; color:white;' : ''}">Летальный</button>
                        <button type="button" class="wod-dmg-type-btn ${currentDamageType === 'aggravated' ? 'active' : ''}" data-val="aggravated" style="flex:1; padding:4px; font-size:12px; cursor:pointer; border:1px solid #999; border-radius:4px; ${currentDamageType === 'aggravated' ? 'background:#2c6b81; color:white;' : ''}">Аггравированный</button>
                    </div>
                </div>

                <div style="margin-bottom: 10px;">
                    <label style="font-weight: bold; font-size: 13px;">Сложность:</label>
                    <div class="wod-diff-container" style="display: flex; gap: 4px; margin-top: 4px;">${diffBtnsHTML}</div>
                    <input type="hidden" class="wod-diff-input" value="${currentDiff}">
                </div>

                <div style="margin-bottom: 10px;">
                    <label style="font-weight: bold; font-size: 13px;">Бонус/Штраф кубов (Атака и Урон):</label>
                    <input type="number" class="wod-manual-bonus" value="0" style="width: 100%; padding: 4px; border: 1px solid #999; border-radius: 4px;">
                </div>

                <div style="margin-bottom: 10px; padding: 8px; background: rgba(139,0,0,0.1); border-radius: 4px; border: 1px solid #ccc;">
                    <label style="font-weight: bold; font-size: 13px; color: #8b0000;">Успехи защиты (Уклонение/Парирование):</label>
                    <input type="number" class="wod-defense-succ" value="0" min="0" style="width: 100%; padding: 4px; border: 1px solid #999; border-radius: 4px; margin-top: 4px;">
                </div>

                <div style="margin-bottom: 10px; padding: 5px; background: rgba(0,0,0,0.05); border-radius: 4px;">
                    <label style="display: flex; align-items: center; cursor: pointer; margin: 0; font-size: 0.9em;">
                        <input type="checkbox" class="wod-use-will" style="margin-right: 8px;">
                        <span>Тратить Силу Воли (+1 автоуспех, -1 Воля)</span>
                    </label>
                    <label style="display: flex; align-items: center; cursor: pointer; margin: 5px 0 0 0; font-size: 0.9em; color: #8b0000;">
                        <input type="checkbox" class="wod-blind-roll" style="margin-right: 8px;">
                        <span>Скрытый бросок (виден только Мастеру)</span>
                    </label>
                </div>

                <div style="display: flex; gap: 10px; justify-content: center; margin-top: 15px;">
                    <button type="button" class="wod-roll-btn" style="background: #8b0000; color: white; padding: 6px 15px; border: 1px solid #5c0000; cursor: pointer; font-weight: bold; border-radius:4px;">Бросок</button>
                    <button type="button" class="wod-cancel-btn" style="background: #444; color: white; padding: 6px 15px; border: 1px solid #222; cursor: pointer; font-weight: bold; border-radius:4px;">Отмена</button>
                </div>
            </div>
        `;

        new Dialog({
            title: `Атака: ${weapon.name}`,
            content: dialogContent,
            buttons: {},
            render: (html) => {
                html.find('.wod-diff-btn').click(function() {
                    html.find('.wod-diff-btn').removeClass('active').css({background: '#1f5c73', color: 'white', borderColor: '#333'});
                    $(this).addClass('active').css({background: '#10b981', borderColor: '#34d399', color: 'white'});
                    html.find('.wod-diff-input').val($(this).data('val'));
                });

                html.find('.wod-dmg-type-btn').click(function() {
                    html.find('.wod-dmg-type-btn').removeClass('active').css({background: '', color: '', borderColor: '#999'});
                    $(this).addClass('active').css({background: '#2c6b81', color: 'white', borderColor: '#999'});
                });

                html.find('.wod-cancel-btn').click(() => html.closest('.dialog').find('.header-button.close').click());
                
                html.find('.wod-roll-btn').off('click').on('click', async () => {
                    try {
                        const useWill = html.find('.wod-use-will').is(':checked');
                        const isBlind = html.find('.wod-blind-roll').is(':checked');
                        const manualBonus = Number(html.find('.wod-manual-bonus').val()) || 0;
                        const finalDiff = Number(html.find('.wod-diff-input').val());
                        const damageType = html.find('.wod-dmg-type-btn.active').data('val');
                        const defenseSucc = Number(html.find('.wod-defense-succ').val()) || 0;

                        html.closest('.dialog').find('.header-button.close').click();

                        // Списание патронов
                        let newClipValue = clip.value - (config.cost === "ALL" ? clip.value : config.cost);
                        if (newClipValue < 0) newClipValue = 0;
                        await weapon.update({ "system.clip.value": newClipValue });
                        if (panelHtml) panelHtml.find('#firearms-ammo-info').text(`В магазине: ${newClipValue} / ${clip.max}`);

                        if (game.audio) AudioHelper.play({ src: "sounds/dice.wav", volume: 0.8, autoplay: true, loop: false }, true);

                        // 1. Бросок атаки
                        const finalPool = Math.max(1, basePool + manualBonus);
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
                        let resultText = "";
                        if (rawSucc === 0 && ones > 0) resultText = `<div style="color: #d32f2f; font-weight: bold; margin-top: 5px;">ПРОВАЛ (Ботч)</div>`;
                        else if (netSucc === 0) resultText = `<div style="color: #7f8c8d; font-weight: bold; margin-top: 5px;">ПРОМАХ</div>`;
                        else resultText = `<div style="color: #2e6b4e; font-weight: bold; margin-top: 5px;">Успехи: ${netSucc}${useWill ? ' (+1 от Воли)' : ''}</div>`;

                        if (useWill) {
                            netSucc += 1;
                            const curWP = actor.system.advantages?.willpower?.temporary || 0;
                            await actor.update({ "system.advantages.willpower.temporary": Math.max(0, curWP - 1) });
                        }

                        const attackHtml = await renderTemplate(`modules/${MODULE_ID}/templates/chat-attack.html`, {
                            actorName: actor.name,
                            weaponName: weapon.name,
                            pool: `${attrKey} (${attrVal}) + ${abilityKey} (${abilityVal}) ${accuracy ? `+ Acc (${accuracy})` : ''} ${config.bonus ? `+ Режим (${config.bonus})` : ''} ${manualBonus ? `+ Вручную (${manualBonus})` : ''} = ${finalPool}`,
                            difficulty: finalDiff,
                            successes: netSucc,
                            diceHTML: diceHTML + resultText
                        });

                        const chatData = { speaker: ChatMessage.getSpeaker({ actor: actor }), content: attackHtml };
                        if (isBlind) { chatData.blind = true; chatData.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id); }
                        await ChatMessage.create(chatData);

                        // 2. Логика защиты и урона
                        const netAttackSucc = netSucc - defenseSucc;
                        
                        if (netAttackSucc <= 0) {
                            const missData = { speaker: ChatMessage.getSpeaker({ actor: actor }), content: `<p><strong>${actor.name}</strong> промахивается! Цель успешно защитилась (Защита: ${defenseSucc} >= Атака: ${netSucc}).</p>` };
                            if (isBlind) { missData.blind = true; missData.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id); }
                            return ChatMessage.create(missData);
                        }

                        const baseDamage = weapon.system.damage?.bonus || 0;
                        const bonusDice = Math.max(0, netAttackSucc - 1);
                        const finalDmgPool = Math.max(1, baseDamage + bonusDice + manualBonus);

                        const dmgRoll = new Roll(`${finalDmgPool}d10`);
                        await dmgRoll.evaluate();
                        if (game.dice3d && !isBlind) await game.dice3d.showForRoll(dmgRoll, game.user, true, null, false);

                        let dmgSucc = 0, dmgDiceHTML = "";
                        for (let die of dmgRoll.dice[0].results) {
                            let isSucc = die.result >= 6;
                            if (isSucc) dmgSucc++;
                            dmgDiceHTML += createDieHTML(die.result, isSucc ? 'success' : 'neutral');
                        }
                        dmgSucc = Math.max(1, dmgSucc);

                        const damageHtml = await renderTemplate(`modules/${MODULE_ID}/templates/chat-damage.html`, {
                            actorName: actor.name,
                            weaponName: weapon.name,
                            pool: `Базовый (${baseDamage}) + Успехи (${bonusDice}) ${manualBonus ? `+ Вручную (${manualBonus})` : ''} = ${finalDmgPool}`,
                            difficulty: 6,
                            diceHTML: dmgDiceHTML,
                            damageTotal: dmgSucc,
                            damageType: damageType
                        });

                        const dmgChatData = { speaker: ChatMessage.getSpeaker({ actor: actor }), content: damageHtml };
                        if (isBlind) { dmgChatData.blind = true; dmgChatData.whisper = ChatMessage.getWhisperRecipients("GM").map(u => u.id); }
                        await ChatMessage.create(dmgChatData);
                    } catch (e) {
                        console.error("WoD Firearms | Ошибка при броске:", e);
                        ui.notifications.error("Ошибка броска: " + e.message);
                    }
                });
            }
        }, { width: 400, height: 550, resizable: false }).render(true);
    } catch(e) {
        console.error("WoD Firearms | Ошибка окна атаки:", e);
        ui.notifications.error("Ошибка окна атаки: " + e.message);
    }
}
